import * as THREE from 'three';
import './mars.css';
import type { App } from '../../app/App';
import type { Mission, MissionExit } from '../types';
import { MarsStage, MAX_SPEED } from './MarsStage';
import { SAMPLES, SAMPLE_TUBE, BRIEF_SPECS, briefingLines, LINES, type SampleKind } from './script';
import { html, $, wait, escapeHtml } from '../../ui/dom';

type Phase = 'explore' | 'emergency-find' | 'emergency-lead' | 'recovery' | 'final' | 'complete' | 'failed';

interface Poi { id: string; pos: THREE.Vector3; kind: 'sample' | 'ares' | 'zone'; sample?: SampleKind; label: string; color: string }

const EMERGENCY_SECONDS = 150;
const INTERACT_RANGE = 7;
const ZONE_RADIUS = 13;
const JEZERO = { lat: 18.38, lon: 77.58 };

// Points of interest on the 768-px Jezero grid (chosen from the HiRISE hillshade), snapped to flat ground at runtime.
const GRID = { start: [470, 655], s1: [452, 618], s2: [392, 606], ares: [356, 536], zone: [430, 486], s3: [452, 470] };

/**
 * Mission 02: Perseverance-class rover in Jezero Crater.
 * Explore → (after 2 samples) fictional ARES-7 dust-storm emergency → recovery → final sample.
 */
export class MarsMission implements Mission {
  private stage: MarsStage | null = null;
  private hud: HTMLElement | null = null;
  private paused = false;
  private disposed = false;
  private disposers: (() => void)[] = [];
  private finish!: (e: MissionExit) => void;

  private phase: Phase = 'explore';
  private pois = new Map<string, Poi>();
  private targetId: string | null = null;
  private collected: SampleKind[] = [];
  private battery = 1;
  private timer: number | null = null;
  private locked = false; // controls locked during cutscenes
  private aresLinked = false;
  private breadcrumbs: THREE.Vector3[] = [];
  private snapshot: { pos: THREE.Vector3; yaw: number; battery: number } | null = null;
  private startTime = 0;
  private lastSteepWarn = 0;
  private saidSpeedNote = false;
  private saidStormFacts = false;
  private minimapImg: CanvasImageSource | null = null;

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
  }

  dispose() {
    this.disposed = true;
    this.disposers.forEach((d) => d());
    this.disposers = [];
    this.hud?.remove();
    this.app.space.showModel(null);
    this.app.sfx.setWind(0);
    if (this.stage) {
      this.stage.dispose();
      this.stage = null;
    }
  }

  private async flow() {
    const go = await this.briefing();
    if (this.disposed) return;
    if (!go) return this.finish({ to: 'select' });
    await this.descend();
    if (this.disposed) return;
    this.startTime = performance.now();
    this.setTarget('s1');
    void this.app.commander.say(LINES.start, { interrupt: true });
  }

  // ─────────────────────────────────────────── briefing (Mars globe, Jezero marker)
  private briefing(): Promise<boolean> {
    const { app } = this;
    app.engine.setStage(app.space);
    app.space.setShot('briefing', 0.7);

    const globe = new THREE.Group();
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshStandardMaterial({ map: app.assets.textures.mars ?? null, roughness: 1, color: app.assets.textures.mars ? 0xffffff : 0xb05a30 }));
    globe.add(sphere);
    const u = (JEZERO.lon + 180) / 360, v = (90 - JEZERO.lat) / 180;
    const phi = u * Math.PI * 2, theta = v * Math.PI;
    const dir = new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
    const marker = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.05, 32), new THREE.MeshBasicMaterial({ color: 0x4fd8ff, side: THREE.DoubleSide, toneMapped: false }));
    marker.position.copy(dir.clone().multiplyScalar(1.004));
    marker.lookAt(dir.clone().multiplyScalar(2));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    dot.position.copy(dir.clone().multiplyScalar(1.005));
    dot.lookAt(dir.clone().multiplyScalar(2));
    globe.add(marker, dot);
    // aim slightly off-centre so Jezero sits in view with the limb visible
    app.space.showModel(globe, 6.5, { spin: false, faceDir: dir.clone().add(new THREE.Vector3(0.35, 0.15, 0)).normalize() });
    app.link.send({ t: 'layout', layout: 'lobby', title: 'Mission 02 · Briefing', subtitle: 'Tap Skip to jump ahead' });

    const specs = BRIEF_SPECS.map(([k, val]) => `<div><span>${k}</span><b>${val}</b></div>`).join('');
    const el = html(`
      <section class="briefing">
        <div class="brief-panel panel brackets fade-up">
          <div class="eyebrow">Mission 02 · Briefing</div>
          <h2>Red Planet Expedition</h2>
          <p class="brief-lead">Pilot a <b>Perseverance-class rover</b> across the real terrain of Jezero Crater’s ancient river delta and collect three geological samples.</p>
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
      const done = (go: boolean) => {
        off();
        app.commander.clear();
        app.sfx[go ? 'confirm' : 'back']();
        resolve(go);
      };
      $(el, '.go').addEventListener('click', () => done(true));
      $(el, '.abort').addEventListener('click', () => done(false));
      const off = app.input.onPress((id) => {
        if (!this.paused && (id === 'confirm' || id === 'primary')) done(true);
      });
      this.disposers.push(off);
    });
  }

  // ─────────────────────────────────────────── descent + world setup
  private async descend() {
    const { app } = this;
    const boot = html(`<section class="scope-boot mars-boot"><div class="boot-lines mono"></div></section>`);
    void app.screens.show(boot);
    app.space.setShot('depart', 0.9);
    const box = $(boot, '.boot-lines');
    const say = async (l: string, ms = 420) => { box.appendChild(html(`<div class="fade-up">› ${l}</div>`)); app.sfx.blip(); await wait(ms); };
    await say('ATMOSPHERIC ENTRY · SIMULATED');
    await say('LOADING TERRAIN · HiRISE DTM · JEZERO DELTA FRONT', 60);
    await wait(50);

    this.stage = new MarsStage(app.assets, app.engine.renderer, app.quality);
    const st = this.stage;
    st.resize(window.innerWidth, window.innerHeight);
    this.buildPois();
    const start = this.pois.get('start')!.pos;
    const first = this.pois.get('s1')!.pos;
    st.placeRover(start, Math.atan2(first.x - start.x, first.z - start.z));
    st.update(0.016);
    st.render(); // compile shaders while the boot text is up

    await say('SKY CRANE · TOUCHDOWN CONFIRMED');
    await say('ROVER SYSTEMS NOMINAL', 500);
    app.space.showModel(null);
    app.engine.setStage(st);
    app.sfx.setAmbience('mars');
    app.input.pointerEnabled = true;

    const ortho = app.assets.textures.jezeroOrtho?.image as CanvasImageSource | undefined;
    this.minimapImg = ortho ?? null;
    this.hud = this.buildHud();
    await app.screens.show(this.hud);
    app.link.send({ t: 'layout', layout: 'mars', title: 'Drive to the cyan marker' });

    this.disposers.push(
      app.engine.onTick((dt) => this.tick(dt)),
      app.input.onPress((id) => {
        if (this.paused) return;
        if (id === 'interact' || id === 'primary') void this.interact();
      }),
      () => (app.input.pointerEnabled = false),
    );
  }

  private buildPois() {
    const st = this.stage!;
    const at = (k: keyof typeof GRID, r = 14) => st.findFlat(st.terrain.pixelToWorld(GRID[k][0], GRID[k][1]), r);
    const add = (p: Poi) => this.pois.set(p.id, p);
    add({ id: 'start', pos: at('start'), kind: 'zone', label: 'Start', color: '#fff' });
    add({ id: 's1', pos: at('s1'), kind: 'sample', sample: 'igneous', label: 'Sample 1', color: '#4fd8ff' });
    add({ id: 's2', pos: at('s2'), kind: 'sample', sample: 'hematite', label: 'Sample 2', color: '#4fd8ff' });
    add({ id: 'ares', pos: at('ares', 10), kind: 'ares', label: 'ARES-7', color: '#ff7a2f' });
    add({ id: 'zone', pos: at('zone', 18), kind: 'zone', label: 'Recovery ridge', color: '#5dffa8' });
    add({ id: 's3', pos: at('s3', 12), kind: 'sample', sample: 'sedimentary', label: 'Sample 3', color: '#4fd8ff' });
    st.addSpecimen('s1', 'igneous', this.pois.get('s1')!.pos);
    st.addSpecimen('s2', 'hematite', this.pois.get('s2')!.pos);
  }

  private setTarget(id: string | null) {
    const st = this.stage!;
    if (this.targetId && this.targetId !== 'zone') st.removeBeacon(this.targetId);
    this.targetId = id;
    if (!id) return;
    const p = this.pois.get(id)!;
    const color = p.kind === 'ares' ? 0xff7a2f : p.kind === 'zone' ? 0x5dffa8 : 0x4fd8ff;
    st.addBeacon(id, p.pos, color, p.kind === 'zone' ? ZONE_RADIUS : 2.6);
    this.paintObjective();
  }

  // ─────────────────────────────────────────── interaction
  private distTo(id: string) {
    const p = this.pois.get(id);
    if (!p || !this.stage) return Infinity;
    const r = this.stage.roverPos;
    return Math.hypot(p.pos.x - r.x, p.pos.z - r.z);
  }

  /** What the interact button does right now (null = nothing). */
  private currentAction(): string | null {
    if (this.locked || !this.targetId) return null;
    const p = this.pois.get(this.targetId)!;
    if (p.kind === 'sample' && this.distTo(p.id) < INTERACT_RANGE) return 'COLLECT SAMPLE';
    if (p.kind === 'ares' && !this.aresLinked && this.aresDist() < INTERACT_RANGE + 1) return 'LINK ARES-7';
    return null;
  }

  private aresDist() {
    const st = this.stage!;
    const a = st.ares.group.position;
    return Math.hypot(a.x - st.roverPos.x, a.z - st.roverPos.z);
  }

  private async interact() {
    const action = this.currentAction();
    if (!action || !this.stage) return;
    const st = this.stage;
    if (action === 'COLLECT SAMPLE') {
      const poi = this.pois.get(this.targetId!)!;
      this.locked = true;
      st.speed = 0;
      st.removeBeacon(poi.id); // clear the light beam so the arm is visible
      this.app.sfx.servo(1.2);
      this.app.link.buzz([20, 40, 20, 40, 20]);
      this.showProgress('Robotic arm deploying · coring sample');
      await st.playArm(4.5);
      if (this.disposed) return;
      this.app.sfx.servo(0.8);
      st.removeSpecimen(poi.id);
      st.removeBeacon(poi.id);
      this.targetId = null;
      this.hideProgress();
      this.collect(poi.sample!);
      this.locked = false;
    } else if (action === 'LINK ARES-7') {
      this.locked = true;
      st.speed = 0;
      this.showProgress('Linking navigation · ARES-7');
      this.app.sfx.blip();
      await wait(1600);
      if (this.disposed) return;
      this.hideProgress();
      this.app.sfx.linked();
      this.aresLinked = true;
      this.breadcrumbs = [st.roverPos.clone()];
      st.removeBeacon('ares');
      this.phase = 'emergency-lead';
      this.setTarget('zone');
      this.locked = false;
      void this.app.commander.say(LINES.linked, { interrupt: true });
    }
  }

  private collect(kind: SampleKind) {
    const info = SAMPLES[kind];
    this.collected.push(kind);
    this.app.sfx.success();
    this.app.link.buzz([40, 60, 40]);
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
    this.app.sfx.alarm(3);
    this.app.link.buzz([200, 100, 200, 100, 200]);
    this.hud!.classList.add('alert');
    const ares = this.pois.get('ares')!;
    st.ares.group.position.copy(ares.pos);
    st.ares.group.rotation.y = 0.8;
    st.ares.group.visible = true;
    st.ares.setDust(1);
    this.setTarget('ares');
    this.timer = EMERGENCY_SECONDS;
    this.battery = Math.min(this.battery, 0.82);
    this.snapshot = { pos: st.roverPos.clone(), yaw: st.roverYaw, battery: this.battery };
    this.paintObjective();
    await this.app.commander.say(LINES.emergency, { interrupt: true });
  }

  private async recover() {
    const st = this.stage!;
    this.phase = 'recovery';
    this.timer = null;
    st.removeBeacon('zone');
    this.hud!.classList.remove('alert');
    this.paintObjective();
    this.app.sfx.confirm();
    const lines = this.app.commander.say(LINES.recovering, { interrupt: true });
    // Cinematic: orbit ARES-7 while a wind gust clears its panels and the storm subsides.
    this.locked = true;
    st.focus = st.ares.group.position.clone();
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const off = this.app.engine.onTick(() => {
        const k = Math.min(1, (performance.now() - t0) / 9000);
        st.ares.setDust(1 - THREE.MathUtils.smoothstep(k, 0.1, 0.75));
        st.storm = Math.min(st.storm, 1 - k);
        if (k >= 1) { off(); resolve(); }
      });
    });
    if (this.disposed) return;
    this.app.sfx.success();
    this.app.link.buzz([40, 60, 40]);
    await lines;
    st.focus = null;
    this.locked = false;
    await this.app.commander.say(LINES.restored);
    if (this.disposed) return;
    this.phase = 'final';
    st.addSpecimen('s3', 'sedimentary', this.pois.get('s3')!.pos);
    this.setTarget('s3');
    void this.app.commander.say(LINES.sample3);
  }

  private fail() {
    if (this.phase === 'failed') return;
    this.phase = 'failed';
    this.locked = true;
    this.app.sfx.error();
    this.app.link.buzz([300, 100, 300]);
    void this.app.commander.say({ text: LINES.fail, mood: 'alert' }, { interrupt: true });
    const ov = html(`
      <div class="mars-fail interactive">
        <div class="panel brackets">
          <div class="eyebrow" style="color:var(--c-orange)">Reserves critical</div>
          <h2>Recovery window lost</h2>
          <p>Your rover’s batteries or the time window ran out before ARES-7 reached the ridge. Try a shorter route: the green beacon shows the recovery ridge.</p>
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
    st.placeRover(s.pos, s.yaw);
    this.battery = s.battery;
    this.timer = EMERGENCY_SECONDS;
    this.aresLinked = false;
    st.removeBeacon('zone');
    const ares = this.pois.get('ares')!;
    st.ares.group.position.copy(ares.pos);
    st.ares.setDust(1);
    this.phase = 'emergency-find';
    this.locked = false;
    this.setTarget('ares');
    void this.app.commander.say({ text: 'Retrying. Locate ARES-7, marked in orange.', mood: 'alert' }, { interrupt: true });
  }

  private async complete() {
    if (this.phase === 'complete') return;
    this.phase = 'complete';
    this.locked = true;
    this.paintObjective();
    await this.app.commander.say(LINES.wrap);
    if (this.disposed) return;
    this.showReport();
  }

  // ─────────────────────────────────────────── per frame
  private tick(dt: number) {
    const st = this.stage;
    if (!st || !this.hud || this.paused) return;
    const { input } = this.app;
    const emergency = this.phase === 'emergency-find' || this.phase === 'emergency-lead';

    // Drive
    const l = input.stickL();
    let climb = 0;
    if (!this.locked && this.battery > 0) {
      climb = st.drive(l.y, l.x, dt).climb;
    } else {
      st.drive(0, 0, dt);
    }
    if (st.blocked && performance.now() - this.lastSteepWarn > 6000) {
      this.lastSteepWarn = performance.now();
      this.flashWarning(climb > 20 ? 'SLOPE TOO STEEP' : 'OBSTACLE');
      if (!this.app.commander.busy) void this.app.commander.say(LINES.steep);
    }

    // Camera
    const r = input.stickR();
    const m = input.consumeMouse();
    st.orbit(-r.x * dt * 1.8 - m.dx * 0.005, r.y * dt * 1.2 + m.dy * 0.004, m.wheel);

    // Power: MMRTG trickle-charges; driving draws more than it supplies.
    const load = Math.abs(st.speed) / MAX_SPEED;
    const drain = (emergency ? 0.0045 : 0.0018) * load + (emergency ? 0.0006 : 0.0001);
    const charge = load < 0.05 && !emergency ? 0.0006 : 0;
    this.battery = THREE.MathUtils.clamp(this.battery - drain * dt + charge * dt, 0, 1);

    // Emergency: storm ramps, timer, ARES-7 follow, zone check.
    if (emergency) {
      st.storm = Math.min(1, st.storm + dt / 12);
      this.app.sfx.setWind(st.storm);
      if (this.timer !== null) this.timer = Math.max(0, this.timer - dt);
      if (this.timer === 0 || this.battery <= 0) this.fail();
      if (!this.saidStormFacts && this.timer !== null && this.timer < EMERGENCY_SECONDS - 26 && !this.app.commander.busy) {
        this.saidStormFacts = true;
        void this.app.commander.say([LINES.stormFact, LINES.mmrtg]);
      }
    } else if (this.phase !== 'recovery') {
      this.app.sfx.setWind(st.storm * 0.5);
    }
    if (this.phase === 'emergency-find' && this.aresDist() < 22 && !this.app.commander.busy && !this.hud.dataset.aresHint) {
      this.hud.dataset.aresHint = '1';
      void this.app.commander.say(LINES.aresNear);
    }
    if (this.aresLinked && this.phase === 'emergency-lead') {
      // pull the chase camera back so the convoy (rover + ARES-7 behind it) is in frame
      st.camDist += (Math.max(st.camDist, 19) - st.camDist) * Math.min(1, dt * 1.5);
      st.camPitch += (Math.max(st.camPitch, 0.42) - st.camPitch) * Math.min(1, dt * 1.5);
      this.updateFollow(dt);
      const zone = this.pois.get('zone')!.pos;
      const a = st.ares.group.position;
      if (Math.hypot(a.x - zone.x, a.z - zone.z) < ZONE_RADIUS) void this.recover();
    }
    st.ares.setStatus(this.phase === 'final' || this.phase === 'complete' ? 0x5dffa8 : 0xffaa33, this.phase !== 'final' && this.phase !== 'complete', performance.now() / 1000);

    if (!this.saidSpeedNote && st.distance > 40 && !this.app.commander.busy && this.phase === 'explore') {
      this.saidSpeedNote = true;
      void this.app.commander.say(LINES.speedNote);
    }

    this.paintHud();
    this.sendPhone();
  }

  /** ARES-7 follows the rover's own path ~8 m behind (no pathfinding needed). */
  private updateFollow(dt: number) {
    const st = this.stage!;
    const p = st.roverPos;
    const last = this.breadcrumbs[this.breadcrumbs.length - 1];
    if (!last || last.distanceTo(p) > 1.2) this.breadcrumbs.push(p.clone());
    if (this.breadcrumbs.length > 600) this.breadcrumbs.shift();
    let acc = 0, target = this.breadcrumbs[0];
    for (let i = this.breadcrumbs.length - 1; i > 0; i--) {
      acc += this.breadcrumbs[i].distanceTo(this.breadcrumbs[i - 1]);
      if (acc >= 8) { target = this.breadcrumbs[i - 1]; break; }
    }
    const far = this.aresDist() > 20;
    st.moveAres(target, dt, MAX_SPEED * (far ? 1.4 : 1.05));
  }

  // ─────────────────────────────────────────── HUD
  private buildHud() {
    const device = this.app.mode === 'device';
    const el = html(`
      <section class="mhud passthrough">
        <div class="storm-veil"></div>
        <header class="mh-top">
          <div class="mh-id">
            <div class="eyebrow">Perseverance-class rover · simulation</div>
            <div class="mh-name">JEZERO CRATER · MARS</div>
            <div class="mh-state mono"><i></i><span>Systems nominal</span></div>
          </div>
          <div class="mh-center">
            <div class="mh-obj"></div>
            <div class="compass mono"><div class="compass-strip"></div><b class="compass-needle"></b></div>
          </div>
          <div class="mh-power panel">
            <div class="eyebrow">Battery</div>
            <div class="batt-row"><div class="batt-bar"><b></b></div><span class="mono batt-v">100%</span></div>
            <div class="mono pwr-src">MMRTG · 110 W</div>
            <div class="timer mono" hidden><span>RECOVERY WINDOW</span><b>2:30</b></div>
          </div>
        </header>
        <div class="alert-banner mono"><b>⚠ PRIORITY TRANSMISSION</b><span>Dust storm · scout rover ARES-7 without power</span><em>Simulated incident</em></div>
        <aside class="mh-left panel mono">
          <div class="tele"><label>Speed</label><b class="spd">0.0</b><span>m/s</span></div>
          <div class="tele"><label>Heading</label><b class="hdg">000°</b></div>
          <div class="tele"><label>Elevation (real)</label><b class="elev">-</b><span>m</span></div>
          <div class="tele"><label>Odometer</label><b class="odo">0</b><span>m</span></div>
          <div class="tele-note">Real Perseverance top speed ≈ 0.04 m/s</div>
        </aside>
        <aside class="mh-right">
          <div class="minimap panel"><canvas width="200" height="200"></canvas><div class="mm-cap mono">HiRISE · north up</div></div>
          <div class="inventory panel">
            <div class="eyebrow">Sample cache</div>
            <div class="slots"></div>
          </div>
        </aside>
        <div class="prompt mono"><span class="kbd">${device ? 'E' : '●'}</span><b></b></div>
        <div class="progress-pill mono"><i></i><span></span></div>
        <div class="warn mono"></div>
        ${device ? `<footer class="mh-keys mono"><span><b class="kbd">W</b><b class="kbd">A</b><b class="kbd">S</b><b class="kbd">D</b> drive</span><span><b class="kbd">Drag</b> look</span><span><b class="kbd">Wheel</b> distance</span><span><b class="kbd">E</b> interact</span><span><b class="kbd">Esc</b> pause</span></footer>` : ''}
        <div class="sample-card panel"></div>
      </section>`);
    this.hud = el;
    this.paintInventory();
    this.paintObjective();
    return el;
  }

  private objectiveText() {
    switch (this.phase) {
      case 'explore': return this.collected.length === 0 ? 'Collect sample 1 · Igneous rock' : 'Collect sample 2 · Hematite-bearing rock';
      case 'emergency-find': return 'EMERGENCY · Locate scout rover ARES-7';
      case 'emergency-lead': return 'EMERGENCY · Lead ARES-7 to the recovery ridge';
      case 'recovery': return 'Recovery in progress · cleaning event';
      case 'final': return 'Collect sample 3 · Sedimentary rock';
      case 'complete': return 'Mission complete';
      case 'failed': return 'Recovery failed';
    }
  }

  private paintObjective() {
    if (!this.hud) return;
    $(this.hud, '.mh-obj').textContent = this.objectiveText();
  }

  private paintInventory() {
    if (!this.hud) return;
    const kinds: SampleKind[] = ['igneous', 'hematite', 'sedimentary'];
    $(this.hud, '.slots').innerHTML = kinds.map((k, i) => {
      const got = this.collected.includes(k);
      return `<div class="slot ${got ? 'full' : ''}"><i>${i + 1}</i><span>${got ? escapeHtml(SAMPLES[k].name) : 'Empty tube'}</span></div>`;
    }).join('');
  }

  private paintHud() {
    const st = this.stage!, hud = this.hud!;
    const f = st.forward;
    const heading = (THREE.MathUtils.radToDeg(Math.atan2(f.x, -f.z)) + 360) % 360;
    $(hud, '.spd').textContent = Math.abs(st.speed).toFixed(1);
    $(hud, '.hdg').textContent = `${String(Math.round(heading)).padStart(3, '0')}°`;
    $(hud, '.elev').textContent = Math.round(st.terrain.realElevationAt(st.roverPos.x, st.roverPos.z)).toLocaleString();
    $(hud, '.odo').textContent = Math.round(st.distance).toLocaleString();
    const b = Math.round(this.battery * 100);
    $(hud, '.batt-bar b').style.transform = `scaleX(${this.battery.toFixed(3)})`;
    $(hud, '.batt-v').textContent = `${b}%`;
    hud.classList.toggle('low-batt', this.battery < 0.25);
    const timerEl = $(hud, '.timer');
    timerEl.hidden = this.timer === null;
    if (this.timer !== null) {
      $(timerEl, 'b').textContent = fmtTime(this.timer);
      timerEl.classList.toggle('critical', this.timer < 30);
    }
    $(hud, '.mh-state span').textContent = this.locked ? 'Arm operations' : Math.abs(st.speed) > 0.2 ? 'Driving' : 'Idle';
    hud.style.setProperty('--storm', st.storm.toFixed(3));

    // compass strip
    const strip = $(hud, '.compass-strip');
    const marks: string[] = [];
    for (const [deg, label] of [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']] as const) {
      const rel = ((deg - heading + 540) % 360) - 180;
      if (Math.abs(rel) < 80) marks.push(`<span class="${label.length === 1 ? 'major' : ''}" style="left:${50 + rel * 0.6}%">${label}</span>`);
    }
    const tp = this.targetPoi();
    if (tp) {
      const tdeg = (THREE.MathUtils.radToDeg(Math.atan2(tp.pos.x - st.roverPos.x, -(tp.pos.z - st.roverPos.z))) + 360) % 360;
      const rel = THREE.MathUtils.clamp(((tdeg - heading + 540) % 360) - 180, -80, 80);
      marks.push(`<em style="left:${50 + rel * 0.6}%;color:${tp.color}">◆ ${this.trackDist(tp).toFixed(0)} m</em>`);
    }
    strip.innerHTML = marks.join('');

    // prompt
    const action = this.currentAction();
    hud.classList.toggle('can-act', !!action);
    if (action) $(hud, '.prompt b').textContent = action;

    this.drawMinimap();
  }

  private targetPoi() {
    if (this.phase === 'emergency-find') {
      const p = this.pois.get('ares')!;
      return { ...p, pos: this.stage!.ares.group.position };
    }
    return this.targetId ? this.pois.get(this.targetId) ?? null : null;
  }
  private trackDist(p: { pos: THREE.Vector3 }) {
    const r = this.stage!.roverPos;
    return Math.hypot(p.pos.x - r.x, p.pos.z - r.z);
  }

  private drawMinimap() {
    const st = this.stage!;
    const cv = $<HTMLCanvasElement>(this.hud!, '.minimap canvas');
    const g = cv.getContext('2d')!;
    const W = cv.width, span = 420; // metres shown
    const size = st.terrain.size;
    g.fillStyle = '#1a0f09';
    g.fillRect(0, 0, W, W);
    const img = this.minimapImg as HTMLImageElement | null;
    if (img && (img as HTMLImageElement).width) {
      const px = img.width / size;
      const cx = (st.roverPos.x + size / 2) * px, cz = (st.roverPos.z + size / 2) * px;
      g.globalAlpha = 0.95;
      g.drawImage(img, cx - (span / 2) * px, cz - (span / 2) * px, span * px, span * px, 0, 0, W, W);
      g.globalAlpha = 1;
      g.fillStyle = `rgba(150,70,30,${0.28 + st.storm * 0.4})`;
      g.globalCompositeOperation = 'multiply';
      g.fillRect(0, 0, W, W);
      g.globalCompositeOperation = 'source-over';
    }
    const toMap = (p: THREE.Vector3) => [W / 2 + ((p.x - st.roverPos.x) / span) * W, W / 2 + ((p.z - st.roverPos.z) / span) * W];
    const tp = this.targetPoi();
    const dots: { pos: THREE.Vector3; color: string }[] = [];
    if (tp) dots.push(tp);
    if (this.aresLinked || this.phase === 'emergency-find') dots.push({ pos: st.ares.group.position, color: '#ff7a2f' });
    if (this.phase === 'emergency-lead') { const z = this.pois.get('zone')!; dots.push(z); }
    for (const d of dots) {
      let [x, y] = toMap(d.pos);
      x = THREE.MathUtils.clamp(x, 6, W - 6); y = THREE.MathUtils.clamp(y, 6, W - 6);
      g.fillStyle = d.color;
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
    }
    // rover arrow
    const f = st.forward;
    g.save();
    g.translate(W / 2, W / 2);
    g.rotate(Math.atan2(f.x, -f.z));
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(0, 3); g.lineTo(-5.5, 6); g.closePath(); g.fill();
    g.restore();
  }

  private sendPhone() {
    const st = this.stage!;
    const tp = this.targetPoi();
    let bearing: number | null = null, distance: number | null = null;
    if (tp) {
      const ty = Math.atan2(tp.pos.x - st.roverPos.x, tp.pos.z - st.roverPos.z);
      bearing = Math.round(Math.atan2(Math.sin(st.roverYaw - ty), Math.cos(st.roverYaw - ty)) * 100) / 100;
      distance = Math.round(this.trackDist(tp));
    }
    const action = this.currentAction();
    this.app.link.hud({
      objective: this.objectiveText(),
      battery: Math.round(this.battery * 100) / 100,
      timer: this.timer === null ? null : Math.ceil(this.timer),
      bearing, distance,
      prompt: action,
      alert: this.phase === 'emergency-find' || this.phase === 'emergency-lead',
    });
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
            <div class="jwst panel"><div class="eyebrow" style="color:var(--c-orange)">ARES-7 rescue · fictional scenario</div><p>The ARES-7 emergency is a simulated incident. It is inspired by a real problem: dust storms and dust on solar panels ended the missions of NASA’s solar-powered Spirit and Opportunity rovers, while wind “cleaning events” revived them several times. Perseverance avoids this with a nuclear power source (MMRTG).</p></div>
          </div>
          <p class="report-src mono">Terrain: HiRISE DTM DTEEC_048842_1985_048908_1985 (NASA/JPL/UArizona, USGS) · relief ×1.5 · imagery: NASA/JPL-Caltech, ASU, MSSS, Cornell</p>
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
