import * as THREE from 'three';
import '../mars/mars.css'; // shared cinematic pieces (cover, location card, progress pill)
import './iss.css';
import type { App } from '../../app/App';
import type { Mission, MissionExit } from '../types';
import { ISSStage } from './ISSStage';
import { ISS_SPECS, briefingLines, L, CHOICES, CONNECTORS, FACTS, type Choice } from './script';
import { html, $, escapeHtml } from '../../ui/dom';
import type { CommanderLine } from '../../core/Commander';


/**
 * Mission 03 · Orbital Maintenance. The player is the spacewalk officer in Mission Control, guiding an
 * astronaut who is already outside the station, through their helmet camera: every step is a call the
 * astronaut acts out (tether, Canadarm2 ride into an orbital sunrise, the battery swap), then a dramatised
 * debris storm (based on the real November 2021 event) that the astronaut rides out on the truss. The
 * mission ends with a pull-out from the ISS to orbit.
 */
export class ISSMission implements Mission {
  private stage: ISSStage | null = null;
  private hud: HTMLElement | null = null;
  private paused = false;
  private disposed = false;
  private disposers: (() => void)[] = [];
  private finish!: (e: MissionExit) => void;
  private evaStart = 0;
  private evaPausedMs = 0;
  private pausedAt = 0;
  private decisions = { total: 0, firstTry: 0 };
  private stress = 0;
  private heart = 72;
  private objective = '';
  private choiceResolver: ((i: number) => void) | null = null;
  private choiceCount = 0;
  private actionResolver: (() => void) | null = null;
  /** When the look input last came from a stick (phone pad / arrow keys); mouse movement after this takes over. */
  private stickAt = 0;
  private aim = false;

  constructor(private app: App) {}

  start(): Promise<MissionExit> {
    const exit = new Promise<MissionExit>((r) => (this.finish = r));
    void this.flow().catch((e) => { if (!this.disposed) throw e; });
    return exit;
  }
  abort(exit: MissionExit) { this.finish(exit); }
  pauseInfo() {
    const f = FACTS[Math.floor(Math.random() * FACTS.length)];
    return { objective: this.objective || 'Prepare for the spacewalk', fact: `${f[1]}` };
  }
  setPaused(p: boolean) {
    this.paused = p;
    if (this.stage) this.stage.paused = p;
    this.setAim(!p && this.aim);
    if (p) this.pausedAt = performance.now();
    else if (this.pausedAt) { this.evaPausedMs += performance.now() - this.pausedAt; this.pausedAt = 0; }
    this.app.sfx.suit(!p && !!this.stage, this.stress);
  }
  dispose() {
    this.disposed = true;
    this.disposers.forEach((d) => d());
    this.disposers = [];
    this.setAim(false);
    this.app.sfx.suit(false, 0);
    this.app.sfx.stopLoops();
    this.app.sfx.setMuffle(0);
    this.hud?.remove();
    this.hud = null;
    this.app.input.releasePointer();
    this.app.input.lookMode = 'drag';
    this.app.input.pointerEnabled = false;
    this.app.space.showModel(null);
    this.stage?.dispose();
    this.stage = null;
  }

  /** Pause-aware sleep (stops counting while the pause menu is open). */
  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      let left = ms;
      const off = this.app.engine.onTick((dt) => {
        if (this.disposed) { off(); return; }
        if (!this.paused) left -= dt * 1000;
        if (left <= 0) { off(); resolve(); }
      });
    });
  }
  private alive() { if (this.disposed) throw new Error('disposed'); }
  private say(l: string | CommanderLine | (string | CommanderLine)[], interrupt = false) { return this.app.commander.say(l, { interrupt }); }

  private async flow() {
    const go = await this.briefing();
    if (this.disposed) return;
    if (!go) return this.finish({ to: 'select' });
    await this.bootSuit(); this.alive();
    await this.egress(); this.alive();
    await this.translate(); this.alive();
    await this.repair(); this.alive();
    await this.debrisStorm(); this.alive();
    await this.exitCut(); this.alive();
    this.showReport();
  }

  // ─────────────────────────────────────────── briefing (ISS model on the space backdrop)
  private briefing(): Promise<boolean> {
    const { app } = this;
    app.engine.setStage(app.space);
    app.space.setShot('briefing', 0.7);
    // the briefing shows the same NASA high-detail station the spacewalk uses (streams in if not cached yet)
    const hd = app.assets.models.issHd?.scene;
    const lite = app.assets.models.iss?.scene;
    app.space.showModel((hd ?? lite)?.clone(true) ?? null, 5.2);
    let briefingOpen = true;
    app.link.send({ t: 'layout', layout: 'lobby', title: 'Mission 03 · Briefing', subtitle: 'Tap Begin when you are ready', cta: 'Begin spacewalk' });
    const specs = ISS_SPECS.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    const el = html(`
      <section class="briefing">
        <div class="brief-panel panel brackets fade-up">
          <div class="eyebrow">Mission 03 · Briefing</div>
          <h2>Orbital Maintenance</h2>
          <p class="brief-lead">Guide an astronaut on a <b>spacewalk outside the International Space Station</b> through their helmet camera, and replace a failed battery on the station's truss.</p>
          <div class="brief-specs mono">${specs}</div>
          <h4 class="mono">Objectives</h4>
          <ol class="brief-objs">
            <li><span class="mono">1</span>Secure the astronaut at the airlock</li>
            <li><span class="mono">2</span>Reach the P3 battery bank</li>
            <li><span class="mono">3</span>Replace lithium-ion battery 3B</li>
          </ol>
          <div class="brief-actions">
            <button class="btn primary go">Begin spacewalk <span class="kbd">ENTER</span></button>
            <button class="btn ghost abort">Abort</button>
          </div>
          <p class="brief-note mono brief-load">${hd ? 'STATION MODEL · NASA ISS (IGOAL) · READY' : 'STATION MODEL · NASA ISS (IGOAL) · LOADING'}</p>
          <p class="brief-note">Earth imagery: NASA VIIRS (NOAA-20) + Blue Marble Next Generation · ISS model: NASA 3D Resources (IGOAL)</p>
        </div>
        <div class="brief-caption mono fade-up" style="animation-delay:.4s">INTERNATIONAL SPACE STATION · LOW EARTH ORBIT</div>
      </section>`);
    void app.screens.show(el);
    void this.say(briefingLines(app.mode), true);
    if (!hd) {
      const tag = $(el, '.brief-load');
      app.assets.loadModel('issHd', '/models/iss_hd.glb', (f) => (tag.textContent = `STATION MODEL · NASA ISS (IGOAL) · ${Math.round(f * 100)}%`))
        .then((g) => {
          tag.textContent = 'STATION MODEL · NASA ISS (IGOAL) · READY';
          if (briefingOpen && !this.disposed) app.space.showModel(g.scene.clone(true), 5.2);
        })
        .catch(() => (tag.textContent = 'STATION MODEL · OFFLINE COPY'));
    }
    return new Promise((resolve) => {
      const done = (go: boolean) => { briefingOpen = false; off(); app.commander.clear(); app.sfx[go ? 'confirm' : 'back'](); resolve(go); };
      $(el, '.go').addEventListener('click', () => done(true));
      $(el, '.abort').addEventListener('click', () => done(false));
      const off = app.input.onPress((id) => { if (!this.paused && (id === 'confirm' || id === 'primary')) done(true); });
      this.disposers.push(off);
    });
  }

  // ─────────────────────────────────────────── suit boot + build the scene behind a black screen
  private async bootSuit() {
    const { app } = this;
    const cover = html(`<section class="cine-cover black"><div class="cc-lines mono"></div></section>`);
    void app.screens.show(cover);
    app.sfx.setMusic('none');
    app.space.showModel(null);
    const lines = $(cover, '.cc-lines');
    const line = async (t: string, ms = 420) => { const d = html(`<div class="fade-up">${t}</div>`); lines.appendChild(d); app.sfx.typeTick(); app.sfx.blip(); await this.sleep(ms); return d; };
    await line('EMU · EXTRAVEHICULAR MOBILITY UNIT');
    // NASA's high-detail ISS (packed, ~40 MB) loads here the first time, then stays cached
    const ld = await line('STATION MODEL · NASA ISS (IGOAL) · 0%', 100);
    const gltf = await app.assets.loadModel('issHd', '/models/iss_hd.glb', (f) => (ld.textContent = `STATION MODEL · NASA ISS (IGOAL) · ${Math.round(f * 100)}%`)).catch(() => null);
    ld.textContent = gltf ? 'STATION MODEL · NASA ISS (IGOAL) · READY' : 'STATION MODEL · UNAVAILABLE';
    this.alive();
    this.stage = new ISSStage(app.assets, app.engine.renderer, app.quality, gltf);
    const st = this.stage;
    st.resize(window.innerWidth, window.innerHeight);
    st.update(0.016);
    st.render(app.engine.renderer); // compile shaders while the screen is black
    await line('SUIT PRESSURE · 4.3 PSI · 100% O₂');
    await line('HELMET LIGHTS · ON · ORBITAL NIGHT');
    await line('EV1 OUTSIDE · QUEST AIRLOCK · HATCH SHUT', 600);
    app.engine.setStage(st);
    app.input.pointerEnabled = false; // the mouse aims directly (no drag); decisions are number keys
    this.stickAt = performance.now();
    this.aim = true;
    this.setAim(true);
    this.hud = this.buildHud();
    await app.screens.show(this.hud);
    app.link.send({ t: 'layout', layout: 'iss', title: 'Stand by' });
    app.sfx.suit(true, 0);
    this.evaStart = performance.now();
    this.disposers.push(
      app.engine.onTick((dt) => this.tick(dt)),
      app.input.onPress((id) => this.onPress(id)),
    );
    cover.classList.add('out');
    setTimeout(() => cover.remove(), 1200);
  }

  // ─────────────────────────────────────────── already outside Quest at night: Earth with city lights → tether
  private async egress() {
    const st = this.stage!, { sfx } = this.app;
    this.setObjective('Secure the tether');
    sfx.setMusic('jupiter');
    sfx.setMusicFocus(1);
    // a slow drift off the hatch, the night side of Earth turning beneath the station
    void st.move([st.air(0.66, 0.02, 0.16), st.air(0.6, 0.05, 0.1)], [st.air(8, -3.6, 1.8), st.air(7, -2.6, 0.2)], 9, 'inout');
    await this.say(L.boot);
    this.alive();
    sfx.riser(3.2);
    void this.say(L.view);
    this.locationCard(['INTERNATIONAL SPACE STATION', 'Orbital night · 420 km above the Gulf of Mexico', `${Math.round(st.earthSpeedKmh).toLocaleString()} km/h · one orbit every 92 min`]);
    await this.sleep(4200);
    await this.say(L.orbitFact);
    this.alive();

    // Decision 1: tether. The left hand clips onto the ring on the hatch frame
    await this.choose(L.q1, CHOICES.q1);
    await st.move([st.air(0.4, 0.1, 0.12)], [st.air(1.2, 0.5, 2.6)], 1.2);
    const ring = st.air(0.08, 0.75, 0.55);
    await st.L.anchor(() => ring, 0.95, 0.7);
    sfx.clip();
    st.kick(0.12);
    st.tetherAnchor = ring;
    this.setStatus('tether', 'SECURED');
    await this.sleep(350);
    void st.L.rest(0.7);
    await this.say(L.tetherOk);
  }

  // ─────────────────────────────────────────── Canadarm2 ride: sweeping views, orbital sunrise
  private async translate() {
    const st = this.stage!, { sfx } = this.app;
    this.setObjective('Reach the P3 battery bank');
    await this.choose(L.q2, CHOICES.q2);
    void this.say(L.armOk);
    // the arm's end arrives under the hatch; step out into the foot restraint and take the handhold
    st.showRig(true);
    st.rig.position.set(0, -1.2, 0.8);
    void st.tweenObject(st.rig, new THREE.Vector3(0, 0, 0), null, 2.2);
    sfx.servo(2.0);
    await st.move([st.air(0.9, -0.25, 0.2), st.air(1.35, -0.45, 0.25)], [st.air(6, -1.6, 1.5), st.air(7, -2, 3)], 2.6);
    void st.L.anchor(() => st.rigHandhold(), 0.95, 0.6);
    sfx.clank();
    st.kick(0.15);
    await this.sleep(500);
    this.alive();
    // the ride: down past Quest, under the modules, along the ram side of the truss, up to P3 — while the Sun rises ahead
    st.sunTo(-14, 30);
    sfx.servo(1.5);
    void this.say(L.ride);
    const ride = st.move(
      [new THREE.Vector3(5.6, -8.4, 10.6), new THREE.Vector3(3.2, -11.2, 4.2), new THREE.Vector3(-5.8, -10.4, -7.6), new THREE.Vector3(-7.2, -4.4, -16.4), new THREE.Vector3(-6.4, 0.6, -21.0), st.at(3.4, -0.15, 1.35)],
      [new THREE.Vector3(-6, -11, 16), new THREE.Vector3(-18, -12, 2), new THREE.Vector3(-26, -8, -12), new THREE.Vector3(-24, -2, -24), new THREE.Vector3(-12, 0, -26), st.at(1.6, -0.3, 0.2)],
      30, 'inout');
    await this.sleep(6500);
    void this.say(L.sunrise1, true);
    await this.sleep(6500);
    // the Sun clears the limb: music swells, shafts through the truss
    sfx.impact(0.6);
    sfx.setMusic('triumph');
    void this.say(L.sunrise2, true);
    await ride;
    this.alive();
    // off the arm, hand over hand along the rails on the truss face to the worksite
    sfx.objective();
    void this.say(L.arrive);
    void st.L.rest(0.5);
    st.showRig(false);
    await this.climb([3.2, 2.4, 1.6, 0.8, 0.0]);
    this.alive();
    await st.move([st.at(0, 0.08, 1.74)], [st.at(0, 0.02, 0.27)], 1.4);
  }

  /** Hand over hand along the worksite rails (site-local x positions): each hand grabs a real rail and holds it
   *  while the body pulls past, then the other hand takes the next one. */
  private async climb(xs: number[], fast = false) {
    const st = this.stage!, { sfx } = this.app;
    const per = fast ? 0.55 : 0.85;
    for (let i = 0; i < xs.length; i++) {
      const hand = i % 2 ? st.R : st.L, other = i % 2 ? st.L : st.R;
      const rail = st.at(xs[i], -0.72, 0.1);
      await hand.anchor(() => rail, 0.95, fast ? 0.28 : 0.4);
      sfx.connector(false);
      void other.rest(0.5);
      await st.move([st.at(xs[i] - 0.2, -0.1, 1.15)], [st.at(xs[i] - 1.4, -0.35, 0.1)], per);
      this.alive();
    }
    void st.L.rest(0.5); void st.R.rest(0.5);
  }

  // ─────────────────────────────────────────── the repair (decisions only; every hand action touches real hardware)
  private async repair() {
    const st = this.stage!, { sfx } = this.app;
    this.setObjective('Replace battery 3B');
    st.sunTo(6, 70);
    sfx.setMusic('jupiter');
    await this.choose(L.q3, CHOICES.q3);
    await st.move([st.at(0, 0.02, 1.66)], [st.at(0, 0.0, 0.27)], 1.0);
    sfx.clank();
    st.kick(0.2);
    await this.say(L.footOk);
    this.alive();

    await this.choose(L.q4, CHOICES.q4);
    void this.say(L.seqOk);
    this.progress('Isolating power · remote power controllers open');
    await this.sleep(1500);
    st.oldOru.leds.forEach((l) => l.emissive.set(0x000000));
    this.progress('Disconnecting J1 · J2 · J3');
    for (const p of st.oldOru.ports) {
      await st.R.anchor(() => st.worldOf(p), 0.85, 0.45);
      sfx.connector(false);
      await this.sleep(260);
    }
    this.progress('Releasing bolts · pistol grip tool');
    st.showTool(true);
    for (const b of st.oldOru.bolts) {
      await st.R.anchor(() => st.worldOf(b), 0.95, 0.38);
      sfx.ratchet(0.55, false);
      await st.tweenObject(b, b.position.clone().add(new THREE.Vector3(0, 0, 0.03)), new THREE.Euler(Math.PI / 2, -6, 0), 0.55);
    }
    st.showTool(false);
    // both hands on the ORU handle; the unit comes out and is handed off to a temporary stow point
    this.progress('Swapping battery units');
    const oldG = st.oldOru.group, newG = st.newOru.group;
    await Promise.all([st.L.anchor(() => st.worldOf(oldG, new THREE.Vector3(-0.17, 0.36, 0.3)), 0.95, 0.5), st.R.anchor(() => st.worldOf(oldG, new THREE.Vector3(0.17, 0.36, 0.3)), 0.95, 0.5)]);
    sfx.servo(1.0);
    await st.tweenObject(oldG, new THREE.Vector3(0, 0.05, 0.75), null, 1.4);
    await st.tweenObject(oldG, new THREE.Vector3(1.5, -0.75, 1.0), new THREE.Euler(0.15, -0.4, 0), 1.6);
    await Promise.all([st.L.anchor(() => st.worldOf(newG, new THREE.Vector3(-0.17, 0.36, 0.3)), 0.95, 0.6), st.R.anchor(() => st.worldOf(newG, new THREE.Vector3(0.17, 0.36, 0.3)), 0.95, 0.6)]);
    await st.tweenObject(newG, new THREE.Vector3(0, 0.02, 0.78), new THREE.Euler(0, 0, 0), 1.6);
    await st.tweenObject(newG, new THREE.Vector3(0, 0, 0.27), null, 1.0);
    sfx.clank();
    st.kick(0.2);
    void st.L.rest(0.6);
    this.hideProgress();
    // bolts: the tool drives each one
    void this.say(L.bolts);
    st.showTool(true);
    for (const b of st.newOru.bolts) {
      await st.R.anchor(() => st.worldOf(b), 0.95, 0.38);
      sfx.ratchet(0.6, true);
      await st.tweenObject(b, b.position.clone().add(new THREE.Vector3(0, 0, -0.02)), new THREE.Euler(Math.PI / 2, 8, 0), 0.6);
    }
    st.showTool(false);
    void st.R.rest(0.6);
    void this.say(L.boltsDone);
    this.alive();
    await this.connectorGame();
    this.alive();
    st.setOruStatus(st.newOru, true);
    st.newOru.leds.forEach((l) => l.emissive.set(0x00ff66));
    sfx.success();
    sfx.objective();
    this.app.link.buzz([40, 60, 40]);
    this.setObjective('Battery 3B online');
    await this.say(L.powerUp);
  }

  /** Keyed connectors: pick the socket matching each plug's shape; the right hand then mates it. */
  private async connectorGame() {
    const st = this.stage!, { sfx } = this.app;
    await this.say(L.connIntro);
    this.alive();
    const order = [2, 0, 1];
    const shapeSvg = (s: string, c: string) => s === 'circle' ? `<circle r="15" fill="none" stroke="${c}" stroke-width="4"/>` : s === 'triangle' ? `<path d="M0 -17 L15 11 L-15 11 Z" fill="none" stroke="${c}" stroke-width="4"/>` : `<rect x="-14" y="-14" width="28" height="28" fill="none" stroke="${c}" stroke-width="4"/>`;
    for (const plug of CONNECTORS) {
      const glyph = { circle: '● circle', triangle: '▲ triangle', square: '■ square' } as Record<string, string>;
      const opts: Choice[] = order.map((k, i) => ({ label: `Socket ${String.fromCharCode(65 + i)}`, phone: `Socket ${String.fromCharCode(65 + i)} · ${glyph[CONNECTORS[k].shape]}`, sub: '', ok: CONNECTORS[k].id === plug.id, why: L.connWrong, icon: shapeSvg(CONNECTORS[k].shape, '#e9eef6') } as Choice & { icon: string; phone: string }));
      const idx = await this.choose(`Mate plug ${plug.name}`, opts, { icon: shapeSvg(plug.shape, plug.color), silentPrompt: true, quiet: true, phonePrompt: `Plug ${plug.name} has a ${glyph[plug.shape]} key. Which socket matches?` });
      const port = st.newOru.ports[order[idx]];
      await st.R.anchor(() => st.worldOf(port), 0.9, 0.5);
      sfx.connector(true);
      st.newOru.leds[order[idx]].emissive.set(0xffaa00);
      await this.sleep(300);
    }
    void st.R.rest(0.6);
    await this.say(L.connDone);
  }

  // ─────────────────────────────────────────── debris storm (dramatised, based on Nov 2021): ride it out on the truss
  private async debrisStorm() {
    const st = this.stage!, { sfx } = this.app;
    await this.sleep(1200);
    sfx.silence(900);
    sfx.setMusic('none');
    await this.sleep(800);
    sfx.braam();
    sfx.alarm(3);
    sfx.setMusic('tension', 0.3);
    st.alert = 1;
    this.hud!.classList.add('alert');
    this.setStatus('mmod', 'DEBRIS ALERT');
    this.setObjective('Debris storm · keep the astronaut alive');
    this.stressTo(0.55);
    st.kick(0.3, 0.1);
    this.app.link.buzz([200, 100, 200, 100, 200]);
    st.debris = 0.15;
    await this.say([L.debris1, L.debris2], true);
    this.alive();
    st.sunTo(14, 60);
    await this.choose('Debris storm: your call', CHOICES.q5, { timer: 10 });
    void this.say(L.coverOk, true);
    sfx.setMusic('rescue', 0.6);
    this.stressTo(0.75);
    st.debris = 0.45;
    // tuck in close against the truss face, facing it, a hand on each rail; a second tether clip
    await st.move([st.at(0.4, -0.6, 1.3)], [st.at(0.4, -0.66, -0.4)], 1.1);
    sfx.clip();
    await Promise.all([st.L.anchor(() => st.at(0, -0.72, 0.1), 0.98, 0.35), st.R.anchor(() => st.at(0.8, -0.72, 0.1), 0.98, 0.35)]);
    sfx.connector(false);
    st.kick(0.2);
    this.alive();
    // the stream arrives
    st.debris = 1;
    st.shake = 0.6;
    const choice = this.choose('Fragments crossing', CHOICES.q6, { timer: 7 });
    void this.say(L.q6, true);
    await choice;
    this.alive();
    void this.say(L.shieldOk, true);
    // helmet down: look along the rail, away from the stream
    await st.move([st.at(0.4, -0.64, 1.24)], [st.at(0.4, -1.7, 0.1)], 0.8);
    st.shake = 0.9;
    this.stressTo(0.95);
    const hits: [number, THREE.Vector3][] = [[500, new THREE.Vector3(-3, 6, -32)], [900, st.at(0.9, 1.35, -0.3)], [600, st.at(-2.2, 0.6, 0.1)], [1100, new THREE.Vector3(-6, 9, -40)], [700, st.at(1.8, -1.6, 0.2)]];
    for (const [d, at] of hits) {
      await this.sleep(d);
      st.burst(at, 60, 4);
      const close = at.distanceTo(st.body.position) < 6;
      st.kick(close ? 0.9 : 0.4, close ? 0.2 : 0.08);
      sfx.impact(close ? 1 : 0.6);
      sfx.setMuffle(0.4);
      setTimeout(() => sfx.setMuffle(0), 700);
      this.app.link.buzz(120);
    }
    void this.say(L.impact, true);
    await this.sleep(2600);
    st.debris = 0.4;
    st.shake = 0.4;
    await this.sleep(2400);
    st.debris = 0.1;
    st.shake = 0.1;
    await this.sleep(1800);
    this.alive();
    // the cloud has passed: still outside, still holding the rail; lift the head and look out at the day side
    st.debris = 0;
    st.shake = 0;
    st.alert = 0;
    this.hud!.classList.remove('alert');
    this.setStatus('mmod', 'CLEAR');
    this.stressTo(0.25);
    sfx.setMusic('none');
    void st.R.rest(0.8);
    await st.move([st.at(0.4, 0.1, 1.6)], [st.at(0.6, -3.5, 18)], 3.2);
    sfx.setMusic('triumph');
    this.setObjective('Storm passed · battery 3B online');
    await this.say([L.allClear, L.wrap1]);
  }

  // ─────────────────────────────────────────── exit: cut from the helmet to the station from outside, then orbit
  private async exitCut() {
    const st = this.stage!, hud = this.hud!, { sfx } = this.app;
    this.app.input.pointerEnabled = false;
    this.aim = false;
    this.setAim(false);
    sfx.suit(false, 0);
    hud.classList.add('sat');
    const sat = html(`<div class="sat-ui mono"><div class="sat-flash"></div><div class="sat-tag"><i></i><span class="sat-name">EV1 · P3 truss</span></div><div class="sat-info"><b>Mission complete</b><span class="sat-alt"></span></div></div>`);
    hud.appendChild(sat);
    const tag = $(sat, '.sat-tag');
    let far = false;
    const off = this.app.engine.onTick(() => {
      const s = st.toScreen(far ? st.stationCentre : st.worksite);
      tag.style.visibility = s.behind ? 'hidden' : 'visible';
      tag.style.transform = `translate(${(s.x * window.innerWidth).toFixed(1)}px, ${(s.y * window.innerHeight).toFixed(1)}px)`;
    });
    this.disposers.push(off);
    const lines = this.say(L.wrap2);
    await st.orbitExit((level, d) => {
      const gp = st.groundPoint();
      const where = `${Math.abs(gp.lat).toFixed(1)}° ${gp.lat >= 0 ? 'N' : 'S'} ${Math.abs(gp.lon).toFixed(1)}° ${gp.lon >= 0 ? 'E' : 'W'}`;
      $(sat, '.sat-alt').textContent = `International Space Station · ${where} · altitude 420 km · camera ${d >= 1000 ? (d / 1000).toFixed(d >= 10000 ? 0 : 1) + ' km' : d + ' m'} out`;
      far = level >= 1;
      $(sat, '.sat-name').textContent = far ? 'International Space Station' : 'EV1 · P3 truss';
      sfx.whoosh();
      this.app.link.buzz(30);
      const fl = $(sat, '.sat-flash');
      fl.classList.remove('go');
      void fl.offsetWidth;
      fl.classList.add('go');
      sat.classList.toggle('far', level >= 0);
    });
    await lines;
    await this.sleep(1500);
  }

  // ─────────────────────────────────────────── option system
  /**
   * Show choices; resolves with the index of the correct option once the player picks it.
   * Wrong picks are explained by ACE and the player chooses again. Timed choices default to the
   * correct call when time runs out (ACE makes the call for you).
   */
  private choose(prompt: string, options: Choice[], o: { timer?: number; prompt?: string; phonePrompt?: string; icon?: string; silentPrompt?: boolean; quiet?: boolean } = {}): Promise<number> {
    const { sfx } = this.app;
    const id = ++this.choiceCount;
    this.decisions.total += o.quiet ? 0 : 1;
    let firstTry = true;
    const el = html(`
      <div class="choices${o.timer ? ' timed' : ''}">
        <div class="ch-prompt mono">${o.icon ? `<svg viewBox="-20 -20 40 40" class="ch-icon">${o.icon}</svg>` : ''}<span>${escapeHtml(o.prompt ?? prompt)}</span></div>
        ${o.timer ? '<div class="ch-timer"><i></i></div>' : ''}
        ${this.app.mode === 'device' ? `<div class="ch-hint mono">Press ${options.map((_, i) => `<b class="kbd">${i + 1}</b>`).join(' ')}</div>` : ''}
        <div class="ch-row">${options.map((c, i) => `
          <button class="ch-card" data-i="${i}">
            <span class="kbd">${i + 1}</span>
            ${(c as Choice & { icon?: string }).icon ? `<svg viewBox="-20 -20 40 40" class="ch-shape">${(c as Choice & { icon?: string }).icon}</svg>` : ''}
            <b>${escapeHtml(c.label)}</b>${c.sub ? `<small>${escapeHtml(c.sub)}</small>` : ''}
          </button>`).join('')}</div>
      </div>`);
    this.hud!.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    sfx.objective();
    if (!o.silentPrompt && !o.timer) void this.say(prompt);
    const phoneLabels = options.map((c) => (c as Choice & { phone?: string }).phone ?? c.label);
    this.sendPhone(o.phonePrompt ?? o.prompt ?? prompt, phoneLabels);
    return new Promise((resolve) => {
      let done = false;
      let left = o.timer ?? 0;
      const finish = (i: number) => {
        done = true;
        offTick();
        this.choiceResolver = null;
        if (firstTry && !o.quiet) this.decisions.firstTry++;
        el.querySelectorAll('.ch-card')[i]?.classList.add('ok');
        sfx.confirm();
        this.sendPhone(null, null);
        setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, 450);
        resolve(i);
      };
      const pick = (i: number) => {
        if (done || i < 0 || i >= options.length || this.paused) return;
        const c = options[i];
        if (c.ok) return finish(i);
        firstTry = false;
        sfx.error();
        this.app.link.buzz([60, 40, 60]);
        const card = el.querySelectorAll('.ch-card')[i] as HTMLButtonElement;
        card.classList.add('bad');
        card.disabled = true;
        phoneLabels[i] = '✕ ' + phoneLabels[i];
        this.sendPhone(undefined, [...phoneLabels]);
        if (c.why) void this.say({ text: c.why, mood: 'alert' }, true);
      };
      this.choiceResolver = pick;
      el.querySelectorAll<HTMLElement>('.ch-card').forEach((b) => {
        b.addEventListener('click', () => pick(Number(b.dataset.i)));
        b.addEventListener('mouseenter', () => sfx.hover());
      });
      const bar = el.querySelector<HTMLElement>('.ch-timer i');
      const offTick = this.app.engine.onTick((dt) => {
        if (done || this.paused || !o.timer || id !== this.choiceCount) return;
        left -= dt;
        if (bar) bar.style.transform = `scaleX(${Math.max(0, left / o.timer).toFixed(3)})`;
        if (Math.ceil(left) !== Math.ceil(left + dt) && left > 0) sfx.tick(left < 3);
        if (left <= 0) { firstTry = false; finish(options.findIndex((c) => c.ok)); }
      });
    });
  }

  private onPress(id: string) {
    if (this.paused) return;
    const m = id.match(/^(?:key:(?:Digit|Numpad)([1-4])|choice:([1-4]))$/);
    if (m && this.choiceResolver) return this.choiceResolver(Number(m[1] ?? m[2]) - 1);
    if ((id === 'primary' || id === 'interact' || id === 'action') && this.actionResolver) {
      const r = this.actionResolver;
      this.actionResolver = null;
      r();
    }
  }

  // ─────────────────────────────────────────── per frame
  private tick(dt: number) {
    const st = this.stage;
    if (!st || !this.hud || this.paused) return;
    // free look with the mouse / right stick, springing back when released
    const { input } = this.app;
    input.consumeMouse();
    const r = input.stickR();
    const now = performance.now();
    if (r.x || r.y) {
      this.stickAt = now;
      st.lookYaw = THREE.MathUtils.clamp(st.lookYaw - r.x * dt * 1.4, -1.1, 1.1);
      st.lookPitch = THREE.MathUtils.clamp(st.lookPitch + r.y * dt * 1.0, -0.7, 0.7);
    } else if (input.pointer.movedAt > this.stickAt) {
      // the mouse points the helmet: screen edge = the edge of the look range (a little before, so it is reachable)
      const k = Math.min(1, dt * 7);
      const ty = -THREE.MathUtils.clamp(input.pointer.x / 0.92, -1, 1) * 1.1;
      const tp = THREE.MathUtils.clamp(input.pointer.y / 0.92, -1, 1) * 0.7;
      st.lookYaw += (ty - st.lookYaw) * k;
      st.lookPitch += (tp - st.lookPitch) * k;
    } else { st.lookYaw *= Math.exp(-dt * 0.6); st.lookPitch *= Math.exp(-dt * 0.6); }

    // suit telemetry (heart rate follows stress)
    this.heart += ((72 + this.stress * 70) - this.heart) * Math.min(1, dt * 0.6);
    st.fog = 0.18 + this.stress * 0.5;
    const el = (s: string) => this.hud!.querySelector(s) as HTMLElement;
    const ms = performance.now() - this.evaStart - this.evaPausedMs;
    const met = 6 * 3600 + 12 * 60 + ms / 1000; // the spacewalk is already 6 h 12 min in
    el('.met').textContent = fmtHms(met);
    el('.hr').textContent = String(Math.round(this.heart + Math.sin(performance.now() / 700) * 1.5));
    el('.o2').textContent = `${(87.4 - ms / 60000 * 0.6).toFixed(1)}%`;
    el('.co2').textContent = (1.6 + this.stress * 1.4 + Math.sin(performance.now() / 3000) * 0.1).toFixed(1);
    const gp = st.groundPoint();
    el('.gt').textContent = `${Math.abs(gp.lat).toFixed(2)}° ${gp.lat >= 0 ? 'N' : 'S'} · ${Math.abs(gp.lon).toFixed(2)}° ${gp.lon >= 0 ? 'E' : 'W'}`;
    this.app.sfx.suit(true, this.stress);
  }

  private stressTo(v: number) { this.stress = v; }
  /** Hide the cursor while the mouse is steering the helmet camera. */
  private setAim(on: boolean) { document.body.classList.toggle('iss-aim', on); }

  // ─────────────────────────────────────────── HUD
  private buildHud() {
    const device = this.app.mode === 'device';
    return html(`
      <section class="ihud passthrough">
        <div class="ih-tl mono">
          <div class="ih-title">EMU · EV1 <em>HELMET CAM</em></div>
          <div class="ih-row"><span>O₂ PRI</span><b class="o2">87.4%</b></div>
          <div class="ih-row"><span>SUIT P</span><b>4.30 PSI</b></div>
          <div class="ih-row"><span>CO₂</span><b><i class="co2">1.6</i> mmHg</b></div>
          <div class="ih-row"><span>HEART</span><b><i class="hr">72</i> BPM</b></div>
        </div>
        <div class="ih-tr mono">
          <div class="ih-title">EVA MET <b class="met">06:12:00</b></div>
          <div class="ih-row"><span>GROUND</span><b class="gt">-</b></div>
          <div class="ih-row"><span>VELOCITY</span><b>7.66 KM/S</b></div>
          <div class="ih-row st-tether"><span>TETHER</span><b>STOWED</b></div>
          <div class="ih-row st-mmod"><span>MMOD</span><b>NOMINAL</b></div>
        </div>
        <div class="ih-obj mono"><span>OBJECTIVE</span><b class="obj"></b></div>
        <div class="ih-alert mono"><b>⚠ DEBRIS ALERT</b><span>Fragment cloud crossing orbit</span><em>Dramatised · based on a real event (Nov 2021)</em></div>
        <div class="progress-pill mono"><i></i><span></span></div>
        <div class="ih-cross"></div>
        ${device ? `<footer class="ih-keys mono"><span><b class="kbd">1</b><b class="kbd">2</b><b class="kbd">3</b> decide</span><span><b class="kbd">Mouse</b> look</span><span><b class="kbd">Tab</b> skip line</span><span><b class="kbd">Esc</b> pause</span></footer>` : ''}
      </section>`);
  }

  private setObjective(t: string) {
    this.objective = t;
    if (!this.hud) return;
    const b = $(this.hud, '.obj');
    b.textContent = t;
    b.parentElement!.classList.remove('new');
    void b.parentElement!.offsetWidth;
    b.parentElement!.classList.add('new');
    this.sendPhone(undefined);
  }
  private setStatus(which: 'tether' | 'mmod', v: string) {
    const r = this.hud?.querySelector(`.st-${which}`);
    if (!r) return;
    r.querySelector('b')!.textContent = v;
    r.classList.toggle('warn', /ALERT/.test(v));
    r.classList.toggle('good', /SECURED|CLEAR|INSIDE/.test(v));
  }
  private progress(t: string) {
    const p = $(this.hud!, '.progress-pill');
    $(p, 'span').textContent = t;
    p.classList.add('show');
  }
  private hideProgress() { $(this.hud!, '.progress-pill').classList.remove('show'); }
  private phoneChoices: string[] | null = null;
  private phonePrompt: string | null = null;
  private sendPhone(prompt?: string | null, choices?: string[] | null) {
    if (prompt !== undefined) this.phonePrompt = prompt;
    if (choices !== undefined) this.phoneChoices = choices;
    this.app.link.hud({ objective: this.objective, prompt: this.phonePrompt, choices: this.phoneChoices, alert: this.stage?.alert ? true : false });
  }

  private locationCard(lines: string[]) {
    const card = html(`<div class="loc-card mono"></div>`);
    this.hud!.appendChild(card);
    lines.forEach((l, i) => setTimeout(() => card.appendChild(html(`<div class="${i === 0 ? 'big' : ''}">${escapeHtml(l)}</div>`)), 300 + i * 800));
    setTimeout(() => card.classList.add('out'), 7000);
    setTimeout(() => card.remove(), 8000);
  }

  // ─────────────────────────────────────────── report
  private showReport() {
    const { app } = this;
    app.input.pointerEnabled = false;
    app.sfx.suit(false, 0);
    app.link.send({ t: 'layout', layout: 'lobby', title: 'Mission 03 complete', subtitle: 'Spacewalk report on the main screen' });
    const mins = (performance.now() - this.evaStart - this.evaPausedMs) / 60000;
    const facts = FACTS.map(([k, v], i) => `<figure class="fade-up iss-fact" style="animation-delay:${0.15 + i * 0.1}s"><figcaption><span class="mono">${k}</span><p>${escapeHtml(v)}</p></figcaption></figure>`).join('');
    const el = html(`
      <section class="report">
        <div class="report-inner">
          <div class="eyebrow">Mission 03 complete · Spacewalk report</div>
          <h2>Orbital Maintenance</h2>
          <div class="report-stats mono">
            <div><span>Battery 3B</span><b>Online</b></div>
            <div><span>Calls right first time</span><b>${this.decisions.firstTry} / ${this.decisions.total}</b></div>
            <div><span>Debris storm</span><b>Survived</b></div>
            <div><span>Time outside (game)</span><b>${mins.toFixed(1)} min</b></div>
          </div>
          <div class="report-figs iss-facts">${facts}</div>
          <div class="report-row">
            <div class="jwst panel"><div class="eyebrow" style="color:var(--c-orange)">Dramatised scenario</div><p>The battery failure and the debris storm during this spacewalk are dramatised. They are based on real events: spacewalkers replaced the station's batteries with lithium-ion units between 2017 and 2021, and on 15 November 2021 debris from an anti-satellite test sent the ISS crew to shelter in their spacecraft. In reality, a spacewalk would be cancelled or postponed long before a known debris cloud arrived.</p></div>
          </div>
          <p class="report-src mono">Earth: NASA Blue Marble Next Generation (MODIS, July 2004) + Black Marble · facts: nasa.gov/international-space-station · station hardware modelled for this game</p>
          <div class="report-actions">
            <button class="btn primary to-select">Mission select</button>
            <button class="btn ghost replay">Replay mission</button>
          </div>
        </div>
      </section>`);
    void app.screens.show(el);
    app.sfx.success();
    const exit = (e: MissionExit) => { app.sfx.click(); this.finish(e); };
    $(el, '.to-select').addEventListener('click', () => exit({ to: 'select' }));
    $(el, '.replay').addEventListener('click', () => exit({ to: 'restart' }));
  }
}

const fmtHms = (s: number) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), Math.floor(s % 60)].map((n) => String(n).padStart(2, '0')).join(':');
