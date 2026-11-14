import * as THREE from 'three';
import './jupiter.css';
import type { App } from '../../app/App';
import type { Mission, MissionExit } from '../types';
import { JupiterStage, TIMELAPSE, RJ_KM } from './JupiterStage';
import { OBJECTIVES, HINTS, HUBBLE_SPECS, briefingLines, WRAP_UP, JWST_NOTE, type ObjectiveId } from './script';
import { html, $, $$, wait, escapeHtml } from '../../ui/dom';

type CheckKey = 'target' | 'centred' | 'size' | 'focus' | 'exposure';
type Checks = Record<CheckKey, boolean>;
interface Readiness { checks: Checks; ready: boolean; hint: string }

const TARGET_INFO: Record<ObjectiveId, { name: string; rows: [string, string][] }> = {
  disk: { name: 'Jupiter', rows: [['Equatorial diameter', '142,984 km'], ['Day length', '≈ 9.9 hours'], ['Mass', '> 2× all other planets combined'], ['Type', 'Gas giant']] },
  grs: { name: 'Great Red Spot', rows: [['Location', 'Southern hemisphere, ≈ 22° S'], ['Size', 'Wider than Earth'], ['Observed', 'Since at least the 1830s'], ['Trend', 'Shrinking (Hubble)']] },
  europa: { name: 'Europa', rows: [['Diameter', '3,122 km'], ['Distance from Jupiter', '≈ 671,000 km'], ['Orbit', '3.55 days'], ['Surface', 'Water ice']] },
};

/**
 * Mission 01: operate Hubble to observe Jupiter.
 * Real interaction: the player must point, zoom, focus and expose correctly; a
 * capture is only accepted when the target is genuinely framed.
 */
export class JupiterMission implements Mission {
  private stage: JupiterStage | null = null;
  private hud: HTMLElement | null = null;
  private paused = false;
  private disposers: (() => void)[] = [];
  private objectiveIndex = 0;
  private captures: { id: ObjectiveId; url: string }[] = [];
  private busy = false; // capture / transition in progress
  private wasReady = false;
  private objectiveStart = 0;
  private lastHintAt = 0;
  private saidAmbient = false;
  private saidRefocus = false;
  private lastField = 0;
  private finish!: (e: MissionExit) => void;
  private briefingOff?: () => void;

  constructor(private app: App) {}

  private disposed = false;

  start(): Promise<MissionExit> {
    const exit = new Promise<MissionExit>((r) => (this.finish = r));
    void this.flow();
    return exit;
  }

  private async flow() {
    const go = await this.briefing();
    if (this.disposed) return;
    if (!go) return this.finish({ to: 'select' });
    await this.bootTelescope();
    if (this.disposed) return;
    void this.runObjectives();
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
    this.briefingOff?.();
    this.disposers.forEach((d) => d());
    this.disposers = [];
    this.hud?.remove();
    this.hud = null;
    this.app.space.showModel(null);
    if (this.stage) {
      this.stage.dispose();
      this.stage = null;
    }
  }

  // ───────────────────────────────────────────────────────── briefing
  private briefing(): Promise<boolean> {
    const { app } = this;
    app.engine.setStage(app.space);
    app.space.setShot('briefing', 0.7);
    const hubble = app.assets.models.hubble?.scene;
    app.space.showModel(hubble ? hubble.clone(true) : null, 4.6);
    app.link.send({ t: 'layout', layout: 'lobby', title: 'Mission 01 · Briefing', subtitle: 'Tap Skip to jump ahead' });

    const specs = HUBBLE_SPECS.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    const objs = OBJECTIVES.map((o) => `<li><span class="mono">${o.code}</span>${escapeHtml(o.title)}</li>`).join('');
    const el = html(`
      <section class="briefing">
        <div class="brief-panel panel brackets fade-up">
          <div class="eyebrow">Mission 01 · Briefing</div>
          <h2>Deep Space Observatory</h2>
          <p class="brief-lead">Operate the <b>Hubble Space Telescope</b> to make three observations of Jupiter, the largest planet in the solar system.</p>
          <div class="brief-specs mono">${specs}</div>
          <h4 class="mono">Objectives</h4>
          <ol class="brief-objs">${objs}</ol>
          <div class="brief-actions">
            <button class="btn primary go">Begin observation <span class="kbd">ENTER</span></button>
            <button class="btn ghost abort">Abort</button>
          </div>
          <p class="brief-note">Hubble model: NASA 3D Resources · Jupiter imagery: NASA/JPL/Space Science Institute (Cassini)</p>
        </div>
        <div class="brief-caption mono fade-up" style="animation-delay:.4s">HUBBLE SPACE TELESCOPE · LOW EARTH ORBIT</div>
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
      this.briefingOff = off;
    });
  }

  // ───────────────────────────────────────────────────────── telescope boot
  private async bootTelescope() {
    const { app } = this;
    const boot = html(`
      <section class="scope-boot">
        <div class="boot-lines mono"></div>
      </section>`);
    void app.screens.show(boot);
    app.space.setShot('depart', 0.9);
    const lines = ['SLEWING TO TARGET · JUPITER', 'FINE GUIDANCE SENSORS · GUIDE STARS ACQUIRED', 'WIDE FIELD CAMERA 3 · UVIS CHANNEL READY', 'OPENING SHUTTER'];
    const box = $(boot, '.boot-lines');
    for (const l of lines) {
      box.appendChild(html(`<div class="fade-up">› ${l}</div>`));
      app.sfx.blip();
      await wait(380);
    }
    await wait(250);
    app.space.showModel(null);

    this.stage = new JupiterStage(app.assets, app.engine.renderer);
    this.stage.resize(window.innerWidth, window.innerHeight);
    app.engine.setStage(this.stage);
    app.sfx.setAmbience('space');
    app.input.pointerEnabled = true;
    this.lastField = this.stage.fieldH;

    this.hud = this.buildHud();
    await app.screens.show(this.hud);

    app.link.send({ t: 'layout', layout: 'jupiter', title: 'Point · zoom · focus · capture' });
    this.syncPhone();

    // Inputs
    this.disposers.push(
      app.engine.onTick((dt) => this.tick(dt)),
      app.input.onPress((id) => {
        if (this.paused) return;
        if (id === 'primary') void this.tryCapture();
      }),
      app.input.onValue((id, v) => {
        if (!this.stage || this.paused) return;
        if (id === 'focus') this.stage.focus = v;
        if (id === 'exposure') this.stage.exposure = v;
      }),
      () => (app.input.pointerEnabled = false),
    );
  }

  // ───────────────────────────────────────────────────────── objectives
  private get objective() {
    return OBJECTIVES[this.objectiveIndex];
  }

  private async runObjectives() {
    this.app.commander.clear();
    this.beginObjective(0);
  }

  private beginObjective(i: number) {
    this.objectiveIndex = i;
    this.objectiveStart = performance.now();
    this.wasReady = false;
    this.paintObjective();
    void this.app.commander.say(this.objective.start);
  }

  private evaluate(): Readiness {
    const s = this.stage!;
    const id = this.objective.id;
    const fh = s.fieldH;
    let target = false, centred = false, size = false;
    let sizeHint: string = HINTS.tooSmall;
    let extraHint = '';

    const centreOk = (p: THREE.Vector3, tol: number) => Math.hypot(p.x - s.center.x, p.y - s.center.y) / fh <= tol;
    const inView = (p: THREE.Vector3) => Math.abs(p.x - s.center.x) < (fh * (window.innerWidth / window.innerHeight)) / 2 && Math.abs(p.y - s.center.y) < fh / 2;

    if (id === 'disk') {
      const b = s.body('jupiter');
      target = inView(b.pos) || Math.hypot(b.pos.x - s.center.x, b.pos.y - s.center.y) < 1;
      const frac = 1.87 / fh; // Jupiter's polar diameter as a fraction of frame height
      size = frac >= 0.55 && frac <= 0.98;
      sizeHint = frac < 0.55 ? HINTS.tooSmall : HINTS.tooLarge;
      centred = centreOk(b.pos, 0.09);
    } else if (id === 'grs') {
      const g = s.grs();
      target = g.visible && inView(g.pos);
      if (!g.visible) extraHint = HINTS.grsHidden;
      size = fh >= 0.38 && fh <= 1.6;
      sizeHint = fh > 1.6 ? HINTS.tooSmall : HINTS.tooLarge;
      centred = centreOk(g.pos, 0.11);
    } else {
      const b = s.body('europa');
      target = b.visible && inView(b.pos);
      const frac = (2 * b.radius) / fh;
      size = frac >= 0.12 && frac <= 0.85;
      sizeHint = frac < 0.12 ? HINTS.tooSmall : HINTS.tooLarge;
      centred = centreOk(b.pos, 0.11);
    }
    const focus = s.focusError() < 0.045;
    const exposure = s.exposure >= 0.36 && s.exposure <= 0.66;
    const checks: Checks = { target, centred: target && centred, size, focus, exposure };
    const hint = extraHint || (!target ? HINTS.noTarget : !size ? sizeHint : !centred ? HINTS.offCentre : !focus ? HINTS.focus : !exposure ? (s.exposure > 0.66 ? HINTS.over : HINTS.under) : '');
    return { checks, ready: Object.values(checks).every(Boolean), hint };
  }

  private async tryCapture() {
    const s = this.stage;
    if (!s || this.busy || this.objectiveIndex >= OBJECTIVES.length) return;
    this.busy = true;
    const r = this.evaluate();
    this.app.sfx.shutter();
    this.flash();
    const url = await s.capture();

    if (!r.ready) {
      this.app.sfx.error();
      this.showCard(url, 'Capture rejected', r.hint, false);
      void this.app.commander.say(r.hint, { interrupt: true });
      this.lastHintAt = performance.now();
      await wait(1600);
      this.busy = false;
      return;
    }

    const obj = this.objective;
    this.captures.push({ id: obj.id, url });
    this.app.sfx.success();
    this.app.link.buzz([40, 60, 40]);
    this.showCard(url, `Observation ${this.captures.length} confirmed`, obj.caption, true);
    this.addToGallery(url, obj.caption);
    this.paintProgress();
    s.timeScale = 1;
    // Science explanation plays while the player already works on the next objective.
    const explained = this.app.commander.say(obj.success as unknown as string[], { interrupt: true });

    if (this.objectiveIndex + 1 < OBJECTIVES.length) {
      await wait(1400);
      if (this.disposed) return;
      this.beginObjective(this.objectiveIndex + 1); // queues its instruction after the explanation
      this.busy = false;
    } else {
      this.objectiveIndex = OBJECTIVES.length;
      this.paintProgress();
      await explained;
      await this.app.commander.say(WRAP_UP);
      if (this.disposed) return;
      this.showReport();
    }
  }

  // ───────────────────────────────────────────────────────── per-frame
  private tick(dt: number) {
    const s = this.stage;
    if (!s || !this.hud || this.paused) return;
    const { input } = this.app;
    const h = window.innerHeight;

    // Pointing: sticks (WASD / arrows / phone pad) slew at a rate proportional to the field.
    const a = input.stickL(), b = input.stickR();
    const rate = s.fieldH * 0.75 * dt;
    s.pan((a.x + b.x) * rate, (a.y + b.y) * rate);
    // Mouse drag grabs the sky.
    const m = input.consumeMouse();
    if (m.dx || m.dy) s.pan((-m.dx / h) * s.fieldH, (m.dy / h) * s.fieldH);
    if (m.wheel) s.zoomBy(Math.pow(1.18, m.wheel));
    if (input.held('zoomIn', 'KeyE')) s.zoomBy(Math.exp(-dt * 1.5));
    if (input.held('zoomOut', 'KeyQ')) s.zoomBy(Math.exp(dt * 1.5));

    // Optics keys.
    let synced = false;
    if (input.key('KeyZ')) { s.focus = Math.max(0, s.focus - dt * 0.25); synced = true; }
    if (input.key('KeyX')) { s.focus = Math.min(1, s.focus + dt * 0.25); synced = true; }
    if (input.key('KeyC')) { s.exposure = Math.max(0, s.exposure - dt * 0.35); synced = true; }
    if (input.key('KeyV')) { s.exposure = Math.min(1, s.exposure + dt * 0.35); synced = true; }
    if (synced) this.syncPhone();

    if (this.objectiveIndex >= OBJECTIVES.length) return this.paintMeters();

    // Keep the Great Red Spot reachable: fast-forward rotation while it is out of view.
    if (this.objective.id === 'grs') {
      const ang = THREE.MathUtils.radToDeg(s.grsAngle());
      if (s.timeScale === 1 && (ang > 62 || ang < -115)) s.timeScale = 9;
      else if (s.timeScale > 1 && ang > -70 && ang < -45) s.timeScale = 1;
    } else s.timeScale = 1;

    const r = this.evaluate();
    if (r.ready && !this.wasReady) {
      this.app.sfx.blip();
      this.app.link.buzz(25);
    }
    this.wasReady = r.ready;
    this.paintChecks(r);
    this.paintMeters();
    this.paintLabels();

    const now = performance.now();
    // One-off teaching moments.
    if (!this.saidRefocus && Math.abs(Math.log(s.fieldH / this.lastField)) > 0.9 && s.focusError() > 0.08 && !this.app.commander.busy) {
      this.saidRefocus = true;
      void this.app.commander.say(HINTS.refocus);
    }
    if (!this.saidAmbient && this.objective.id === 'grs' && now - this.objectiveStart > 28000 && !this.app.commander.busy) {
      this.saidAmbient = true;
      void this.app.commander.say(HINTS.ambient);
    }
    // Gentle nudge if stuck for a while.
    if (!this.busy && !r.ready && now - this.objectiveStart > 40000 && now - this.lastHintAt > 22000 && !this.app.commander.busy) {
      this.lastHintAt = now;
      void this.app.commander.say(r.hint);
    }
    if (s.focusError() < 0.045) this.lastField = s.fieldH; // zoom level at which focus was last good

    this.app.link.hud({ objective: `${this.objective.code} · ${this.objective.short}`, vals: { focus: round3(s.focus), exposure: round3(s.exposure) } });
  }

  private syncPhone() {
    const s = this.stage;
    if (!s) return;
    this.app.link.hud({ vals: { focus: round3(s.focus), exposure: round3(s.exposure) } });
  }

  // ───────────────────────────────────────────────────────── HUD
  private buildHud() {
    const device = this.app.mode === 'device';
    const el = html(`
      <section class="jhud passthrough">
        <div class="scope-frame"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>
        <svg class="reticle" viewBox="-60 -60 120 120"><circle r="18" /><path d="M-56 0H-26M26 0H56M0 -56V-26M0 26V56" /><circle r="1.6" class="dot"/></svg>
        <div class="body-labels"></div>
        <div class="ready-tag mono">READY TO CAPTURE</div>

        <header class="jh-top">
          <div class="jh-inst">
            <div class="eyebrow">Hubble Space Telescope</div>
            <div class="jh-name">WFC3 · UVIS</div>
            <div class="jh-track mono"><i></i>Tracking · fine guidance lock</div>
          </div>
          <div class="jh-obj">
            <div class="mono jh-mission">MISSION 01 · DEEP SPACE OBSERVATORY</div>
            <div class="jh-obj-title"></div>
            <div class="chips mono">
              <span data-c="target">Target</span><span data-c="size">Size</span><span data-c="centred">Centred</span><span data-c="focus">Focus</span><span data-c="exposure">Exposure</span>
            </div>
          </div>
          <div class="jh-target panel"></div>
        </header>

        <aside class="jh-left panel mono">
          <div class="meter"><label>Zoom</label><div class="bar"><b class="zoom-b"></b></div><span class="zoom-v"></span></div>
          <div class="meter"><label>Field of view</label><span class="fov-v big"></span></div>
          <div class="meter"><label>Sharpness</label><div class="bar"><b class="sharp-b"></b></div><span class="sharp-v"></span></div>
          <div class="meter"><label>Focus position</label><div class="bar"><b class="focus-b"></b></div><span class="focus-v"></span></div>
          <div class="meter"><label>Exposure</label><div class="bar exp"><em></em><b class="exp-b"></b></div><span class="exp-v"></span></div>
          <div class="meter row"><label>Aperture</label><span>2.4 m · f/24</span></div>
          <div class="meter row"><label>Time-lapse</label><span class="tl-v"></span></div>
        </aside>

        <aside class="jh-right">
          <div class="panel jh-status mono">
            <div class="eyebrow">Instrument status</div>
            <div><span>Power</span><b class="ok">Nominal</b></div>
            <div><span>Pointing</span><b class="ok">Gyro (1-gyro mode)</b></div>
            <div><span>Detector</span><b class="ok">UVIS · 4096²</b></div>
            <div><span>Filters</span><b>Visible colour</b></div>
          </div>
          <div class="panel jh-progress">
            <div class="eyebrow">Observations</div>
            <ol class="mono"></ol>
          </div>
          <div class="jh-gallery"></div>
        </aside>

        ${device ? `<footer class="jh-keys mono">
          <span><b class="kbd">Drag</b>/<b class="kbd">WASD</b> point</span>
          <span><b class="kbd">Wheel</b>/<b class="kbd">Q</b><b class="kbd">E</b> zoom</span>
          <span><b class="kbd">Z</b><b class="kbd">X</b> focus</span>
          <span><b class="kbd">C</b><b class="kbd">V</b> exposure</span>
          <span><b class="kbd">Space</b> capture</span>
          <span><b class="kbd">Esc</b> pause</span>
        </footer>` : ''}
        <div class="shutter-flash"></div>
        <div class="capture-card panel"><img alt="" /><div><div class="cc-title mono"></div><div class="cc-sub"></div></div></div>
      </section>`);
    this.hud = el;
    this.paintObjective();
    this.paintProgress();
    return el;
  }

  private paintObjective() {
    if (!this.hud) return;
    const o = this.objective;
    $(this.hud, '.jh-obj-title').textContent = `OBJ ${o.code} · ${o.title.toUpperCase()}`;
    const info = TARGET_INFO[o.id];
    $(this.hud, '.jh-target').innerHTML = `
      <div class="eyebrow">Target</div>
      <div class="jt-name">${info.name}</div>
      ${info.rows.map(([k, v]) => `<div class="jt-row"><span>${k}</span><b>${v}</b></div>`).join('')}`;
    this.paintProgress();
  }

  private paintProgress() {
    if (!this.hud) return;
    $(this.hud, '.jh-progress ol').innerHTML = OBJECTIVES.map((o, i) => {
      const done = this.captures.some((c) => c.id === o.id);
      const active = i === this.objectiveIndex;
      return `<li class="${done ? 'done' : active ? 'active' : ''}"><i></i><span>${o.code} · ${o.title}</span></li>`;
    }).join('');
  }

  private paintChecks(r: Readiness) {
    const hud = this.hud!;
    for (const chip of $$(hud, '.chips span')) chip.classList.toggle('ok', r.checks[chip.dataset.c as CheckKey]);
    hud.classList.toggle('ready', r.ready);
  }

  private paintMeters() {
    const s = this.stage!, hud = this.hud!;
    const zoomFrac = Math.log(24 / s.fieldH) / Math.log(24 / 0.05);
    $(hud, '.zoom-b').style.transform = `scaleX(${zoomFrac.toFixed(3)})`;
    $(hud, '.zoom-v').textContent = `×${(24 / s.fieldH).toFixed(1)}`;
    const fov = s.fieldArcsec();
    $(hud, '.fov-v').textContent = fov >= 60 ? `${(fov / 60).toFixed(1)}′` : `${fov.toFixed(1)}″`;
    const sharp = Math.max(0, 1 - s.focusError() * 7);
    $(hud, '.sharp-b').style.transform = `scaleX(${sharp.toFixed(3)})`;
    $(hud, '.sharp-v').textContent = s.focusError() < 0.045 ? 'IN FOCUS' : `${Math.round(sharp * 100)}%`;
    $(hud, '.focus-b').style.transform = `scaleX(${s.focus.toFixed(3)})`;
    $(hud, '.focus-v').textContent = s.focus.toFixed(2);
    $(hud, '.exp-b').style.transform = `scaleX(${s.exposure.toFixed(3)})`;
    const ex = s.exposureSeconds();
    $(hud, '.exp-v').textContent = `${ex < 1 ? ex.toFixed(2) : ex.toFixed(1)} s${s.exposure > 0.66 ? ' · OVER' : s.exposure < 0.36 ? ' · UNDER' : ''}`;
    $(hud, '.tl-v').textContent = `×${Math.round(TIMELAPSE * s.timeScale).toLocaleString()}${s.timeScale > 1 ? ' ⏩' : ''}`;
  }

  private paintLabels() {
    const s = this.stage!, hud = this.hud!;
    const box = $(hud, '.body-labels');
    const items = s.bodiesInView();
    if (this.objective.id === 'grs') {
      const g = s.grs();
      if (g.visible && s.fieldH < 4) items.push(g);
    }
    box.innerHTML = items.map((b) => {
      const p = s.toScreen(b.pos);
      const rPx = (b.radius / s.fieldH) * window.innerHeight;
      if (b.key === 'jupiter' && rPx > window.innerHeight * 0.3) return '';
      const off = Math.max(10, rPx) + 8;
      return `<span class="blabel mono" style="left:${(p.x * 100).toFixed(2)}%;top:calc(${(p.y * 100).toFixed(2)}% - ${off.toFixed(0)}px)">${b.name}${b.key !== 'jupiter' && b.key !== 'grs' ? ` <em>${Math.round(Math.hypot(b.pos.x, b.pos.z) * RJ_KM / 1000).toLocaleString()}k km</em>` : ''}</span>`;
    }).join('');
  }

  private flash() {
    const f = $(this.hud!, '.shutter-flash');
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  private showCard(url: string, title: string, sub: string, ok: boolean) {
    const card = $(this.hud!, '.capture-card');
    $<HTMLImageElement>(card, 'img').src = url;
    $(card, '.cc-title').textContent = title.toUpperCase();
    $(card, '.cc-sub').textContent = sub;
    card.classList.toggle('bad', !ok);
    card.classList.remove('show');
    void card.offsetWidth;
    card.classList.add('show');
    clearTimeout((card as unknown as { _t: number })._t);
    (card as unknown as { _t: number })._t = window.setTimeout(() => card.classList.remove('show'), ok ? 4200 : 2400);
  }

  private addToGallery(url: string, caption: string) {
    const g = $(this.hud!, '.jh-gallery');
    g.appendChild(html(`<figure class="fade-up"><img src="${url}" alt="${escapeHtml(caption)}"><figcaption class="mono">${escapeHtml(caption)}</figcaption></figure>`));
  }

  // ───────────────────────────────────────────────────────── report
  private showReport() {
    const { app } = this;
    app.input.pointerEnabled = false;
    app.link.send({ t: 'layout', layout: 'lobby', title: 'Mission 01 complete', subtitle: 'Observation report on the main screen' });
    const figs = this.captures.map((c, i) => {
      const o = OBJECTIVES.find((x) => x.id === c.id)!;
      return `<figure class="fade-up" style="animation-delay:${0.15 + i * 0.12}s"><img src="${c.url}" alt=""><figcaption><span class="mono">OBS ${i + 1} · ${o.code}</span><b>${o.caption}</b><p>${escapeHtml(o.success[0])}</p></figcaption></figure>`;
    }).join('');
    const marsReady = app.missionAvailable('mars');
    const el = html(`
      <section class="report">
        <div class="report-inner">
          <div class="eyebrow">Mission 01 complete · Observation report</div>
          <h2>Deep Space Observatory</h2>
          <div class="report-figs">${figs}</div>
          <div class="jwst panel"><div class="eyebrow">${JWST_NOTE.title}</div><p>${JWST_NOTE.text}</p></div>
          <p class="report-src mono">Simulated observation. Jupiter imagery: Cassini map (NASA/JPL/SSI) · moon maps: NASA/USGS · facts: science.nasa.gov</p>
          <div class="report-actions">
            ${marsReady ? '<button class="btn primary next">Next: Mars expedition →</button>' : ''}
            <button class="btn ${marsReady ? '' : 'primary'} to-select">Mission select</button>
            <button class="btn ghost replay">Replay mission</button>
          </div>
        </div>
      </section>`);
    void app.screens.show(el);
    app.sfx.success();
    const exit = (e: MissionExit) => { app.sfx.click(); this.finish(e); };
    el.querySelector('.next')?.addEventListener('click', () => exit({ to: 'mission', id: 'mars' }));
    $(el, '.to-select').addEventListener('click', () => exit({ to: 'select' }));
    $(el, '.replay').addEventListener('click', () => exit({ to: 'restart' }));
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
