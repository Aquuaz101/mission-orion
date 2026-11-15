import * as THREE from 'three';
import './mars.css';
import { playObjectiveIntro } from '../../ui/objectiveIntro';
import type { App } from '../../app/App';
import type { Mission, MissionExit } from '../types';
import { MarsStage, MAX_SPEED } from './MarsStage';
import { SAMPLES, SAMPLE_TUBE, BRIEF_SPECS, briefingLines, LINES, type SampleKind } from './script';
import { html, $, wait, escapeHtml } from '../../ui/dom';

type Phase = 'intro' | 'explore' | 'emergency-find' | 'emergency-tow' | 'recovery' | 'final' | 'complete' | 'failed';

interface Poi { id: string; pos: THREE.Vector3; kind: 'sample' | 'ares' | 'zone' | 'start'; sample?: SampleKind; label: string }

const EMERGENCY_SECONDS = 180;
const INTERACT_RANGE = 6;
const ZONE_RADIUS = 11;
const JEZERO = { lat: 18.38, lon: 77.58 };

/**
 * Route through the real Jezero delta-front channels (720-px grid of the 732 m HiRISE crop).
 * Start in a shadowed ravine → channel → basin pit (ARES-7) → sunlit mesa (recovery) → layered outcrop.
 */
const GRID: Record<string, [number, number]> = {
  // demo-length route (~240 m): each objective pulled halfway toward the start along the original path (was ~480 m)
  start: [352, 594], s1: [344, 555], s2: [351, 503], ares: [369, 440], zone: [416, 428], s3: [429, 403],
};

/**
 * Mission 02: Perseverance-class rover in Jezero Crater.
 * Cinematic, linear: explore → (after 2 samples) fictional ARES-7 dust-storm emergency →
 * tow to the ridge → recovery → final sample.
 */
export class MarsMission implements Mission {
  private stage: MarsStage | null = null;
  private hud: HTMLElement | null = null;
  private paused = false;
  private disposed = false;
  private disposers: (() => void)[] = [];
  private finish!: (e: MissionExit) => void;

  private phase: Phase = 'intro';
  private pois = new Map<string, Poi>();
  private targetId: string | null = null;
  private collected: SampleKind[] = [];
  private battery = 1;
  private timer: number | null = null;
  private locked = true;
  private snapshot: { pos: THREE.Vector3; yaw: number; battery: number } | null = null;
  private startTime = 0;
  private lastWarn = 0;
  private flags = new Set<string>();
  private minimapImg: HTMLImageElement | null = null;

  constructor(private app: App) {}

  start(): Promise<MissionExit> {
    const exit = new Promise<MissionExit>((r) => (this.finish = r));
    void this.flow();
    return exit;
  }
  abort(exit: MissionExit) {
    this.finish(exit);
  }
  setPaused(p: boolean) {
    this.paused = p;
    if (this.stage) this.stage.paused = p;
    if (p) this.app.sfx.roverDrive(0);
  }
  dispose() {
    this.disposed = true;
    this.disposers.forEach((d) => d());
    this.disposers = [];
    this.hud?.remove();
    this.app.input.releasePointer();
    this.app.input.lookMode = 'drag';
    this.app.space.showModel(null);
    this.app.sfx.setWind(0);
    this.app.sfx.stopLoops();
    this.app.sfx.setMuffle(0);
    this.stage?.dispose();
    this.stage = null;
  }

  private async flow() {
    const go = await this.briefing();
    if (this.disposed) return;
    if (!go) return this.finish({ to: 'select' });
    await this.descend();
    if (this.disposed) return;
    await this.introCutscene();
    if (this.disposed) return;
    await playObjectiveIntro(this.app.ui, this.app.input, this.app.sfx, {
      eyebrow: 'Mission 02 · Jezero Crater, Mars', title: 'Collect three rock samples', accent: '#ff8a3d', accent2: '#d23a2a',
      objectives: [
        { title: 'Collect igneous rock', sub: 'Follow the marker, stop beside the rock: the arm does the rest', icon: 'rock' },
        { title: 'Collect hematite-bearing rock', sub: 'Iron-rich rock that formed in water', icon: 'rock' },
        { title: 'Collect sedimentary rock', sub: 'Layered rock from Jezero’s ancient lake', icon: 'rock' },
        { title: 'Stand by for Mission Control', sub: 'Something may come up out there', icon: 'signal', teaser: true },
      ],
      footer: this.app.mode === 'device' ? 'W A S D drive  ·  Mouse look  ·  E collect  ·  Follow the on-screen marker' : 'Left stick drive  ·  Action button collect  ·  Follow the on-screen marker',
      target: () => this.hud?.querySelector<HTMLElement>('.obj-block') ?? null,
    });
    if (this.disposed) return;
    this.startTime = performance.now();
    this.phase = 'explore';
    this.locked = false;
    this.setTarget('s1');
    void this.app.commander.say([LINES.intro, LINES.start], { interrupt: true });
  }

  // ─────────────────────────────────────────── briefing (Mars globe, Jezero marker)
  private globeDir = new THREE.Vector3();

  private briefing(): Promise<boolean> {
    const { app } = this;
    app.engine.setStage(app.space);
    app.space.setShot('briefing', 0.7);
    const globe = new THREE.Group();
    globe.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshStandardMaterial({ map: app.assets.textures.mars ?? null, roughness: 1, color: app.assets.textures.mars ? 0xffffff : 0xb05a30 })));
    const u = (JEZERO.lon + 180) / 360, v = (90 - JEZERO.lat) / 180;
    const phi = u * Math.PI * 2, theta = v * Math.PI;
    const dir = new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
    this.globeDir.copy(dir);
    for (const [r0, r1, c] of [[0.035, 0.05, 0x4fd8ff], [0, 0.012, 0xffffff]] as const) {
      const m = new THREE.Mesh(r0 ? new THREE.RingGeometry(r0, r1, 32) : new THREE.CircleGeometry(r1, 16), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, toneMapped: false }));
      m.position.copy(dir.clone().multiplyScalar(1.005));
      m.lookAt(dir.clone().multiplyScalar(2));
      globe.add(m);
    }
    app.space.showModel(globe, 6.5, { spin: false, faceDir: dir.clone().add(new THREE.Vector3(0.35, 0.15, 0)).normalize() });
    app.link.send({ t: 'layout', layout: 'lobby', title: 'Mission 02 · Briefing', subtitle: 'Tap Begin when you are ready', cta: 'Begin mission' });

    const specs = BRIEF_SPECS.map(([k, val]) => `<div><span>${k}</span><b>${val}</b></div>`).join('');
    const el = html(`
      <section class="briefing">
        <div class="brief-panel panel brackets fade-up">
          <div class="eyebrow">Mission 02 · Briefing</div>
          <h2>Red Planet Expedition</h2>
          <p class="brief-lead">Pilot a <b>Perseverance-class rover</b> through the real channels of Jezero Crater’s ancient river delta and collect three geological samples.</p>
          <div class="brief-specs mono">${specs}</div>
          <h4 class="mono">Objectives</h4>
          <ol class="brief-objs">
            <li><span class="mono">1</span>Collect igneous rock</li>
            <li><span class="mono">2</span>Collect hematite-bearing rock</li>
            <li><span class="mono">3</span>Collect sedimentary rock</li>
          </ol>
          <div class="brief-actions">
            <button class="btn primary go">Begin descent <span class="kbd">ENTER</span></button>
            <button class="btn ghost abort">Abort</button>
          </div>
          <p class="brief-note">Globe: NASA/USGS Mars mosaic · Terrain: NASA/JPL/UArizona HiRISE via USGS · Rover model: NASA/JPL-Caltech</p>
        </div>
        <div class="brief-caption mono fade-up" style="animation-delay:.4s">MARS · JEZERO CRATER 18.4° N 77.5° E</div>
      </section>`);
    void app.screens.show(el);
    void app.commander.say(briefingLines(app.mode), { interrupt: true });
    return new Promise((resolve) => {
      const done = (go: boolean) => { off(); app.commander.clear(); app.sfx[go ? 'confirm' : 'back'](); resolve(go); };
      $(el, '.go').addEventListener('click', () => done(true));
      $(el, '.abort').addEventListener('click', () => done(false));
      const off = app.input.onPress((id) => { if (!this.paused && (id === 'confirm' || id === 'primary')) done(true); });
      this.disposers.push(off);
    });
  }

  // ─────────────────────────────────────────── descent: dive into the globe, build the world
  private async descend() {
    const { app } = this;
    const cover = html(`<section class="cine-cover"><div class="cc-lines mono"></div></section>`);
    void app.screens.show(cover);
    app.space.diveIntoShowcase(3.45, 1.1); // fly into Jezero on the globe
    app.sfx.servo(2.2);
    await wait(1700);
    cover.classList.add('black');
    const lines = $(cover, '.cc-lines');
    const say = async (l: string, ms = 380) => { lines.appendChild(html(`<div class="fade-up">${l}</div>`)); app.sfx.blip(); await wait(ms); };
    await say('ENTRY · DESCENT · LANDING');
    await wait(80);

    // Build the world while the screen is black.
    this.stage = new MarsStage(app.assets, app.engine.renderer, app.quality);
    const st = this.stage;
    st.resize(window.innerWidth, window.innerHeight);
    this.buildPois();
    const start = this.pois.get('start')!.pos, first = this.pois.get('s1')!.pos;
    st.placeRover(start, Math.atan2(first.x - start.x, first.z - start.z));
    st.update(0.016);
    st.render(app.engine.renderer); // compile shaders while the screen is black
    await say('TERRAIN · HiRISE DTM · JEZERO DELTA FRONT');
    app.sfx.riser(1.1);
    await wait(1000);
    await say('SKY CRANE · TOUCHDOWN CONFIRMED', 450);
    app.sfx.impact(0.8);

    app.space.showModel(null);
    app.engine.setStage(st);
    app.sfx.setAmbience('mars');
    app.sfx.setMusic('mars');
    app.input.pointerEnabled = true;
    app.input.lookMode = 'lock';
    const img = app.assets.textures.jezeroOrtho?.image as HTMLImageElement | undefined;
    this.minimapImg = img ?? null;
    this.hud = this.buildHud();
    this.hud.classList.add('cine');
    await app.screens.show(this.hud);
    app.link.send({ t: 'layout', layout: 'mars', title: 'Stand by' });

    this.disposers.push(
      app.engine.onTick((dt) => this.tick(dt)),
      app.input.onPress((id) => {
        if (this.paused) return;
        if (id === 'interact' || id === 'primary') void this.interact();
        if (id === 'key:KeyV' || id === 'view') this.toggleView();
      }),
      () => (app.input.pointerEnabled = false),
    );
  }

  /** COD-style opener: aerial sweep down the channel onto the rover with a location card. */
  private async introCutscene() {
    const st = this.stage!;
    const P = st.roverPos, f = st.forward;
    const back = (d: number, up: number, side = 0) => new THREE.Vector3(P.x - f.x * d + f.z * side, P.y + up, P.z - f.z * d - f.x * side);
    const ahead = (d: number, up = 0) => new THREE.Vector3(P.x + f.x * d, P.y + up, P.z + f.z * d);
    this.locationCard(['JEZERO CRATER · MARS', 'Delta front · 18.4° N 77.5° E', 'Perseverance-class rover · Sol 1'], 'Real terrain: NASA HiRISE elevation data');
    const cover = document.querySelector('.cine-cover');
    cover?.classList.add('out');
    await st.playCine([
      { pos: ahead(170, 95), look: ahead(40, 0) },
      { pos: ahead(90, 45).add(new THREE.Vector3(25, 0, 0)), look: P.clone() },
      { pos: back(25, 14, -10), look: ahead(2, 1) },
      { pos: back(9.5, 3.8), look: ahead(0, 1.4) },
    ], 8.5);
    cover?.remove();
    this.hud!.classList.remove('cine');
  }

  private locationCard(lines: string[], foot: string) {
    const card = html(`<div class="loc-card mono"></div>`);
    this.hud!.appendChild(card);
    lines.forEach((l, i) => setTimeout(() => card.appendChild(html(`<div class="${i === 0 ? 'big' : ''}">${typeHtml(l)}</div>`)), 600 + i * 900));
    setTimeout(() => card.appendChild(html(`<div class="foot">${foot}</div>`)), 600 + lines.length * 900);
    setTimeout(() => card.classList.add('out'), 8200);
    setTimeout(() => card.remove(), 9200);
  }

  private buildPois() {
    const st = this.stage!;
    const at = (k: string, r = 8) => st.findFlat(st.terrain.pixelToWorld(GRID[k][0], GRID[k][1]), r);
    const add = (p: Poi) => this.pois.set(p.id, p);
    add({ id: 'start', pos: at('start', 10), kind: 'start', label: 'Start' });
    add({ id: 's1', pos: at('s1'), kind: 'sample', sample: 'igneous', label: 'Sample' });
    add({ id: 's2', pos: at('s2'), kind: 'sample', sample: 'hematite', label: 'Sample' });
    add({ id: 'ares', pos: at('ares', 6), kind: 'ares', label: 'ARES-7' });
    add({ id: 'zone', pos: at('zone', 12), kind: 'zone', label: 'Recovery ridge' });
    add({ id: 's3', pos: at('s3'), kind: 'sample', sample: 'sedimentary', label: 'Sample' });
    // keep objectives and a corridor along each leg of the route free of boulders
    const order = ['start', 's1', 's2', 'ares', 'zone', 's3'].map((k) => this.pois.get(k)!.pos);
    const clear: THREE.Vector3[] = [];
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1], b = order[i], L = a.distanceTo(b);
      for (let d = 0; d <= L; d += 4) clear.push(a.clone().lerp(b, d / L));
    }
    st.clearAround(clear, 6);
    st.addSpecimen('s1', 'igneous', this.pois.get('s1')!.pos);
    st.addSpecimen('s2', 'hematite', this.pois.get('s2')!.pos);
  }

  private setTarget(id: string | null) {
    this.targetId = id;
    this.paintObjective();
  }

  // ─────────────────────────────────────────── interaction
  private distTo(p: THREE.Vector3) {
    const r = this.stage!.roverPos;
    return Math.hypot(p.x - r.x, p.z - r.z);
  }
  private currentAction(): string | null {
    if (this.locked || !this.targetId || !this.stage || this.stage.inCutscene) return null;
    const p = this.pois.get(this.targetId)!;
    if (p.kind === 'sample' && this.distTo(p.pos) < INTERACT_RANGE) return 'COLLECT SAMPLE';
    if (p.kind === 'ares' && this.phase === 'emergency-find' && this.distTo(this.stage.ares.group.position) < 10) return 'ATTACH TOW CABLE';
    return null;
  }

  private toggleView() {
    if (!this.stage || this.locked) return;
    this.stage.setView(this.stage.view === 'chase' ? 'fp' : 'chase');
    this.app.sfx.blip();
    $(this.hud!, '.view-mode').textContent = this.stage.view === 'fp' ? 'MASTCAM-Z' : 'CHASE CAM';
    this.hud!.classList.toggle('fp', this.stage.view === 'fp');
  }

  private async interact() {
    const action = this.currentAction();
    if (!action || !this.stage) return;
    const st = this.stage;
    this.locked = true;
    st.speed = 0;
    if (action === 'COLLECT SAMPLE') {
      const poi = this.pois.get(this.targetId!)!;
      const prevView = st.view;
      st.setView('chase');
      this.hud!.classList.remove('fp'); // no mast-camera frame over the cutscene
      // camera in front of the rover, off to one side, so the arm works toward the viewer
      const rock = st.specimens.get(poi.id)!.position.clone();
      const toRock = Math.atan2(rock.x - st.roverPos.x, rock.z - st.roverPos.z);
      st.setOrbit(rock.clone().add(new THREE.Vector3(0, 0.25, 0)), 4.4, 1.5, 0.07, toRock + 0.95);
      this.hud!.classList.add('cine');
      this.app.link.buzz([20, 40, 20, 40, 20]);
      await st.pickUp(poi.id, (s) => {
        if (s === 'approach') this.showProgress('Autonomous approach');
        if (s === 'deploy') { this.showProgress('Robotic arm · deploying'); this.app.sfx.servo(2.0); }
        if (s === 'reach') { this.showProgress('Positioning drill'); this.app.sfx.servo(1.5); }
        if (s === 'drill') { this.showProgress('Coring sample'); this.app.sfx.drill(1.4); this.app.link.buzz(900); st.shake = 0.35; }
        if (s === 'lift') st.shake = 0;
        if (s === 'lift') { this.showProgress('Sample acquired'); this.app.sfx.blip(); this.app.sfx.servo(1.4); }
        if (s === 'stow') { this.showProgress('Stowing arm · sealing tube'); this.app.sfx.servo(2.0); }
      });
      if (this.disposed) return;
      st.setOrbit(null);
      st.setView(prevView);
      this.hud!.classList.toggle('fp', prevView === 'fp');
      this.hud!.classList.remove('cine');
      this.hideProgress();
      this.targetId = null;
      this.locked = false;
      this.collect(poi.sample!);
    } else if (action === 'ATTACH TOW CABLE') {
      await this.latchCutscene();
      this.locked = false;
    }
  }

  private collect(kind: SampleKind) {
    const info = SAMPLES[kind];
    this.collected.push(kind);
    this.app.sfx.success();
    this.app.link.buzz([40, 60, 40]);
    this.notify(`SAMPLE SECURED · ${this.collected.length} / 3`);
    this.paintInventory();
    this.showSampleCard(kind);
    const lines = this.app.commander.say(info.collected, { interrupt: true });
    if (kind === 'igneous') {
      this.setTarget('s2');
      void this.app.commander.say(LINES.next);
    } else if (kind === 'hematite') {
      void lines.then(() => this.startEmergency());
    } else {
      void lines.then(() => this.complete());
    }
  }

  // ─────────────────────────────────────────── emergency
  private async startEmergency() {
    if (this.disposed || this.phase !== 'explore') return;
    const st = this.stage!;
    this.phase = 'emergency-find';
    // a beat of silence, then the hit
    this.app.sfx.silence(900);
    this.app.sfx.setMusic('none');
    await wait(750);
    if (this.disposed) return;
    this.app.sfx.braam();
    this.app.sfx.alarm(3);
    this.app.sfx.setMusic('tension', 0.15);
    st.kick(0.6, 0.15);
    st.alert = 1;
    this.app.link.buzz([200, 100, 200, 100, 200]);
    this.hud!.classList.add('alert');
    const ares = this.pois.get('ares')!;
    st.ares.group.position.copy(ares.pos);
    st.ares.group.position.y = st.terrain.heightAt(ares.pos.x, ares.pos.z);
    st.ares.group.rotation.y = 2.2;
    st.ares.body.rotation.set(0.16, 0, -0.2); // stuck: nose-down, listing
    st.ares.body.position.y = -0.28;          // sunk into the sand
    st.ares.group.visible = true;
    st.ares.setDust(1);
    st.ares.setWings(0);
    this.setTarget('ares');
    this.timer = EMERGENCY_SECONDS;
    this.battery = Math.min(this.battery, 0.85);
    this.snapshot = { pos: st.roverPos.clone(), yaw: st.roverYaw, battery: this.battery };
    this.paintObjective();
    await this.app.commander.say(LINES.emergency, { interrupt: true });
  }

  private async revealCutscene() {
    const st = this.stage!;
    this.locked = true;
    st.speed = 0;
    this.hud!.classList.add('cine');
    this.app.sfx.riser(1.6);
    st.setOrbit(st.ares.group.position, 8.5, 2.6, 0.28);
    setTimeout(() => { if (!this.disposed) { this.app.sfx.braam(); st.kick(0.5); } }, 1500);
    await this.app.commander.say(LINES.aresReveal, { interrupt: true });
    st.setOrbit(null);
    this.hud!.classList.remove('cine');
    this.locked = false;
  }

  /** Rover backs up in front of ARES-7, cable shoots out and clamps, ARES-7 lurches free. */
  private async latchCutscene() {
    const st = this.stage!;
    this.hud!.classList.add('cine');
    const a = st.ares.group.position.clone();
    const zone = this.pois.get('zone')!.pos;
    const dir = new THREE.Vector3(zone.x - a.x, 0, zone.z - a.z).normalize();
    const goal = a.clone().addScaledVector(dir, 2.4 + 0.8 + 1.7);
    const yaw = Math.atan2(dir.x, dir.z);
    st.setOrbit(a.clone().addScaledVector(dir, 2.5), 9, 3, 0.18);
    this.showProgress('Positioning for tow');
    const p0 = st.roverPos.clone(), y0 = st.roverYaw;
    const dy = Math.atan2(Math.sin(yaw - y0), Math.cos(yaw - y0));
    await new Promise<void>((resolve) => {
      const t0 = performance.now();
      const off = this.app.engine.onTick(() => {
        const k = Math.min(1, (performance.now() - t0) / 2200), e = k * k * (3 - 2 * k);
        st.roverPos.x = THREE.MathUtils.lerp(p0.x, goal.x, e);
        st.roverPos.z = THREE.MathUtils.lerp(p0.z, goal.z, e);
        st.roverYaw = y0 + dy * e;
        if (k >= 1) { off(); resolve(); }
      });
    });
    this.showProgress('Deploying tow cable');
    this.app.sfx.servo(1.4);
    this.app.sfx.winch(1.4);
    await st.latch();
    this.app.sfx.clank();
    this.app.sfx.impact(0.9);
    st.kick(1, 0.35);
    this.app.sfx.setMusic('rescue', 0.5);
    this.app.link.buzz([60, 40, 120]);
    this.hideProgress();
    st.setOrbit(null);
    this.hud!.classList.remove('cine');
    this.phase = 'emergency-tow';
    this.setTarget('zone');
    void this.app.commander.say(LINES.latched, { interrupt: true });
  }

  private async recover() {
    const st = this.stage!;
    this.phase = 'recovery';
    this.timer = null;
    this.locked = true;
    st.speed = 0;
    this.hud!.classList.remove('alert');
    this.hud!.classList.add('cine');
    this.paintObjective();
    st.alert = 0;
    this.app.sfx.setMuffle(0);
    this.app.sfx.roverDrive(0);
    this.app.sfx.impact(0.7);
    this.app.sfx.setMusic('triumph');
    const lines = this.app.commander.say(LINES.recovering, { interrupt: true });
    st.setOrbit(st.ares.group.position, 10, 3.5, 0.2);
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const off = this.app.engine.onTick(() => {
        const k = Math.min(1, (performance.now() - t0) / 10000);
        st.storm = Math.min(st.storm, 1 - THREE.MathUtils.smoothstep(k, 0, 0.7));
        st.stormFront = st.storm;
        st.ares.setDust(1 - THREE.MathUtils.smoothstep(k, 0.15, 0.6));
        st.ares.setWings(THREE.MathUtils.smoothstep(k, 0.45, 0.9));
        st.rayStrength = 0.7 + Math.sin(Math.min(1, k * 1.4) * Math.PI) * 1.6; // sunlight breaks through
        this.app.sfx.setWind(st.storm);
        if (k >= 1) { off(); resolve(); }
      });
    });
    if (this.disposed) return;
    this.app.sfx.success();
    this.app.link.buzz([40, 60, 40]);
    await lines;
    await this.app.commander.say(LINES.restored);
    if (this.disposed) return;
    st.unlatch();
    st.setOrbit(null);
    st.rayStrength = 0.8;
    this.hud!.classList.remove('cine');
    this.phase = 'final';
    this.locked = false;
    st.addSpecimen('s3', 'sedimentary', this.pois.get('s3')!.pos);
    this.setTarget('s3');
    setTimeout(() => { if (!this.disposed && this.phase === 'final') this.app.sfx.setMusic('mars'); }, 20000);
    void this.app.commander.say(LINES.sample3);
  }

  private fail() {
    if (this.phase === 'failed') return;
    this.phase = 'failed';
    this.locked = true;
    this.app.input.releasePointer();
    this.app.sfx.error();
    this.app.sfx.braam();
    this.app.sfx.setMusic('none');
    this.app.sfx.roverDrive(0);
    this.app.link.buzz([300, 100, 300]);
    void this.app.commander.say({ text: LINES.fail, mood: 'alert' }, { interrupt: true });
    const ov = html(`
      <div class="mars-fail interactive">
        <div class="panel brackets">
          <div class="eyebrow" style="color:var(--c-orange)">Reserves critical</div>
          <h2>Recovery window lost</h2>
          <p>Your batteries or the time window ran out before ARES-7 reached the ridge. Follow the marker and keep moving.</p>
          <div class="brief-actions">
            <button class="btn primary retry">Retry from emergency</button>
            <button class="btn ghost quit">Abort to mission select</button>
          </div>
        </div>
      </div>`);
    this.hud!.appendChild(ov);
    $(ov, '.retry').addEventListener('click', () => { this.app.sfx.click(); ov.remove(); this.retry(); });
    $(ov, '.quit').addEventListener('click', () => { this.app.sfx.click(); this.finish({ to: 'select' }); });
  }

  private retry() {
    const st = this.stage!;
    const s = this.snapshot!;
    st.unlatch();
    st.placeRover(s.pos, s.yaw);
    this.battery = s.battery;
    this.timer = EMERGENCY_SECONDS;
    const ares = this.pois.get('ares')!;
    st.ares.group.position.copy(ares.pos);
    st.ares.group.position.y = st.terrain.heightAt(ares.pos.x, ares.pos.z);
    st.ares.body.rotation.set(0.16, 0, -0.2);
    st.ares.body.position.y = -0.28;
    this.phase = 'emergency-find';
    this.locked = false;
    this.flags.delete('t120'); this.flags.delete('t60'); this.flags.delete('t30'); this.flags.delete('lowbatt');
    this.app.sfx.setMusic('tension', 0.4);
    this.setTarget('ares');
    void this.app.commander.say({ text: LINES.retry, mood: 'alert' }, { interrupt: true });
  }

  private async complete() {
    if (this.phase === 'complete') return;
    this.phase = 'complete';
    this.locked = true;
    this.paintObjective();
    const st = this.stage!, hud = this.hud!;
    this.app.input.releasePointer();
    st.setView('chase');
    hud.classList.remove('fp');
    hud.classList.add('cine', 'sat');
    this.app.sfx.roverDrive(0);
    this.app.sfx.setMusic('triumph');
    const lines = this.app.commander.say(LINES.wrap);
    const sat = html(`<div class="sat-ui mono"><div class="sat-flash"></div><div class="sat-tag"><i></i><span>Perseverance-class rover</span></div><div class="sat-info"><b>Mission complete</b><span class="sat-alt"></span></div></div>`);
    hud.appendChild(sat);
    const tag = $(sat, '.sat-tag');
    const off = this.app.engine.onTick(() => {
      const s = st.toScreen(st.roverPos);
      tag.style.transform = `translate(${(s.x * window.innerWidth).toFixed(1)}px, ${(s.y * window.innerHeight).toFixed(1)}px)`;
    });
    this.disposers.push(off);
    // Camera tilts to look straight down, then jumps up in three cuts to a satellite view.
    await st.satelliteExit((level, alt) => {
      $(sat, '.sat-alt').textContent = `Jezero Crater · 18.4° N 77.5° E · altitude ${alt} m`;
      if (level === 0) return;
      this.app.sfx.whoosh();
      this.app.link.buzz(30);
      const fl = $(sat, '.sat-flash');
      fl.classList.remove('go');
      void fl.offsetWidth;
      fl.classList.add('go');
      sat.classList.toggle('far', level >= 2);
    });
    await lines;
    if (this.disposed) return;
    this.showReport();
  }

  // ─────────────────────────────────────────── per frame
  private tick(dt: number) {
    const st = this.stage;
    if (!st || !this.hud || this.paused) return;
    const { input } = this.app;
    const emergency = this.phase === 'emergency-find' || this.phase === 'emergency-tow';

    const l = input.stickL();
    if (!this.locked && this.battery > 0 && !st.inCutscene) st.drive(l.y, l.x, dt);
    else if (!st.inCutscene) st.drive(0, 0, dt);
    this.app.sfx.roverDrive(this.phase === 'complete' || this.phase === 'failed' ? 0 : Math.abs(st.speed) / MAX_SPEED, st.sandiness);
    if (st.blocked && performance.now() - this.lastWarn > 5000) {
      this.lastWarn = performance.now();
      this.flashWarning('TERRAIN TOO STEEP');
    }
    if (st.sandiness > 0.6 && Math.abs(st.speed) > 1 && !this.flags.has('sand') && !this.app.commander.busy && this.phase === 'explore') {
      this.flags.add('sand');
      void this.app.commander.say(LINES.sand);
    }

    // Look: captured mouse (free look), right stick / arrows, wheel distance.
    const r = input.stickR();
    const m = input.consumeMouse();
    if (!st.inCutscene) st.look(-r.x * dt * 1.9 - m.dx * 0.0032, r.y * dt * 1.2 - m.dy * 0.0026, m.wheel);
    st.autoRecentre = !input.pointerLocked;
    this.hud.classList.toggle('show-lock-hint', !input.pointerLocked && this.app.mode === 'device' && !st.inCutscene && !this.locked);

    // Power: MMRTG trickle; driving draws more than it supplies.
    const load = Math.abs(st.speed) / MAX_SPEED;
    const drain = (emergency ? 0.0042 : 0.0016) * load * (st.towing ? 1.3 : 1) + (emergency ? 0.0005 : 0.0001);
    const charge = load < 0.05 && !emergency ? 0.0006 : 0;
    this.battery = THREE.MathUtils.clamp(this.battery - drain * dt + charge * dt, 0, 1);

    if (emergency) {
      // storm front rolls in, then engulfs
      st.stormFront = Math.min(1, st.stormFront + dt / 14);
      if (st.stormFront > 0.65) st.storm = Math.min(1, st.storm + dt / 10);
      this.app.sfx.setWind(Math.max(st.storm, st.stormFront * 0.4));
      if (this.timer !== null && !st.inCutscene && !this.locked) this.timer = Math.max(0, this.timer - dt);
      if (this.timer === 0 || this.battery <= 0) this.fail();
      this.emergencyDrama(st);
      if (!this.flags.has('storm') && this.timer !== null && this.timer < EMERGENCY_SECONDS - 28 && !this.app.commander.busy) {
        this.flags.add('storm');
        void this.app.commander.say([LINES.stormFact, LINES.mmrtg]);
      }
    }
    if (this.phase === 'emergency-find' && !st.inCutscene) {
      const now = performance.now();
      if (now - this.lastBeacon > 1800) {
        this.lastBeacon = now;
        const a = st.ares.group.position, d = this.distTo(a);
        const cam = st.forward, bearing = Math.atan2(a.x - st.roverPos.x, a.z - st.roverPos.z) - Math.atan2(cam.x, cam.z);
        this.app.sfx.beacon(-Math.sin(bearing), Math.min(1, Math.max(0.12, 1 - d / 340)) * 0.8);
      }
    }
    if (this.phase === 'emergency-find' && !this.flags.has('reveal') && this.distTo(st.ares.group.position) < 32) {
      this.flags.add('reveal');
      void this.revealCutscene();
    }
    if (this.phase === 'emergency-tow') {
      const zone = this.pois.get('zone')!.pos;
      if (Math.hypot(st.ares.group.position.x - zone.x, st.ares.group.position.z - zone.z) < ZONE_RADIUS) void this.recover();
    }
    st.ares.setStatus(this.phase === 'final' || this.phase === 'complete' ? 0x5dffa8 : 0xffaa33, this.phase !== 'final' && this.phase !== 'complete', performance.now() / 1000);

    if (!this.flags.has('speed') && st.distance > 60 && !this.app.commander.busy && this.phase === 'explore') {
      this.flags.add('speed');
      void this.app.commander.say(LINES.speedNote);
    }
    this.paintHud();
    this.sendPhone();
  }

  /** Music intensity, storm muffling, timed callouts and the final-seconds countdown. */
  private emergencyDrama(st: MarsStage) {
    const sfx = this.app.sfx, T = this.timer;
    const towing = this.phase === 'emergency-tow';
    const urgency = T === null ? 0 : 1 - T / EMERGENCY_SECONDS;
    sfx.setMusicIntensity(Math.min(1, (towing ? 0.45 : 0.1) + st.stormFront * 0.25 + urgency * 0.6));
    sfx.setMuffle(st.storm * 0.4);
    if (!this.flags.has('stormhit') && st.stormFront > 0.65) {
      this.flags.add('stormhit');
      sfx.impact(1);
      st.kick(0.8, 0.1);
      this.app.link.buzz([120, 60, 120]);
      if (!this.app.commander.busy) void this.app.commander.say(LINES.stormHit);
    }
    if (T === null || this.phase === 'failed') return;
    const callout = (flag: string, at: number, line: { text: string; mood: 'alert' }) => {
      if (!this.flags.has(flag) && T <= at && T > at - 5) {
        this.flags.add(flag);
        sfx.impact(0.5);
        void this.app.commander.say(line, { interrupt: !this.app.commander.busy || at <= 30 });
      }
    };
    callout('t120', 120, LINES.twoMin);
    callout('t60', 60, LINES.oneMin);
    callout('t30', 30, LINES.thirty);
    if (!this.flags.has('lowbatt') && this.battery < 0.25) {
      this.flags.add('lowbatt');
      sfx.alarm(2);
      void this.app.commander.say(LINES.lowBatt);
    }
    if (towing && !this.flags.has('ridge') && this.distTo(this.pois.get('zone')!.pos) < 45) {
      this.flags.add('ridge');
      if (!this.app.commander.busy) void this.app.commander.say(LINES.ridgeClose);
    }
    // last 10 seconds: a tick every second
    const sec = Math.ceil(T);
    if (T < 10.5 && T > 0 && sec !== this.lastTick) { this.lastTick = sec; sfx.tick(true); }
  }
  private lastTick = -1;
  private lastBeacon = 0;

  // ─────────────────────────────────────────── HUD
  private buildHud() {
    const device = this.app.mode === 'device';
    const el = html(`
      <section class="mhud passthrough">
        <div class="storm-veil"></div>
        <div class="letterbox top"></div><div class="letterbox bottom"></div>
        <div class="wp"><div class="wp-icon"></div><div class="wp-label mono"></div><div class="wp-dist mono"></div><div class="wp-arrow"></div></div>
        <div class="wp ares-wp"><div class="wp-icon"></div><div class="wp-label mono">ARES-7</div></div>

        <div class="mh-tl">
          <div class="minimap"><canvas width="220" height="220"></canvas><span class="mm-n mono">N</span></div>
          <div class="obj-col">
            <div class="obj-block">
              <div class="obj-head mono">Objective</div>
              <div class="obj-text"></div>
              <div class="obj-sub mono"></div>
            </div>
            <div class="sample-bar">
              <div class="sb-head mono"><span>Rock samples</span><b class="sb-count">0 / 3</b></div>
              <div class="sb-segs"></div>
            </div>
          </div>
        </div>

        <div class="mh-top">
          <div class="compass mono"><div class="compass-strip"></div><b class="compass-needle"></b></div>
          <div class="timer mono" hidden><span>Recovery window</span><b>3:00</b></div>
          <div class="alert-banner mono"><b>⚠ Priority transmission</b><span>Dust storm · scout rover ARES-7 without power</span><em>Simulated incident</em></div>
        </div>

        <div class="mh-br">
          <div class="status-row mono"><span class="view-mode">CHASE CAM</span><span class="state">IDLE</span></div>
          <div class="batt"><div class="batt-label mono"><span>Battery</span><b class="batt-v">100%</b></div><div class="batt-bar"><b></b></div></div>
          <div class="tele-row mono">
            <div><label>Speed</label><b class="spd">0.0</b><i>m/s</i></div>
            <div><label>Elevation</label><b class="elev">-</b><i>m</i></div>
            <div><label>Heading</label><b class="hdg">000°</b></div>
          </div>
        </div>

        <div class="notify mono"></div>
        <div class="prompt mono"><span class="kbd">${device ? 'E' : '●'}</span><b></b></div>
        <div class="progress-pill mono"><i></i><span></span></div>
        <div class="warn mono"></div>
        <div class="lock-hint mono">Click to control the camera · <span class="kbd">V</span> mast camera</div>
        <div class="fp-reticle"></div>
        ${device ? `<footer class="mh-keys mono"><span><b class="kbd">W</b><b class="kbd">A</b><b class="kbd">S</b><b class="kbd">D</b> drive</span><span><b class="kbd">Mouse</b> look</span><span><b class="kbd">V</b> view</span><span><b class="kbd">E</b> interact</span><span><b class="kbd">Esc</b> pause</span></footer>` : ''}
        <div class="sample-card panel"></div>
      </section>`);
    this.hud = el;
    this.paintInventory();
    this.paintObjective();
    return el;
  }

  pauseInfo() {
    const facts = Object.values(SAMPLES).flatMap((s) => s.facts);
    return { objective: this.objectiveText()[0], fact: this.phase.startsWith('emergency') ? LINES.stormFact : facts[Math.floor(Math.random() * facts.length)] };
  }

  private objectiveText(): [string, string] {
    switch (this.phase) {
      case 'intro': return ['Stand by', ''];
      case 'explore': return this.collected.length === 0 ? ['Collect the igneous rock sample', 'Follow the channel north'] : ['Collect the hematite-bearing rock', 'Sample 2 of 3'];
      case 'emergency-find': return ['Locate scout rover ARES-7', 'Attach the tow cable'];
      case 'emergency-tow': return ['Tow ARES-7 to the recovery ridge', 'Sunlit high ground'];
      case 'recovery': return ['Recovery in progress', 'Cleaning event'];
      case 'final': return ['Collect the sedimentary rock', 'Layered outcrop · sample 3 of 3'];
      case 'complete': return ['Mission complete', ''];
      case 'failed': return ['Recovery failed', ''];
    }
  }

  private paintObjective() {
    if (!this.hud) return;
    const [t, s] = this.objectiveText();
    const el = $(this.hud, '.obj-text');
    if (el.textContent !== t) {
      if (el.textContent && this.phase !== 'complete') this.app.sfx.objective();
      el.textContent = t;
      const blk = $(this.hud, '.obj-block');
      blk.classList.remove('new');
      void blk.offsetWidth;
      blk.classList.add('new');
    }
    $(this.hud, '.obj-sub').textContent = s;
  }

  private paintInventory() {
    if (!this.hud) return;
    // Progress bar: the three rocks to collect. It only ever talks about samples (no story spoilers).
    const kinds: [SampleKind, string][] = [['igneous', 'Igneous'], ['hematite', 'Hematite'], ['sedimentary', 'Sedimentary']];
    const next = kinds.find(([k]) => !this.collected.includes(k))?.[0];
    $(this.hud, '.sb-count').textContent = `${this.collected.length} / 3`;
    const segs = $(this.hud, '.sb-segs');
    if (!segs.children.length) segs.innerHTML = kinds.map(([, label]) => `<div class="sb-seg"><i></i><span class="mono">${label}</span></div>`).join('');
    kinds.forEach(([k], i) => {
      const seg = segs.children[i];
      seg.classList.toggle('done', this.collected.includes(k)); // fills with a short animation
      seg.classList.toggle('next', k === next);
    });
  }

  private targetPos(): { pos: THREE.Vector3; label: string } | null {
    const st = this.stage!;
    if (!this.targetId || this.locked && this.phase !== 'emergency-find') return null;
    const p = this.pois.get(this.targetId)!;
    if (p.kind === 'ares') return { pos: st.ares.group.position, label: 'ARES-7' };
    if (p.kind === 'zone') return { pos: p.pos, label: 'Recovery ridge' };
    return { pos: p.pos, label: 'Sample site' };
  }

  private paintHud() {
    const st = this.stage!, hud = this.hud!;
    const f = st.forward;
    const heading = (THREE.MathUtils.radToDeg(Math.atan2(f.x, -f.z)) + 360) % 360;
    $(hud, '.spd').textContent = Math.abs(st.speed).toFixed(1);
    $(hud, '.hdg').textContent = `${String(Math.round(heading)).padStart(3, '0')}°`;
    $(hud, '.elev').textContent = Math.round(st.terrain.realElevationAt(st.roverPos.x, st.roverPos.z)).toLocaleString();
    $(hud, '.batt-bar b').style.transform = `scaleX(${this.battery.toFixed(3)})`;
    $(hud, '.batt-v').textContent = `${Math.round(this.battery * 100)}%`;
    hud.classList.toggle('low-batt', this.battery < 0.25);
    $(hud, '.state').textContent = st.towing ? 'TOWING' : this.locked ? 'ARM OPS' : Math.abs(st.speed) > 0.2 ? (st.sandiness > 0.5 ? 'DRIVING · SAND' : 'DRIVING') : 'IDLE';
    const timerEl = $(hud, '.timer');
    timerEl.hidden = this.timer === null;
    if (this.timer !== null) {
      $(timerEl, 'b').textContent = fmtTime(this.timer);
      timerEl.classList.toggle('critical', this.timer < 30);
    }
    hud.style.setProperty('--storm', Math.max(st.storm, st.stormFront * 0.25).toFixed(3));

    // compass strip
    const marks: string[] = [];
    for (const [deg, label] of [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']] as const) {
      const rel = ((deg - heading + 540) % 360) - 180;
      if (Math.abs(rel) < 75) marks.push(`<span class="${label.length === 1 ? 'major' : ''}" style="left:${50 + rel * 0.65}%">${label}</span>`);
    }
    for (let d = 0; d < 360; d += 15) {
      const rel = ((d - heading + 540) % 360) - 180;
      if (Math.abs(rel) < 75 && d % 45) marks.push(`<i style="left:${50 + rel * 0.65}%"></i>`);
    }
    const tp = this.targetPos();
    if (tp) {
      const tdeg = (THREE.MathUtils.radToDeg(Math.atan2(tp.pos.x - st.roverPos.x, -(tp.pos.z - st.roverPos.z))) + 360) % 360;
      const rel = THREE.MathUtils.clamp(((tdeg - heading + 540) % 360) - 180, -75, 75);
      marks.push(`<em style="left:${50 + rel * 0.65}%">◆</em>`);
    }
    $(hud, '.compass-strip').innerHTML = marks.join('');

    // COD-style waypoint marker (clamped to screen edges, arrow when off-screen)
    const wp = $(hud, '.wp');
    wp.classList.toggle('show', !!tp && !st.inCutscene);
    if (tp) {
      const world = tp.pos.clone().add(new THREE.Vector3(0, 2.4, 0));
      const s = st.toScreen(world);
      let x = s.x, y = s.y;
      const off = s.behind || x < 0.04 || x > 0.96 || y < 0.08 || y > 0.9;
      if (s.behind) { x = 1 - x; y = 0.9; }
      x = THREE.MathUtils.clamp(x, 0.05, 0.95); y = THREE.MathUtils.clamp(y, 0.1, 0.88);
      wp.style.transform = `translate(${(x * window.innerWidth).toFixed(1)}px, ${(y * window.innerHeight).toFixed(1)}px)`;
      wp.classList.toggle('offscreen', off);
      $(wp, '.wp-label').textContent = tp.label;
      $(wp, '.wp-dist').textContent = `${Math.round(this.distTo(tp.pos))} m`;
      if (off) $(wp, '.wp-arrow').style.transform = `rotate(${Math.atan2(y - 0.5, x - 0.5)}rad)`;
    }
    // While towing, keep a small tag on ARES-7 so the player sees the convoy
    const aw = $(hud, '.ares-wp');
    const showAres = (this.phase === 'emergency-tow') && !st.inCutscene;
    aw.classList.toggle('show', showAres);
    if (showAres) {
      const s = st.toScreen(st.ares.group.position.clone().add(new THREE.Vector3(0, 2.6, 0)));
      aw.classList.toggle('hidden', s.behind);
      aw.style.transform = `translate(${(s.x * window.innerWidth).toFixed(1)}px, ${(s.y * window.innerHeight).toFixed(1)}px)`;
    }

    const action = this.currentAction();
    hud.classList.toggle('can-act', !!action);
    if (action) $(hud, '.prompt b').textContent = action;
    this.drawMinimap();
  }

  private drawMinimap() {
    const st = this.stage!;
    const cv = $<HTMLCanvasElement>(this.hud!, '.minimap canvas');
    const g = cv.getContext('2d')!;
    const W = cv.width, span = 240;
    const size = st.terrain.size;
    g.save();
    g.clearRect(0, 0, W, W);
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#1a0f09';
    g.fillRect(0, 0, W, W);
    const img = this.minimapImg;
    if (img?.width) {
      const px = img.width / size;
      const cx = (st.roverPos.x + size / 2) * px, cz = (st.roverPos.z + size / 2) * px;
      g.drawImage(img, cx - (span / 2) * px, cz - (span / 2) * px, span * px, span * px, 0, 0, W, W);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = `rgba(170,90,45,${0.5 + st.storm * 0.3})`;
      g.fillRect(0, 0, W, W);
      g.globalCompositeOperation = 'source-over';
    }
    const toMap = (p: THREE.Vector3) => [W / 2 + ((p.x - st.roverPos.x) / span) * W, W / 2 + ((p.z - st.roverPos.z) / span) * W];
    const tp = this.targetPos();
    if (tp) {
      let [x, y] = toMap(tp.pos);
      const dx = x - W / 2, dy = y - W / 2, d = Math.hypot(dx, dy), R = W / 2 - 10;
      if (d > R) { x = W / 2 + (dx / d) * R; y = W / 2 + (dy / d) * R; }
      g.fillStyle = '#ffd36a';
      g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillRect(-5, -5, 10, 10); g.restore();
    }
    if (st.ares.group.visible && this.phase !== 'complete') {
      const [x, y] = toMap(st.ares.group.position);
      g.fillStyle = '#ff7a2f';
      g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
    }
    // view cone + rover arrow
    const f = st.forward;
    g.translate(W / 2, W / 2);
    const camAng = Math.atan2(f.x, -f.z) + (st.view === 'fp' ? -st.lookYaw : 0);
    g.rotate(camAng);
    const grd = g.createLinearGradient(0, 0, 0, -60);
    grd.addColorStop(0, 'rgba(255,255,255,0.25)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(-30, -60); g.lineTo(30, -60); g.closePath(); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill();
    g.restore();
  }

  private sendPhone() {
    const st = this.stage!;
    const tp = this.targetPos();
    let bearing: number | null = null, distance: number | null = null;
    if (tp) {
      const ty = Math.atan2(tp.pos.x - st.roverPos.x, tp.pos.z - st.roverPos.z);
      bearing = Math.round(Math.atan2(Math.sin(st.roverYaw - ty), Math.cos(st.roverYaw - ty)) * 100) / 100;
      distance = Math.round(this.distTo(tp.pos));
    }
    this.app.link.hud({
      objective: this.objectiveText()[0],
      battery: Math.round(this.battery * 100) / 100,
      timer: this.timer === null ? null : Math.ceil(this.timer),
      bearing, distance,
      prompt: this.currentAction(),
      alert: this.phase === 'emergency-find' || this.phase === 'emergency-tow',
    });
  }

  private notify(text: string) {
    const n = $(this.hud!, '.notify');
    n.textContent = text;
    n.classList.remove('show');
    void n.offsetWidth;
    n.classList.add('show');
  }
  private flashWarning(text: string) {
    const w = $(this.hud!, '.warn');
    w.textContent = `⚠ ${text}`;
    w.classList.remove('show');
    void w.offsetWidth;
    w.classList.add('show');
  }
  private showProgress(text: string) {
    const p = $(this.hud!, '.progress-pill');
    $(p, 'span').textContent = text;
    p.classList.add('show');
  }
  private hideProgress() {
    $(this.hud!, '.progress-pill').classList.remove('show');
  }

  private showSampleCard(kind: SampleKind) {
    const s = SAMPLES[kind];
    const card = $(this.hud!, '.sample-card');
    card.innerHTML = `
      <img src="${s.image}" alt="">
      <div class="sc-body">
        <div class="eyebrow">${s.tag} · collected</div>
        <h3>${escapeHtml(s.name)}</h3>
        <ul>${s.facts.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
        <p class="sc-cap">${escapeHtml(s.imageCaption)}</p>
        <span class="tag simplified">Simulated sample inspired by real NASA discoveries</span>
      </div>`;
    card.classList.remove('show');
    void card.offsetWidth;
    card.classList.add('show');
    clearTimeout((card as unknown as { _t: number })._t);
    (card as unknown as { _t: number })._t = window.setTimeout(() => card.classList.remove('show'), 9000);
  }

  // ─────────────────────────────────────────── report
  private showReport() {
    const { app } = this;
    const st = this.stage!;
    app.input.pointerEnabled = false;
    app.input.releasePointer();
    app.link.send({ t: 'layout', layout: 'lobby', title: 'Mission 02 complete', subtitle: 'Expedition report on the main screen' });
    const mins = (performance.now() - this.startTime) / 60000;
    const realHours = st.distance / 1000 / 0.152;
    const cards = (['igneous', 'hematite', 'sedimentary'] as SampleKind[]).map((k, i) => {
      const s = SAMPLES[k];
      return `<figure class="fade-up" style="animation-delay:${0.15 + i * 0.12}s"><img src="${s.image}" alt=""><figcaption><span class="mono">${s.tag}</span><b>${escapeHtml(s.name)}</b><p>${escapeHtml(s.facts[2] ?? s.facts[0])}</p><small>${escapeHtml(s.imageCaption)}</small></figcaption></figure>`;
    }).join('');
    const jupiterReady = app.missionAvailable('jupiter');
    const el = html(`
      <section class="report">
        <div class="report-inner">
          <div class="eyebrow">Mission 02 complete · Expedition report</div>
          <h2>Red Planet Expedition</h2>
          <div class="report-stats mono">
            <div><span>Samples cached</span><b>3 / 3</b></div>
            <div><span>Distance driven</span><b>${Math.round(st.distance)} m</b></div>
            <div><span>Mission time</span><b>${mins.toFixed(1)} min</b></div>
            <div><span>Same drive at real rover speed</span><b>≈ ${realHours.toFixed(1)} hours</b></div>
          </div>
          <div class="report-figs">${cards}</div>
          <div class="report-row">
            <figure class="tube panel"><img src="${SAMPLE_TUBE.image}" alt=""><figcaption>${escapeHtml(SAMPLE_TUBE.caption)}</figcaption></figure>
            <div class="jwst panel"><div class="eyebrow" style="color:var(--c-orange)">ARES-7 rescue · fictional scenario</div><p>The ARES-7 emergency and the tow are simulated. They are inspired by a real problem: dust storms and dust on solar panels ended the missions of NASA’s solar-powered Spirit and Opportunity rovers, while wind “cleaning events” revived them several times. Perseverance avoids this with a nuclear power source (MMRTG).</p></div>
          </div>
          <p class="report-src mono">Terrain: HiRISE DTM DTEEC_048842_1985_048908_1985 (NASA/JPL/UArizona, USGS) · relief exaggerated ×2.2 · imagery: NASA/JPL-Caltech, ASU, MSSS, Cornell</p>
          <div class="report-actions">
            <button class="btn primary to-select">Mission select</button>
            ${jupiterReady ? '<button class="btn next">Mission 01: Jupiter</button>' : ''}
            <button class="btn ghost replay">Replay mission</button>
          </div>
        </div>
      </section>`);
    void app.screens.show(el);
    app.sfx.success();
    const exit = (e: MissionExit) => { app.sfx.click(); this.finish(e); };
    $(el, '.to-select').addEventListener('click', () => exit({ to: 'select' }));
    el.querySelector('.next')?.addEventListener('click', () => exit({ to: 'mission', id: 'jupiter' }));
    $(el, '.replay').addEventListener('click', () => exit({ to: 'restart' }));
  }
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const typeHtml = (s: string) => [...s].map((c, i) => `<span style="animation-delay:${(i * 0.035).toFixed(3)}s">${c === ' ' ? '&nbsp;' : escapeHtml(c)}</span>`).join('');
