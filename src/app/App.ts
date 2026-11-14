import { Engine } from '../core/Engine';
import { Assets, ASSET_JOBS } from '../core/Assets';
import { Link } from '../core/Link';
import { Input, type ControlMode } from '../core/Input';
import { Sfx } from '../core/Sfx';
import { Commander } from '../core/Commander';
import { SpaceStage } from '../stages/SpaceStage';
import { ScreenHost, html, openModal, $, $$, wait } from '../ui/dom';
import * as THREE from 'three';
import { loadingScreen, controlSelect, pairingScreen, howToPlayHtml, sourcesHtml, creditsHtml } from '../ui/screens';
import { codMainMenu, codMissionSelect, type CodMenuAction } from '../ui/codScreens';
import { SelectStage } from '../stages/SelectStage';
import { missionEntries, MISSIONS } from '../missions/registry';

import type { Mission } from '../missions/types';

export type Quality = 'low' | 'medium' | 'high';

/** Mission modules are code-split and loaded on launch. Add new missions here. */
const MISSION_LOADERS: Record<string, () => Promise<new (app: App) => Mission>> = {
  jupiter: async () => (await import('../missions/jupiter/JupiterMission')).JupiterMission,
  mars: async () => (await import('../missions/mars/MarsMission')).MarsMission,
};

/** Owns the shared systems and drives the menu flow between missions. */
export class App {
  readonly ui = document.getElementById('ui')!;
  readonly canvas = document.getElementById('scene') as HTMLCanvasElement;
  readonly engine = new Engine(this.canvas);
  readonly assets = new Assets();
  readonly link = new Link();
  readonly input = new Input(this.link, this.canvas);
  readonly sfx = new Sfx();
  readonly screens: ScreenHost;
  readonly commander: Commander;
  space!: SpaceStage;
  quality: Quality = (localStorage.getItem('orion.quality') as Quality) || 'high';

  private badge = html(`<div class="link-badge" hidden><i></i><span></span></div>`);
  private mission: Mission | null = null;
  private introDone = false;

  constructor() {
    const screenLayer = html('<div class="screen-layer"></div>');
    this.ui.append(screenLayer, this.badge, html('<div class="vignette"></div>'));
    this.screens = new ScreenHost(screenLayer);
    this.commander = new Commander(this.ui);
    this.applyQuality();

    this.input.onPress((id) => {
      if (id === 'skip') this.commander.skip();
      if (id === 'pause') this.togglePause();
    });
    this.link.onChange(() => this.updateBadge());
  }

  get mode(): ControlMode {
    return this.input.mode;
  }

  // ───────────────────────────────────────────── boot + loading
  async boot() {
    const loading = loadingScreen();
    await this.screens.show(loading.el);

    // Phase 1: the sky + Earth (needed to draw the backdrop), then everything else.
    const first = ASSET_JOBS.filter((j) => ['stars', 'earthDay', 'earthNight'].includes(j.key));
    const rest = ASSET_JOBS.filter((j) => !first.includes(j));
    const total = ASSET_JOBS.reduce((s, j) => s + j.kb, 0);
    const w1 = first.reduce((s, j) => s + j.kb, 0) / total;
    try {
      await this.assets.loadAll(first, (f, label) => loading.progress(f * w1, label));
      this.space = new SpaceStage(this.assets, this.engine.renderer);
      this.engine.setStage(this.space);
      this.space.setShot('loading');
      await this.assets.loadAll(rest, (f, label) => loading.progress(w1 + f * (1 - w1), label));
    } catch (err) {
      loading.error(`${(err as Error).message}. Check that the files exist in /public and reload.`);
      return;
    }
    if (this.assets.failed.length) console.warn('[assets] optional assets missing, using fallbacks:', this.assets.failed);
    loading.progress(1, 'All mission systems nominal');
    await wait(300);

    await loading.ready();
    this.sfx.unlock();
    this.sfx.setAmbience('space');
    this.sfx.confirm();
    this.showMenu();
  }

  // ───────────────────────────────────────────── menu flow
  private modeChosen = false;
  private selectStage: SelectStage | null = null;

  showMenu() {
    this.engine.setStage(this.space);
    this.space.setShot('menu', 0.45);
    this.space.setOrionHighlight(0.6);
    const hubble = this.assets.models.hubble?.scene;
    // Hubble in silhouette against the orbital sunrise (sits between camera and Sun)
    if (hubble) this.space.showModel(hubble.clone(true), 3.4, { silhouette: true, position: new THREE.Vector3(3.9, -0.05, 14.2) });
    this.link.send({ t: 'layout', layout: 'lobby', title: 'Controller linked', subtitle: 'Follow the main screen' });
    void this.screens.show(codMainMenu(this.sfx, (a) => this.onMenu(a)));
  }

  private async onMenu(a: CodMenuAction) {
    switch (a) {
      case 'start':
        return this.showControlSelect();
      case 'select':
        return this.modeChosen ? this.showMissionSelect() : this.showControlSelect();
      case 'controls':
        return openModal('Controls', howToPlayHtml(), () => this.sfx.back());
      case 'settings':
        return openModal('Settings', this.settingsPanel(), () => this.sfx.back());
      case 'sources':
        return openModal('Mission data & sources', sourcesHtml(), () => this.sfx.back());
      case 'credits':
        return openModal('Credits', creditsHtml(), () => this.sfx.back());
    }
  }

  showControlSelect() {
    this.space.setShot('menu', 0.5);
    this.space.setOrionHighlight(0);
    void this.screens.show(controlSelect(this.sfx, (m) => this.onControlPicked(m), () => { this.commander.clear(); this.showMenu(); }));
    if (!this.introDone) {
      this.introDone = true;
      void this.commander.say([
        'Welcome, Operator. I am ORION Control, your Mission Commander.',
        'Today you will operate NASA-inspired instruments and robotic explorers, from right here on Earth.',
        'First, choose how you would like to control your missions.',
      ]);
    }
  }

  private onControlPicked(mode: ControlMode) {
    if (mode === 'device') return this.setMode('device', true);
    const pairing = pairingScreen(this.link, this.sfx, (m) => { pairing.dispose(); this.setMode(m, true); }, () => { pairing.dispose(); this.showControlSelect(); });
    void this.screens.show(pairing.el);
    void this.commander.say('Scan the code with your phone camera. Both devices need to be on the same network.', { interrupt: true });
  }

  setMode(mode: ControlMode, announce = false) {
    this.input.mode = mode;
    this.modeChosen = true;
    this.updateBadge();
    if (announce) {
      void this.commander.say(
        mode === 'phone'
          ? 'Controller linked. Every input on your phone now drives the mission. The keyboard stays active as a backup.'
          : 'Keyboard and mouse confirmed. Control hints will appear on screen during each mission.',
        { interrupt: true },
      );
    }
    this.showMissionSelect();
  }

  showMissionSelect(from?: string) {
    this.space.showModel(null);
    if (!this.selectStage) this.selectStage = new SelectStage(this.assets, this.engine.renderer);
    const stage = this.selectStage;
    stage.reset(from === 'iss' ? 'earth' : from); // returning from a mission: pull out from its planet
    stage.resize(window.innerWidth, window.innerHeight);
    this.engine.setStage(stage);
    this.link.send({ t: 'layout', layout: 'lobby', title: 'Choose your mission', subtitle: 'Tap a mission to launch it', missions: missionEntries() });

    let launching = false;
    const ui = codMissionSelect(this.sfx, {
      onFocus: (m) => stage.setFocus(m ? (m.id === 'iss' ? 'earth' : (m.id as 'jupiter' | 'mars')) : 'overview'),
      onLaunch: async (m) => {
        if (launching) return;
        launching = true;
        this.commander.clear();
        await stage.dive();
        void this.launch(m.id);
      },
      onTab: (t) => {
        if (t === 'controls') void openModal('Controls', howToPlayHtml(), () => this.sfx.back());
        if (t === 'settings') void openModal('Settings', this.settingsPanel(), () => this.sfx.back());
        if (t === 'sources') void openModal('Mission data & sources', sourcesHtml(), () => this.sfx.back());
        if (t === 'credits') void openModal('Credits', creditsHtml(), () => this.sfx.back());
      },
      onBack: () => { if (!launching) { this.commander.clear(); this.showMenu(); } },
    });
    void this.screens.show(ui.el);

    const offTick = this.engine.onTick(() => ui.setLabels(stage.labels(window.innerWidth, window.innerHeight)));
    const offPhone = this.input.onPress((id) => {
      if (id.startsWith('mission:') && ui.el.isConnected) (ui as unknown as { launchId: (id: string) => void }).launchId(id.slice(8));
    });
    const watch = setInterval(() => { if (!ui.el.isConnected) { offPhone(); offTick(); clearInterval(watch); } }, 500);
  }

  // ───────────────────────────────────────────── missions
  missionAvailable(id: string) {
    return !!MISSION_LOADERS[id] && !!MISSIONS.find((m) => m.id === id)?.enabled;
  }

  private async launch(id: string): Promise<void> {
    const m = MISSIONS.find((x) => x.id === id);
    const load = MISSION_LOADERS[id];
    if (!m?.enabled || !load) {
      this.toast(`Mission ${m?.code ?? ''} · ${m?.title ?? id} is not available yet`);
      return;
    }
    if (this.mission) return;
    this.commander.clear();
    const Ctor = await load();
    const mission = new Ctor(this);
    this.mission = mission;
    const exit = await mission.start();
    this.closePause();
    mission.dispose();
    this.mission = null;
    this.commander.clear();
    this.engine.setStage(this.space);
    this.sfx.setAmbience('space');
    this.input.pointerEnabled = false;
    if (exit.to === 'restart') return this.launch(id);
    if (exit.to === 'mission') return this.launch(exit.id);
    this.showMissionSelect(id);
  }

  // ───────────────────────────────────────────── pause menu
  private pauseEl: HTMLElement | null = null;

  private togglePause() {
    if (!this.mission) return;
    if (this.pauseEl) return this.closePause();
    this.mission.setPaused(true);
    this.commander.clear();
    this.sfx.back();
    const other = this.mode === 'phone' ? 'device' : 'phone';
    const el = html(`
      <div class="pause-backdrop">
        <div class="pause panel brackets">
          <div class="eyebrow">Mission paused</div>
          <h2>Operator console</h2>
          <nav>
            <button class="btn primary" data-a="resume">Resume <span class="kbd">ESC</span></button>
            <button class="btn" data-a="howto">How to play</button>
            <button class="btn" data-a="switch">Switch to ${other === 'phone' ? 'phone controller' : 'keyboard &amp; mouse'}</button>
            <button class="btn" data-a="restart">Restart mission</button>
            <button class="btn ghost" data-a="abort">Abort to mission select</button>
          </nav>
          <div class="pause-qr" hidden></div>
        </div>
      </div>`);
    el.addEventListener('click', async (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (!a) return;
      this.sfx.click();
      if (a === 'resume') this.closePause();
      if (a === 'howto') void openModal('How to play', howToPlayHtml(), () => this.sfx.back());
      if (a === 'restart') this.mission?.abort({ to: 'restart' });
      if (a === 'abort') this.mission?.abort({ to: 'select' });
      if (a === 'switch') {
        this.input.mode = other;
        this.updateBadge();
        if (other === 'phone' && !this.link.peerConnected) {
          const box = $(el, '.pause-qr');
          box.hidden = false;
          const url = this.link.controllerUrl;
          box.innerHTML = `<canvas></canvas><div class="mono">PIN <b>${this.link.pin ?? '----'}</b><br>${url ?? 'No network'}</div>`;
          if (url) void (await import('qrcode')).default.toCanvas(box.querySelector('canvas')!, url, { width: 150, margin: 1, color: { dark: '#e9eef6', light: '#00000000' } });
        } else this.closePause();
        this.toast(other === 'phone' ? 'Phone controller mode' : 'Keyboard & mouse mode');
      }
    });
    this.pauseEl = el;
    this.ui.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
  }

  private closePause() {
    if (!this.pauseEl) return;
    const el = this.pauseEl;
    this.pauseEl = null;
    el.classList.remove('in');
    setTimeout(() => el.remove(), 250);
    this.mission?.setPaused(false);
  }

  // ───────────────────────────────────────────── helpers
  toast(text: string, ms = 2600) {
    const t = html(`<div class="toast panel">${text}</div>`);
    this.ui.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 400); }, ms);
  }

  private updateBadge() {
    const linked = this.link.peerConnected;
    const show = this.input.mode === 'phone' || linked;
    this.badge.hidden = !show;
    this.badge.dataset.s = linked ? 'linked' : 'lost';
    $(this.badge, 'span').textContent = linked ? 'Controller linked' : 'Controller disconnected: keyboard active';
  }

  applyQuality() {
    const dpr = window.devicePixelRatio || 1;
    const pr = this.quality === 'low' ? Math.min(dpr, 1) * 0.85 : this.quality === 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 1.75);
    this.engine.targetFps = 58;
    this.engine.setBasePixelRatio(pr);
  }

  private settingsPanel() {
    const el = html(`
      <div>
        <div class="settings-row"><span>Master volume</span><input type="range" min="0" max="1" step="0.05" class="vol"><span class="mono vol-v"></span></div>
        <div class="settings-row"><span>Commander voice</span><span class="muted">Spoken lines use your browser's built-in offline voice. Subtitles are always shown.</span><div class="seg voice"><button data-v="on">On</button><button data-v="off">Off</button></div></div>
        <div class="settings-row"><span>Graphics quality</span><span class="muted">Shadows, anti-aliasing, light shafts, rock density and effects. Takes effect on the next mission.</span><div class="seg quality"><button data-v="low">Low</button><button data-v="medium">Medium</button><button data-v="high">High</button></div></div>
        <div class="settings-row"><span>Dynamic resolution</span><span class="muted">Automatically lowers render resolution to hold ~60 FPS (the HUD stays sharp).</span><div class="seg drs"><button data-v="on">On</button><button data-v="off">Off</button></div></div>
        <div class="settings-row"><span>Performance overlay</span><span class="muted">FPS, frame time, resolution and draw calls. Shortcut: F3.</span><div class="seg fps"><button data-v="on">On</button><button data-v="off">Off</button></div></div>
      </div>`);
    const vol = $<HTMLInputElement>(el, '.vol');
    vol.value = String(this.sfx.level);
    const showVol = () => ($(el, '.vol-v').textContent = `${Math.round(Number(vol.value) * 100)}%`);
    showVol();
    vol.addEventListener('input', () => { this.sfx.setVolume(Number(vol.value)); showVol(); });
    vol.addEventListener('change', () => this.sfx.blip());

    const seg = (sel: string, current: string, apply: (v: string) => void) => {
      const btns = $$(el, `${sel} button`);
      const paint = (v: string) => btns.forEach((b) => b.classList.toggle('on', b.dataset.v === v));
      paint(current);
      btns.forEach((b) => b.addEventListener('click', () => { this.sfx.click(); apply(b.dataset.v!); paint(b.dataset.v!); }));
    };
    seg('.voice', this.commander.voiceEnabled ? 'on' : 'off', (v) => {
      this.commander.setVoiceEnabled(v === 'on');
      if (v === 'on') void this.commander.say('Voice channel online.', { interrupt: true });
    });
    seg('.quality', this.quality, (v) => {
      this.quality = v as Quality;
      localStorage.setItem('orion.quality', v);
      this.applyQuality();
    });
    seg('.drs', this.engine.drsEnabled ? 'on' : 'off', (v) => {
      this.engine.drsEnabled = v === 'on';
      if (!this.engine.drsEnabled) { this.engine.resScale = 1; this.engine.applyPixelRatio(); }
    });
    seg('.fps', document.querySelector('.perf-stats') ? 'on' : 'off', (v) => this.engine.toggleStats(v === 'on'));
    return el;
  }
}
