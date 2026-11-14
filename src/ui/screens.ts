import QRCode from 'qrcode';
import { $, $$, html, escapeHtml } from './dom';
import type { Link } from '../core/Link';
import type { Sfx } from '../core/Sfx';
import { MISSIONS } from '../missions/registry';
import { SOURCES } from '../data/sources';

const TITLE_SVG = `<span class="title-word">MISSION<span class="title-colon">:</span></span><span class="title-word accent">ORION</span>`;

/** Wire hover/click sounds onto every button in a screen. */
export function sounds(root: HTMLElement, sfx: Sfx) {
  for (const b of $$(root, 'button, .card')) {
    b.addEventListener('pointerenter', () => sfx.hover());
  }
}

// ─────────────────────────────────────────────────────────────── Loading
export function loadingScreen() {
  const el = html(`
    <section class="loading">
      <div class="loading-center">
        <div class="eyebrow fade-up" style="animation-delay:.2s">Remote mission operations simulator</div>
        <h1 class="title fade-up" style="animation-delay:.45s">${TITLE_SVG}</h1>
        <p class="tagline fade-up" style="animation-delay:.8s">Bring the NASA experience to your home.</p>
        <div class="progress fade-up" style="animation-delay:1.1s">
          <div class="progress-track"><div class="progress-fill"></div></div>
          <div class="progress-meta mono"><span class="progress-label">Initializing mission systems…</span><span class="progress-pct">0%</span></div>
        </div>
        <button class="begin btn primary" hidden>Begin <span class="kbd">CLICK</span></button>
      </div>
      <div class="loading-foot mono">
        <span>Background: the real night sky from NASA's Tycho star map, with the constellation <b>Orion</b> highlighted</span>
      </div>
    </section>`);
  const fill = $(el, '.progress-fill');
  const label = $(el, '.progress-label');
  const pct = $(el, '.progress-pct');
  return {
    el,
    progress(f: number, text: string) {
      fill.style.transform = `scaleX(${f})`;
      pct.textContent = `${Math.round(f * 100)}%`;
      label.textContent = text;
    },
    error(msg: string) {
      label.textContent = msg;
      el.classList.add('has-error');
    },
    /** Shows the Begin prompt (needed so audio/voice can start). */
    ready(): Promise<void> {
      label.textContent = 'All mission systems nominal';
      $(el, '.progress').classList.add('done');
      const btn = $(el, '.begin');
      btn.hidden = false;
      btn.classList.add('fade-up');
      return new Promise((resolve) => {
        const go = () => {
          window.removeEventListener('keydown', go);
          resolve();
        };
        btn.addEventListener('click', go);
        window.addEventListener('keydown', go);
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────── Main menu
export type MenuAction = 'start' | 'howto' | 'settings' | 'sources' | 'credits';

export function mainMenu(sfx: Sfx, onAction: (a: MenuAction) => void) {
  const el = html(`
    <section class="menu">
      <div class="menu-col">
        <div class="eyebrow fade-up" style="animation-delay:.1s">NASA Space Apps Challenge project</div>
        <h1 class="title small fade-up" style="animation-delay:.2s">${TITLE_SVG}</h1>
        <p class="tagline fade-up" style="animation-delay:.35s">Bring the NASA experience to your home.</p>
        <nav class="menu-nav">
          <button class="btn primary fade-up" data-a="start" style="animation-delay:.5s"><span class="idx mono">01</span>Start mission</button>
          <button class="btn fade-up" data-a="howto" style="animation-delay:.58s"><span class="idx mono">02</span>How to play</button>
          <button class="btn fade-up" data-a="settings" style="animation-delay:.66s"><span class="idx mono">03</span>Settings</button>
          <button class="btn fade-up" data-a="sources" style="animation-delay:.74s"><span class="idx mono">04</span>Mission data &amp; sources</button>
          <button class="btn fade-up" data-a="credits" style="animation-delay:.82s"><span class="idx mono">05</span>Credits</button>
        </nav>
        <div class="verbs mono fade-up" style="animation-delay:1s"><span>Observe</span><i></i><span>Explore</span><i></i><span>Maintain</span></div>
      </div>
      <div class="menu-foot mono">Earth: NASA Blue Marble &amp; Black Marble · Sky: NASA Tycho star map</div>
    </section>`);
  for (const b of $$(el, '[data-a]')) {
    b.addEventListener('click', () => {
      sfx.click();
      onAction(b.dataset.a as MenuAction);
    });
  }
  sounds(el, sfx);
  return el;
}

// ─────────────────────────────────────────────────────────────── Control mode
export function controlSelect(sfx: Sfx, onPick: (m: 'phone' | 'device') => void, onBack: () => void) {
  const el = html(`
    <section class="choose">
      <header class="screen-head">
        <div class="eyebrow">Step 1 of 2 · Operator console</div>
        <h2>Choose your controls</h2>
        <p>You can switch at any time from the pause menu <span class="kbd">ESC</span>.</p>
      </header>
      <div class="choose-cards">
        <button class="card choice brackets fade-up" data-m="phone" style="animation-delay:.1s">
          <div class="choice-icon">${PHONE_ICON}</div>
          <div class="eyebrow">Recommended</div>
          <h3>Phone controller</h3>
          <p>Use your smartphone as a dedicated mission controller: joysticks, zoom, focus and capture, right in your hand.</p>
          <ul class="mono"><li>Scan a QR code</li><li>Same Wi-Fi or hotspot</li><li>No app install</li></ul>
        </button>
        <button class="card choice brackets fade-up" data-m="device" style="animation-delay:.2s">
          <div class="choice-icon">${KEYBOARD_ICON}</div>
          <div class="eyebrow">&nbsp;</div>
          <h3>This device</h3>
          <p>Play with keyboard and mouse. Key hints are shown on screen during every mission.</p>
          <ul class="mono"><li>WASD · Arrows</li><li>Mouse drag &amp; wheel</li><li>Space · E</li></ul>
        </button>
      </div>
      <button class="btn ghost back">← Back</button>
    </section>`);
  for (const b of $$(el, '.choice')) b.addEventListener('click', () => { sfx.click(); onPick(b.dataset.m as 'phone' | 'device'); });
  $(el, '.back').addEventListener('click', () => { sfx.back(); onBack(); });
  sounds(el, sfx);
  return el;
}

// ─────────────────────────────────────────────────────────────── Pairing
export function pairingScreen(link: Link, sfx: Sfx, onDone: (mode: 'phone' | 'device') => void, onBack: () => void) {
  const el = html(`
    <section class="pairing">
      <header class="screen-head">
        <div class="eyebrow">Step 2 of 2 · Controller link</div>
        <h2>Link your phone</h2>
      </header>
      <div class="pair-grid">
        <div class="qr-box panel brackets">
          <canvas class="qr"></canvas>
          <div class="qr-pending mono">Starting link server…</div>
        </div>
        <div class="pair-steps">
          <ol>
            <li><b>Connect</b> your phone to the <b>same Wi-Fi</b> or hotspot as this computer.</li>
            <li><b>Scan</b> the QR code with your phone camera.</li>
            <li>Or open this address in the phone browser:<div class="pair-url mono">…</div></li>
          </ol>
          <div class="pin-row"><span class="eyebrow">Session PIN</span><span class="pin mono">----</span></div>
          <div class="pair-status" data-s="waiting"><i></i><span>Waiting for controller…</span></div>
          <div class="pair-actions">
            <button class="btn primary continue" disabled>Continue</button>
            <button class="btn ghost device">Use this device instead</button>
          </div>
          <p class="pair-help">Not connecting? Phones on guest/venue Wi-Fi often can't see other devices. Turn on a <b>mobile hotspot</b>, join both devices to it, and allow Node.js through the Windows firewall if asked.</p>
        </div>
      </div>
      <button class="btn ghost back">← Back</button>
    </section>`);
  const canvas = $<HTMLCanvasElement>(el, '.qr');
  const status = $(el, '.pair-status');
  const cont = $<HTMLButtonElement>(el, '.continue');
  let lastUrl = '';
  let autoTimer = 0;

  const refresh = () => {
    const url = link.controllerUrl;
    $(el, '.pin').textContent = link.pin ?? '----';
    if (url && url !== lastUrl) {
      lastUrl = url;
      $(el, '.pair-url').textContent = url;
      void QRCode.toCanvas(canvas, url, { width: 232, margin: 1, color: { dark: '#e9eef6', light: '#00000000' } });
      $(el, '.qr-pending').hidden = true;
    } else if (!url) {
      $(el, '.qr-pending').textContent = link.status === 'offline' ? 'Link server offline: retrying…' : link.addresses.length === 0 && link.pin ? 'No network found. Connect this PC to Wi-Fi or a hotspot.' : 'Starting link server…';
    }
    const linked = link.peerConnected;
    status.dataset.s = linked ? 'linked' : 'waiting';
    $(status, 'span').textContent = linked ? 'Controller linked' : 'Waiting for controller…';
    cont.disabled = !linked;
    if (linked && !autoTimer) {
      sfx.linked();
      autoTimer = window.setTimeout(() => onDone('phone'), 1600);
    } else if (!linked && autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = 0;
    }
  };
  const off = link.onChange(refresh);
  refresh();

  cont.addEventListener('click', () => { sfx.click(); clearTimeout(autoTimer); onDone('phone'); });
  $(el, '.device').addEventListener('click', () => { sfx.click(); clearTimeout(autoTimer); onDone('device'); });
  $(el, '.back').addEventListener('click', () => { sfx.back(); clearTimeout(autoTimer); onBack(); });
  sounds(el, sfx);
  return { el, dispose: () => { off(); clearTimeout(autoTimer); } };
}

// ─────────────────────────────────────────────────────────────── Mission select
export function missionSelect(sfx: Sfx, onPick: (id: string) => void, onBack: () => void) {
  const cards = MISSIONS.map((m, i) => `
    <button class="card mission brackets fade-up ${m.enabled ? '' : 'locked'}" data-id="${m.id}" style="animation-delay:${0.1 + i * 0.1}s" ${m.enabled ? '' : 'aria-disabled="true"'}>
      <div class="mission-img ${m.image ? '' : 'blueprint'}" style="${m.image ? `background-image:url('${m.image}');` : ''}background-position:${m.imagePos};${m.imageSize ? `background-size:${m.imageSize};` : ''}${m.imageFilter ? `filter:${m.imageFilter}` : ''}"></div>
      <div class="mission-shade"></div>
      <div class="mission-body">
        <div class="mission-top mono"><span>MISSION ${m.code}</span><span class="verb">${m.verb}</span></div>
        <h3>${escapeHtml(m.title)}</h3>
        <div class="mission-sub">${escapeHtml(m.subtitle)}</div>
        <p>${escapeHtml(m.description)}</p>
        <div class="mission-meta mono"><span>${escapeHtml(m.instrument)}</span><span>${m.duration}</span></div>
        ${m.enabled ? '<div class="mission-cta">Launch mission →</div>' : '<div class="tag fiction">In development</div>'}
      </div>
    </button>`).join('');
  const el = html(`
    <section class="select">
      <header class="screen-head">
        <div class="eyebrow">Mission control · Select operation</div>
        <h2>Choose your mission</h2>
      </header>
      <div class="mission-cards">${cards}</div>
      <button class="btn ghost back">← Main menu</button>
    </section>`);
  for (const c of $$(el, '.mission')) {
    c.addEventListener('click', () => {
      if (c.classList.contains('locked')) { sfx.error(); c.classList.add('shake'); setTimeout(() => c.classList.remove('shake'), 400); return; }
      sfx.confirm();
      onPick(c.dataset.id!);
    });
  }
  $(el, '.back').addEventListener('click', () => { sfx.back(); onBack(); });
  sounds(el, sfx);
  return el;
}

// ─────────────────────────────────────────────────────────────── Modals content
export function howToPlayHtml() {
  return `
    <div class="howto">
      <p>You are a remote mission operator. The <b>AI Mission Commander</b> guides you through each operation. Use your phone controller or this computer.</p>
      <div class="howto-grid">
        <div>
          <h4>Mission 01 · Jupiter telescope</h4>
          <table>
            <tr><td>Point telescope</td><td><span class="kbd">Drag</span> or <span class="kbd">WASD</span></td><td>Phone touch pad</td></tr>
            <tr><td>Zoom</td><td><span class="kbd">Wheel</span> or <span class="kbd">Q</span>/<span class="kbd">E</span></td><td>Zoom − / +</td></tr>
            <tr><td>Focus</td><td><span class="kbd">Z</span>/<span class="kbd">X</span></td><td>Focus slider</td></tr>
            <tr><td>Exposure</td><td><span class="kbd">C</span>/<span class="kbd">V</span></td><td>Exposure slider</td></tr>
            <tr><td>Capture image</td><td><span class="kbd">Space</span></td><td>Capture button</td></tr>
          </table>
        </div>
        <div>
          <h4>Mission 02 · Mars rover</h4>
          <table>
            <tr><td>Drive</td><td><span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span></td><td>Left joystick</td></tr>
            <tr><td>Look around</td><td><span class="kbd">Drag</span> or arrows</td><td>Right joystick</td></tr>
            <tr><td>Camera distance</td><td><span class="kbd">Wheel</span></td><td>-</td></tr>
            <tr><td>Interact / collect</td><td><span class="kbd">E</span></td><td>Interact button</td></tr>
          </table>
        </div>
      </div>
      <p class="muted"><span class="kbd">TAB</span> skips commander lines · <span class="kbd">ESC</span> pause menu · the keyboard always works, even in phone mode.</p>
    </div>`;
}

export function sourcesHtml() {
  const rows = SOURCES.map((s) => `
    <li>
      <span class="tag ${s.kind}">${s.kind === 'real' ? 'Real NASA data' : s.kind === 'simplified' ? 'Simplified' : 'Fictional'}</span>
      <div><b>${escapeHtml(s.title)}</b><div class="muted">${escapeHtml(s.usedFor)}</div><div class="credit mono">${escapeHtml(s.credit)}${s.url ? ` · ${escapeHtml(s.url)}` : ''}</div></div>
    </li>`).join('');
  return `<p class="muted">Every visual dataset in MISSION: ORION comes from NASA and USGS public archives. Scientific facts are cited where they appear. Anything simplified or invented for gameplay is labelled.</p><ul class="sources">${rows}</ul>`;
}

export function creditsHtml() {
  return `
    <div class="credits">
      <p><b>MISSION: ORION</b> was built in 24 hours for the NASA Space Apps Challenge.</p>
      <h4>Team</h4>
      <p class="muted">Team name and members go here.</p>
      <h4>Data &amp; imagery</h4>
      <p class="muted">NASA, NASA/JPL-Caltech, University of Arizona (HiRISE), USGS Astrogeology Science Center, Space Science Institute, NASA Earth Observatory, NASA 3D Resources. Use of NASA data does not imply endorsement by NASA.</p>
      <h4>Built with</h4>
      <p class="muted">three.js · Vite · TypeScript · Web Audio · Web Speech. All sound is synthesised in the browser.</p>
    </div>`;
}

const PHONE_ICON = `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="14" y="4" width="20" height="40" rx="3"/><path d="M21 8h6"/><circle cx="20" cy="30" r="3.2"/><circle cx="29" cy="25" r="2"/><circle cx="29" cy="33" r="2"/></svg>`;
const KEYBOARD_ICON = `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="14" width="42" height="20" rx="2.5"/><path d="M9 20h2M15 20h2M21 20h2M27 20h2M33 20h2M39 20h0M9 26h2M15 26h18M37 26h2"/></svg>`;
