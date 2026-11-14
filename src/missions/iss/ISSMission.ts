import * as THREE from 'three';
import '../mars/mars.css'; // shared cinematic pieces (cover, location card, progress pill)
import './iss.css';
import type { App } from '../../app/App';
import type { Mission, MissionExit } from '../types';
import { ISSStage } from './ISSStage';
import { ISS_SPECS, briefingLines, L, CHOICES, CONNECTORS, FACTS, type Choice } from './script';
import { html, $, escapeHtml } from '../../ui/dom';
import type { CommanderLine } from '../../core/Commander';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Mission 03 · Orbital Maintenance. The player is the spacewalk officer in Mission Control, guiding an
 * astronaut through their helmet camera: decisions (the astronaut acts them out), two minigames
 * (bolt torque, keyed connectors), then a dramatised debris alert based on the real November 2021 event.
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
  private torqueScores: number[] = [];
  private stress = 0;
  private heart = 72;
  private objective = '';
  private choiceResolver: ((i: number) => void) | null = null;
  private choiceCount = 0;
  private actionResolver: (() => void) | null = null;

  constructor(private app: App) {}

  start(): Promise<MissionExit> {
    const exit = new Promise<MissionExit>((r) => (this.finish = r));
    void this.flow().catch((e) => { if (!this.disposed) throw e; });
    return exit;
  }
  abort(exit: MissionExit) { this.finish(exit); }
  setPaused(p: boolean) {
    this.paused = p;
    if (this.stage) this.stage.paused = p;
    if (p) this.pausedAt = performance.now();
    else if (this.pausedAt) { this.evaPausedMs += performance.now() - this.pausedAt; this.pausedAt = 0; }
    this.app.sfx.suit(!p && !!this.stage, this.stress);
  }
  dispose() {
    this.disposed = true;
    this.disposers.forEach((d) => d());
    this.disposers = [];
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
    await this.debrisEscape(); this.alive();
    this.showReport();
  }

  // ─────────────────────────────────────────── briefing (ISS model on the space backdrop)
  private briefing(): Promise<boolean> {
    const { app } = this;
    app.engine.setStage(app.space);
    app.space.setShot('briefing', 0.7);
    const iss = app.assets.models.iss?.scene;
    app.space.showModel(iss ? iss.clone(true) : null, 5.2);
    app.link.send({ t: 'layout', layout: 'lobby', title: 'Mission 03 · Briefing', subtitle: 'Tap Skip to jump ahead' });
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
            <li><span class="mono">1</span>Exit the airlock safely</li>
            <li><span class="mono">2</span>Reach the P4 battery bank</li>
            <li><span class="mono">3</span>Replace lithium-ion battery 3B</li>
          </ol>
          <div class="brief-actions">
            <button class="btn primary go">Begin spacewalk <span class="kbd">ENTER</span></button>
            <button class="btn ghost abort">Abort</button>
          </div>
          <p class="brief-note">Earth imagery: NASA Blue Marble Next Generation (MODIS) · ISS model: NASA 3D Resources</p>
        </div>
        <div class="brief-caption mono fade-up" style="animation-delay:.4s">INTERNATIONAL SPACE STATION · LOW EARTH ORBIT</div>
      </section>`);
    void app.screens.show(el);
    void this.say(briefingLines(app.mode), true);
    return new Promise((resolve) => {
      const done = (go: boolean) => { off(); app.commander.clear(); app.sfx[go ? 'confirm' : 'back'](); resolve(go); };
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
    const line = async (t: string, ms = 420) => { lines.appendChild(html(`<div class="fade-up">${t}</div>`)); app.sfx.typeTick(); app.sfx.blip(); await this.sleep(ms); };
    await line('EMU · EXTRAVEHICULAR MOBILITY UNIT');
    this.stage = new ISSStage(app.assets, app.engine.renderer, app.quality);
    const st = this.stage;
    st.resize(window.innerWidth, window.innerHeight);
    st.update(0.016);
    st.render(app.engine.renderer); // compile shaders while black
    await line('SUIT PRESSURE · 4.3 PSI · 100% O₂');
    await line('HELMET CAMERA · DOWNLINK TO MISSION CONTROL');
    await line('CREWLOCK DEPRESSURISED · 0.0 PSI', 600);
    app.engine.setStage(st);
    app.input.pointerEnabled = true;
    app.input.lookMode = 'drag';
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

  // ─────────────────────────────────────────── hatch → Earth reveal → tether
  private async egress() {
    const st = this.stage!, { sfx } = this.app;
    st.exposure = 0.75;
    this.setObjective('Exit the airlock');
    await this.say(L.boot);
    this.alive();
    // hand on the hatch handle, then the hatch swings open onto the Earth
    await st.reach('R', V(0.0, 0.0, 0.0), 0.9, 1.0);
    sfx.servo(1.2);
    await this.sleep(500);
    void this.say(L.hatch);
    sfx.setMusic('jupiter');
    sfx.setMusicFocus(1);
    sfx.riser(3.2);
    void st.restHands(1);
    const opening = st.tweenObject(st.hatch, null, new THREE.Euler(0, 0, 1.75), 4);
    const t0 = performance.now();
    const off = this.app.engine.onTick(() => { const k = Math.min(1, (performance.now() - t0) / 4000); st.exposure = THREE.MathUtils.lerp(0.75, 1.0, k); });
    await opening;
    off();
    sfx.impact(0.55);
    await st.move([V(-0.5, 0.0, 0.0), V(0.15, 0.05, 0.1)], [V(10, -2.5, 0), V(10, -3.2, 1.5)], 4.5, false);
    this.alive();
    this.locationCard(['INTERNATIONAL SPACE STATION', '420 km above the Caribbean Sea', `${Math.round(st.earthSpeedKmh).toLocaleString()} km/h · one orbit every 92 min`]);
    await this.say(L.orbitFact);
    this.alive();

    // Decision 1: tether
    await this.choose(L.q1, CHOICES.q1);
    const anchor = V(0.35, 0.75, 0.75);
    await st.reach('L', anchor, 0.95, 0.8);
    sfx.clip();
    st.tetherAnchor = anchor;
    this.setStatus('tether', 'SECURED');
    await this.say(L.tetherOk);
    void st.restHands(0.8);
  }

  // ─────────────────────────────────────────── along the truss
  private async translate() {
    const st = this.stage!;
    this.setObjective('Reach the P4 battery bank');
    await this.choose(L.q2, CHOICES.q2);
    void this.say(L.railsOk);
    // up the frame onto the truss
    await st.move(
      [V(0.7, 0.4, 0.75), V(1.15, 1.6, 1.4), V(1.6, 3.0, 2.3), V(3.2, 4.15, 2.8)],
      [V(4, 2.5, 1), V(3, 5, 1.5), V(10, 4.4, 2.4), V(14, 4.2, 2.5)],
      7.5, true);
    this.alive();
    void this.say(L.translating);
    await st.move(
      [V(8, 4.2, 2.85), V(14, 4.25, 2.85), V(19.5, 4.3, 2.9), V(23.2, 4.45, 3.25)],
      [V(20, 4.2, 2.5), V(26, 4.1, 2.4), V(30, 4.3, 2.4), V(24.6, 4.45, 2.1)],
      11, true);
    this.alive();
    await st.move([V(24, 4.55, 3.85)], [V(24, 4.45, 2.07)], 2.2, false);
    this.app.sfx.objective();
    await this.say(L.arrive);
  }

  // ─────────────────────────────────────────── the repair
  private async repair() {
    const st = this.stage!, { sfx } = this.app;
    this.setObjective('Replace battery 3B');
    await this.choose(L.q3, CHOICES.q3);
    await st.move([V(24, 4.5, 3.72)], [V(24, 4.42, 2.07)], 1.2, false);
    sfx.clank();
    st.kick(0.25);
    await this.say(L.footOk);
    this.alive();

    await this.choose(L.q4, CHOICES.q4);
    void this.say(L.seqOk);
    // isolate power (Mission Control opens the remote power controllers)
    this.progress('Isolating power · remote power controllers open');
    await this.sleep(1600);
    st.oldOru.leds.forEach((l) => { l.emissive.set(0x000000); });
    // disconnect J1..J3
    this.progress('Disconnecting J1 · J2 · J3');
    for (const p of st.oldOru.ports) {
      await st.reach('R', p.getWorldPosition(new THREE.Vector3()), 0.85, 0.45);
      sfx.connector(false);
      await this.sleep(250);
    }
    // unbolt with the pistol grip tool
    this.progress('Releasing bolts · pistol grip tool');
    st.showTool(true);
    for (const b of st.oldOru.bolts) {
      await st.reach('R', b.getWorldPosition(new THREE.Vector3()), 0.9, 0.4);
      sfx.ratchet(0.5, false);
      await st.tweenObject(b, b.position.clone().add(V(0, 0, 0.03)), new THREE.Euler(Math.PI / 2, -6, 0), 0.5);
    }
    st.showTool(false);
    // swap units
    this.progress('Swapping battery units');
    const handle = st.worksite.clone().add(V(0, 0.36, 0.3));
    await Promise.all([st.reach('L', handle.clone().add(V(-0.2, 0, 0)), 0.95, 0.6), st.reach('R', handle.clone().add(V(0.2, 0, 0)), 0.95, 0.6)]);
    sfx.servo(1.0);
    await st.tweenObject(st.oldOru.group, st.worksite.clone().add(V(-1.6, 0.4, 1.1)), new THREE.Euler(0.2, 0.6, 0.1), 2.2);
    void st.restHands(0.6);
    await st.tweenObject(st.newOru.group, st.worksite.clone(), new THREE.Euler(0, 0, 0), 2.4);
    sfx.clank();
    st.kick(0.2);
    this.hideProgress();

    await this.torqueGame();
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

  /** Minigame 1: stop the torque needle in the green band for each bolt. */
  private async torqueGame() {
    const st = this.stage!, { sfx } = this.app;
    await this.say(L.torqueIntro);
    this.alive();
    st.showTool(true);
    const g = html(`
      <div class="torque panel">
        <div class="tq-head mono"><span>PISTOL GRIP TOOL · CW</span><b class="tq-bolt">BOLT 1 / 4</b></div>
        <svg viewBox="-110 -110 220 130" class="tq-dial">
          <path class="tq-arc" d="M -90 0 A 90 90 0 0 1 90 0" />
          <path class="tq-green" d="" />
          <line class="tq-needle" x1="0" y1="0" x2="0" y2="-84" />
          <circle r="6" class="tq-hub" />
        </svg>
        <div class="tq-read mono"><b class="tq-val">0.0</b> ft-lb · target 25 ± <span class="tq-tol">2</span></div>
        <div class="tq-hint mono"><span class="kbd">SPACE</span> / click / phone ACTION to stop the tool</div>
      </div>`);
    this.hud!.appendChild(g);
    this.sendPhone('TORQUE');
    const bolts = st.newOru.bolts;
    for (let i = 0; i < bolts.length; i++) {
      const b = bolts[i];
      $(g, '.tq-bolt').textContent = `BOLT ${i + 1} / 4`;
      const tol = [2.6, 2.2, 1.9, 1.6][i];
      $(g, '.tq-tol').textContent = tol.toFixed(1);
      const toA = (v: number) => (-90 + (v / 40) * 180) * (Math.PI / 180);
      const arcPt = (v: number) => `${(Math.sin(toA(v)) * 90).toFixed(1)} ${(-Math.cos(toA(v)) * 90).toFixed(1)}`;
      g.querySelector('.tq-green')!.setAttribute('d', `M ${arcPt(25 - tol)} A 90 90 0 0 1 ${arcPt(25 + tol)}`);
      await st.reach('R', b.getWorldPosition(new THREE.Vector3()), 0.9, 0.5);
      for (;;) {
        // needle sweeps; speed rises each bolt
        let v = 0, dir = 1;
        const speed = 22 + i * 7;
        const off = this.app.engine.onTick((dt) => {
          if (this.paused) return;
          v += dir * speed * dt;
          if (v > 40) { v = 40; dir = -1; } else if (v < 0) { v = 0; dir = 1; }
          (g.querySelector('.tq-needle') as SVGElement).setAttribute('transform', `rotate(${-90 + (v / 40) * 180})`);
          $(g, '.tq-val').textContent = v.toFixed(1);
          sfx.toolWhine(v / 40);
        });
        await this.waitAction();
        off();
        sfx.toolWhine(0);
        const err = Math.abs(v - 25);
        if (err <= tol) {
          this.torqueScores.push(1 - err / tol);
          sfx.ratchet(0.6, true);
          g.classList.remove('miss'); g.classList.add('hit');
          void st.tweenObject(b, b.position.clone().add(V(0, 0, -0.02)), new THREE.Euler(Math.PI / 2, 8, 0), 0.6);
          st.kick(0.08);
          await this.sleep(700);
          g.classList.remove('hit');
          break;
        }
        this.torqueScores.push(0);
        sfx.error();
        g.classList.add('miss');
        if (!this.app.commander.busy) void this.say(L.torqueMiss);
        await this.sleep(600);
        g.classList.remove('miss');
      }
    }
    g.remove();
    st.showTool(false);
    this.sendPhone(null);
    sfx.objective();
    await this.say(L.torqueDone);
  }

  /** Minigame 2: keyed connectors. Pick the socket that matches each plug's shape. */
  private async connectorGame() {
    const st = this.stage!, { sfx } = this.app;
    await this.say(L.connIntro);
    this.alive();
    // sockets on the unit are in a fixed, shuffled order of shapes
    const order = [2, 0, 1];
    const shapeSvg = (s: string, c: string) => s === 'circle' ? `<circle r="15" fill="none" stroke="${c}" stroke-width="4"/>` : s === 'triangle' ? `<path d="M0 -17 L15 11 L-15 11 Z" fill="none" stroke="${c}" stroke-width="4"/>` : `<rect x="-14" y="-14" width="28" height="28" fill="none" stroke="${c}" stroke-width="4"/>`;
    for (const plug of CONNECTORS) {
      const opts: Choice[] = order.map((k, i) => ({ label: `Socket ${String.fromCharCode(65 + i)}`, sub: '', ok: CONNECTORS[k].id === plug.id, why: L.connWrong, icon: shapeSvg(CONNECTORS[k].shape, '#e9eef6') } as Choice & { icon: string }));
      const idx = await this.choose(`Mate plug ${plug.name}`, opts, { icon: shapeSvg(plug.shape, plug.color), silentPrompt: true, quiet: true });
      const port = st.newOru.ports[order[idx]];
      await st.reach('R', port.getWorldPosition(new THREE.Vector3()), 0.9, 0.5);
      sfx.connector(true);
      st.newOru.leds[order[idx]].emissive.set(0xffaa00);
      await this.sleep(300);
    }
    void st.restHands(0.6);
    await this.say(L.connDone);
  }

  // ─────────────────────────────────────────── debris alert (dramatised, based on Nov 2021)
  private async debrisEscape() {
    const st = this.stage!, { sfx } = this.app;
    await this.sleep(1200);
    // a beat of silence, then the alert
    sfx.silence(900);
    sfx.setMusic('none');
    await this.sleep(800);
    sfx.braam();
    sfx.alarm(3);
    sfx.setMusic('tension', 0.3);
    st.alert = 1;
    this.hud!.classList.add('alert');
    this.setStatus('mmod', 'DEBRIS ALERT');
    this.setObjective('Debris alert · return to the airlock');
    this.stressTo(0.55);
    st.kick(0.3, 0.1);
    this.app.link.buzz([200, 100, 200, 100, 200]);
    await this.say([L.debris1, L.debris2], true);
    this.alive();
    st.debris = 0.25;
    await this.choose('Debris alert: your call', CHOICES.q5, { timer: 9 });
    void this.say(L.returnOk, true);
    sfx.setMusic('rescue', 0.6);
    this.stressTo(0.75);
    st.debris = 0.6;
    // back along the rails, fast
    await st.move(
      [V(23, 4.4, 3.0), V(17, 4.3, 2.9), V(11, 4.25, 2.85)],
      [V(14, 4.25, 2.6), V(8, 4.2, 2.6), V(2, 4.0, 2.5)],
      6, true);
    this.alive();
    // fragments ahead: hold or go
    st.debris = 1;
    st.shake = 0.6;
    const choice = this.choose('Fragments crossing ahead', CHOICES.q6, { timer: 6, prompt: 'Fragments crossing ahead' });
    void this.say(L.q6, true);
    await choice;
    void this.say(L.shieldOk, true);
    st.shake = 0.9;
    // impacts nearby while holding behind the truss
    for (const [d, at] of [[400, V(14, 6.6, 1.2)], [900, V(57, 9, 14)], [700, V(6, 3.0, 1.9)]] as const) {
      await this.sleep(d);
      st.burst(at, 50, 4);
      st.kick(at.distanceTo(st.camera.position) < 12 ? 0.9 : 0.4, 0.15);
      sfx.impact(at.distanceTo(st.camera.position) < 12 ? 1 : 0.6);
      sfx.setMuffle(0.4);
      setTimeout(() => sfx.setMuffle(0), 700);
      this.app.link.buzz(120);
    }
    void this.say(L.impact, true);
    st.debris = 0.5;
    this.stressTo(0.9);
    await st.move(
      [V(6, 4.2, 2.8), V(2.4, 4.0, 2.6), V(1.3, 2.4, 1.6), V(0.9, 0.6, 0.6), V(0.2, 0.0, 0.0)],
      [V(2, 4.0, 2.4), V(1.0, 2.0, 1.0), V(0.6, 0.0, 0.0), V(-4, 0, 0), V(-6, 0, 0)],
      6.5, true);
    this.alive();
    // inside: turn around, close the hatch
    await st.move([V(-1.3, 0, 0)], [V(3, -0.3, 0)], 2.2, false);
    st.debris = 0;
    st.shake = 0;
    st.tetherAnchor = null;
    await st.reach('R', V(0.1, -0.3, 0), 0.9, 0.6);
    sfx.servo(1.0);
    await st.tweenObject(st.hatch, null, new THREE.Euler(0, 0, 0), 2.2);
    sfx.clank();
    sfx.impact(0.8);
    st.kick(0.4);
    sfx.setMusic('none');
    st.alert = 0;
    this.hud!.classList.remove('alert');
    this.setStatus('mmod', 'CLEAR');
    this.setStatus('tether', 'INSIDE');
    this.stressTo(0.2);
    await this.sleep(1400);
    sfx.setMusic('triumph');
    this.setObjective('Spacewalk complete');
    await this.say([L.hatchClose, L.wrap1, L.wrap2]);
  }

  // ─────────────────────────────────────────── option system
  /**
   * Show choices; resolves with the index of the correct option once the player picks it.
   * Wrong picks are explained by ACE and the player chooses again. Timed choices default to the
   * correct call when time runs out (ACE makes the call for you).
   */
  private choose(prompt: string, options: Choice[], o: { timer?: number; prompt?: string; icon?: string; silentPrompt?: boolean; quiet?: boolean } = {}): Promise<number> {
    const { sfx } = this.app;
    const id = ++this.choiceCount;
    this.decisions.total += o.quiet ? 0 : 1;
    let firstTry = true;
    const el = html(`
      <div class="choices${o.timer ? ' timed' : ''}">
        <div class="ch-prompt mono">${o.icon ? `<svg viewBox="-20 -20 40 40" class="ch-icon">${o.icon}</svg>` : ''}<span>${escapeHtml(o.prompt ?? prompt)}</span></div>
        ${o.timer ? '<div class="ch-timer"><i></i></div>' : ''}
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
    this.sendPhone(null, options.map((c) => c.label));
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

  private waitAction() {
    return new Promise<void>((r) => (this.actionResolver = r));
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
    const m = input.consumeMouse();
    const r = input.stickR();
    st.lookYaw = THREE.MathUtils.clamp(st.lookYaw - m.dx * 0.0025 - r.x * dt * 1.4, -0.6, 0.6);
    st.lookPitch = THREE.MathUtils.clamp(st.lookPitch - m.dy * 0.0025 + r.y * dt * 1.0, -0.45, 0.45);
    if (!m.dx && !m.dy && !r.x && !r.y) { st.lookYaw *= Math.exp(-dt * 1.2); st.lookPitch *= Math.exp(-dt * 1.2); }

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
        ${device ? `<footer class="ih-keys mono"><span><b class="kbd">1</b><b class="kbd">2</b><b class="kbd">3</b> decide</span><span><b class="kbd">Drag</b> look</span><span><b class="kbd">Space</b> tool</span><span><b class="kbd">Tab</b> skip line</span><span><b class="kbd">Esc</b> pause</span></footer>` : ''}
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
    const acc = this.torqueScores.length ? Math.round((this.torqueScores.filter((s) => s > 0).length / this.torqueScores.length) * 100) : 100;
    const facts = FACTS.map(([k, v], i) => `<figure class="fade-up iss-fact" style="animation-delay:${0.15 + i * 0.1}s"><figcaption><span class="mono">${k}</span><p>${escapeHtml(v)}</p></figcaption></figure>`).join('');
    const el = html(`
      <section class="report">
        <div class="report-inner">
          <div class="eyebrow">Mission 03 complete · Spacewalk report</div>
          <h2>Orbital Maintenance</h2>
          <div class="report-stats mono">
            <div><span>Battery 3B</span><b>Online</b></div>
            <div><span>Calls right first time</span><b>${this.decisions.firstTry} / ${this.decisions.total}</b></div>
            <div><span>Bolts torqued in band</span><b>${acc}%</b></div>
            <div><span>Time outside (game)</span><b>${mins.toFixed(1)} min</b></div>
          </div>
          <div class="report-figs iss-facts">${facts}</div>
          <div class="report-row">
            <div class="jwst panel"><div class="eyebrow" style="color:var(--c-orange)">Dramatised scenario</div><p>The battery failure and the debris alert during this spacewalk are dramatised. They are based on real events: spacewalkers replaced the station's batteries with lithium-ion units between 2017 and 2021, and on 15 November 2021 debris from an anti-satellite test sent the ISS crew to shelter in their spacecraft.</p></div>
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
