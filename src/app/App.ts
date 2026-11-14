import { Engine } from '../core/Engine';
import { Assets, ASSET_JOBS } from '../core/Assets';
import { Link } from '../core/Link';
import { Input, type ControlMode } from '../core/Input';
import { Sfx } from '../core/Sfx';
import { Commander } from '../core/Commander';
import { SpaceStage } from '../stages/SpaceStage';
import { ScreenHost, html, openModal, $, $$, wait } from '../ui/dom';
import { loadingScreen, mainMenu, controlSelect, pairingScreen, missionSelect, howToPlayHtml, sourcesHtml, creditsHtml, type MenuAction } from '../ui/screens';
import { missionEntries, MISSIONS } from '../missions/registry';

export type Quality = 'low' | 'medium' | 'high';

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
  private introDone = false;

  constructor() {
    const screenLayer = html('<div class="screen-layer"></div>');
    this.ui.append(screenLayer, this.badge, html('<div class="vignette"></div>'));
    this.screens = new ScreenHost(screenLayer);
    this.commander = new Commander(this.ui);
    this.applyQuality();

    this.input.onPress((id) => {
      if (id === 'skip') this.commander.skip();
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
  showMenu() {
    this.space.setShot('menu', 0.45);
    this.space.setOrionHighlight(0.6);
    this.link.send({ t: 'layout', layout: 'lobby', title: 'Controller linked', subtitle: 'Follow the main screen' });
    void this.screens.show(mainMenu(this.sfx, (a) => this.onMenu(a)));
  }

  private async onMenu(a: MenuAction) {
    switch (a) {
      case 'start':
        return this.showControlSelect();
      case 'howto':
        return openModal('How to play', howToPlayHtml(), () => this.sfx.back());
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

  showMissionSelect() {
    this.space.setShot('select', 0.5);
    this.link.send({ t: 'layout', layout: 'lobby', title: 'Choose your mission', subtitle: 'Tap a mission to launch it', missions: missionEntries() });
    const el = missionSelect(this.sfx, (id) => this.launch(id), () => { this.commander.clear(); this.showMenu(); });
    void this.screens.show(el);

    const offPhone = this.input.onPress((id) => {
      if (!id.startsWith('mission:') || !el.isConnected) return;
      const mid = id.slice(8);
      const card = el.querySelector<HTMLElement>(`.mission[data-id="${mid}"]`);
      card?.click();
    });
    const watch = setInterval(() => { if (!el.isConnected) { offPhone(); clearInterval(watch); } }, 1000);
  }

  private launch(id: string) {
    const m = MISSIONS.find((x) => x.id === id);
    if (!m?.enabled) return;
    // Mission modules are plugged in here (next milestone).
    this.toast(`Mission ${m.code} · ${m.title}: module arrives in the next build`);
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
    const pr = this.quality === 'low' ? 1 : this.quality === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    this.engine.renderer.setPixelRatio(pr);
    this.engine.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.engine.current?.resize(window.innerWidth, window.innerHeight);
  }

  private settingsPanel() {
    const el = html(`
      <div>
        <div class="settings-row"><span>Master volume</span><input type="range" min="0" max="1" step="0.05" class="vol"><span class="mono vol-v"></span></div>
        <div class="settings-row"><span>Commander voice</span><span class="muted">Spoken lines use your browser's built-in offline voice. Subtitles are always shown.</span><div class="seg voice"><button data-v="on">On</button><button data-v="off">Off</button></div></div>
        <div class="settings-row"><span>Graphics quality</span><span class="muted">Lower this if the frame rate drops on older laptops.</span><div class="seg quality"><button data-v="low">Low</button><button data-v="medium">Medium</button><button data-v="high">High</button></div></div>
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
    return el;
  }
}
