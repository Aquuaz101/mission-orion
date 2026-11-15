import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/inter/400.css';
import '@fontsource/jetbrains-mono/400.css';
import '../src/styles/base.css';
import './controller.css';
import { LINK_PATH, type ControllerLayout, type CtrlMsg, type HostMsg, type HudState, type MissionEntry, type RelayMsg } from '../src/shared/protocol';
import { PEER_LINK, PeerControllerSocket } from '../src/shared/peerSocket';

/* ────────────────────────────────────────────────────────────────
   MISSION: ORION phone controller. Connects to the PC's local relay
   with the session PIN and sends real inputs; renders a layout per
   mission as instructed by the PC.
   ──────────────────────────────────────────────────────────────── */

const app = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
let pin = params.get('pin') ?? localStorage.getItem('orion.ctrl.pin') ?? '';
let ws: WebSocket | null = null;
let retry = 0;
let hostOnline = false;
let layout: ControllerLayout | null = null;
let hud: HudState = {};

const h = (markup: string) => {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as HTMLElement;
};

app.innerHTML = `
  <header class="c-head">
    <div class="c-brand"><span class="mono">MISSION<b>:</b></span> ORION</div>
    <div class="c-status" data-s="connecting"><i></i><span>Connecting…</span></div>
  </header>
  <main class="c-main"></main>
  <div class="c-overlay" hidden><div class="c-overlay-box"><div class="spinner"></div><p class="c-overlay-text">Waiting for mission computer…</p></div></div>`;
const main = app.querySelector<HTMLElement>('.c-main')!;
const statusEl = app.querySelector<HTMLElement>('.c-status')!;
const overlay = app.querySelector<HTMLElement>('.c-overlay')!;

// ─────────────────────────────────────────────── networking
function send(msg: CtrlMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function setStatus(s: 'connecting' | 'linked' | 'waiting' | 'offline', text: string) {
  statusEl.dataset.s = s;
  statusEl.querySelector('span')!.textContent = text;
  overlay.hidden = s === 'linked' || !layout;
  overlay.querySelector('.c-overlay-text')!.textContent =
    s === 'offline' ? 'Connection lost: reconnecting…' : s === 'waiting' ? 'Waiting for mission computer…' : 'Connecting…';
}

function connect() {
  if (!/^\d{4}$/.test(pin)) return showPinEntry();
  localStorage.setItem('orion.ctrl.pin', pin);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = PEER_LINK
    ? (new PeerControllerSocket(pin) as unknown as WebSocket)
    : new WebSocket(`${proto}://${location.host}${LINK_PATH}?role=controller&pin=${pin}`);
  ws = sock;
  setStatus('connecting', 'Connecting…');
  sock.onmessage = (ev) => {
    const msg = JSON.parse(ev.data) as RelayMsg | HostMsg;
    switch (msg.t) {
      case 'joined':
        retry = 0;
        if (!layout) renderLayout('lobby', 'Controller linked', 'Follow the main screen');
        return;
      case 'peer':
        hostOnline = msg.connected;
        setStatus(hostOnline ? 'linked' : 'waiting', hostOnline ? `Linked · ${pin}` : 'PC offline');
        if (hostOnline) vibrate([20, 40, 20]);
        return;
      case 'error':
        if (msg.code === 'bad-pin') {
          localStorage.removeItem('orion.ctrl.pin');
          showPinEntry('Session not found. Check the PIN on the main screen.');
        }
        return;
      case 'layout':
        renderLayout(msg.layout, msg.title, msg.subtitle, msg.missions, msg.cta);
        return;
      case 'hud':
        hud = { ...hud, ...msg.hud };
        applyHud();
        return;
      case 'buzz':
        vibrate(msg.pattern);
        return;
    }
  };
  sock.onclose = (ev) => {
    if (ws !== sock) return;
    if (ev.code === 4004) return; // bad pin, handled
    if (ev.code === 4001) { setStatus('offline', 'Replaced by another phone'); return; }
    setStatus('offline', 'Reconnecting…');
    setTimeout(connect, Math.min(4000, 400 * 2 ** retry++));
  };
}

document.addEventListener('visibilitychange', () => {
  // Phones kill sockets in the background; reconnect immediately on return.
  if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1)) connect();
});

// Browsers only allow vibration after the first touch.
let touched = false;
window.addEventListener('pointerdown', () => (touched = true), { capture: true, once: true });
function vibrate(p: number | number[]) {
  if (!touched) return;
  try { navigator.vibrate?.(p); } catch { /* not supported (iOS) */ }
}

// ─────────────────────────────────────────────── PIN entry
function showPinEntry(error = '') {
  layout = null;
  overlay.hidden = true;
  setStatusText('Not connected');
  main.innerHTML = '';
  const el = h(`
    <section class="pin-entry">
      <div class="eyebrow">Controller link</div>
      <h1>Enter session PIN</h1>
      <p>The 4-digit PIN is shown on the main screen's pairing page.</p>
      <input class="pin-input mono" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" value="${pin.replace(/\D/g, '').slice(0, 4)}" />
      <p class="pin-error">${error}</p>
      <button class="btn primary join">Link controller</button>
    </section>`);
  main.appendChild(el);
  const input = el.querySelector<HTMLInputElement>('.pin-input')!;
  const go = () => {
    pin = input.value.trim();
    if (/^\d{4}$/.test(pin)) connect();
    else el.querySelector('.pin-error')!.textContent = 'Please enter 4 digits.';
  };
  el.querySelector('.join')!.addEventListener('click', go);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
}
function setStatusText(t: string) {
  statusEl.dataset.s = 'offline';
  statusEl.querySelector('span')!.textContent = t;
}

// ─────────────────────────────────────────────── input state
const axes = { l: [0, 0] as [number, number], r: [0, 0] as [number, number] };
let axesDirty = false;
let lastAxesSend = 0;
function setAxis(which: 'l' | 'r', x: number, y: number) {
  axes[which] = [round(x), round(y)];
  axesDirty = true;
}
const round = (v: number) => Math.round(v * 100) / 100;
// Stream axes at ~30 Hz while they change; zeroes go out immediately.
function pump() {
  const now = performance.now();
  const zero = !axes.l[0] && !axes.l[1] && !axes.r[0] && !axes.r[1];
  if (axesDirty && (zero || now - lastAxesSend > 33)) {
    send({ t: 'axes', l: axes.l, r: axes.r });
    axesDirty = false;
    lastAxesSend = now;
  } else if (!zero && now - lastAxesSend > 250) {
    send({ t: 'axes', l: axes.l, r: axes.r }); // keep-alive while held
    lastAxesSend = now;
  }
  requestAnimationFrame(pump);
}
requestAnimationFrame(pump);

/** Fixed or floating virtual joystick. */
function joystick(el: HTMLElement, which: 'l' | 'r', floating = false) {
  const knob = el.querySelector<HTMLElement>('.knob')!;
  let id: number | null = null;
  let cx = 0, cy = 0, radius = 1;
  const start = (e: PointerEvent) => {
    if (id !== null) return;
    id = e.pointerId;
    el.setPointerCapture(id);
    const r = el.getBoundingClientRect();
    radius = (floating ? Math.min(r.width, r.height) * 0.28 : r.width / 2) || 1;
    if (floating) { cx = e.clientX; cy = e.clientY; knob.style.left = `${cx - r.left}px`; knob.style.top = `${cy - r.top}px`; }
    else { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    el.classList.add('active');
    move(e);
    vibrate(8);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    let dx = (e.clientX - cx) / radius, dy = (e.clientY - cy) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const dead = 0.08;
    const mag = Math.hypot(dx, dy);
    const k = mag < dead ? 0 : (mag - dead) / (1 - dead) / (mag || 1);
    setAxis(which, dx * k, -dy * k);
    knob.style.transform = `translate(calc(-50% + ${dx * radius * (floating ? 1 : 0.62)}px), calc(-50% + ${dy * radius * (floating ? 1 : 0.62)}px))`;
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    el.classList.remove('active');
    setAxis(which, 0, 0);
    knob.style.transform = 'translate(-50%, -50%)';
  };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

/** Hold-to-press button → btn down/up. */
function holdButton(el: HTMLElement, id: string) {
  let held = false;
  const down = (e: PointerEvent) => {
    e.preventDefault();
    if (el.classList.contains('disabled')) return;
    held = true;
    el.setPointerCapture(e.pointerId);
    el.classList.add('pressed');
    send({ t: 'btn', id, down: true });
    vibrate(15);
  };
  const up = () => {
    if (!held) return;
    held = false;
    el.classList.remove('pressed');
    send({ t: 'btn', id, down: false });
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

function slider(el: HTMLInputElement, id: string) {
  let last = 0;
  el.addEventListener('input', () => {
    const now = performance.now();
    if (now - last < 40) return;
    last = now;
    send({ t: 'val', id, v: Number(el.value) });
  });
  el.addEventListener('change', () => send({ t: 'val', id, v: Number(el.value) }));
  el.addEventListener('pointerdown', () => el.classList.add('dragging'));
  el.addEventListener('pointerup', () => el.classList.remove('dragging'));
}

// ─────────────────────────────────────────────── layouts
function renderLayout(next: ControllerLayout, title: string, subtitle = '', missions?: MissionEntry[], cta?: string) {
  layout = next;
  hud = {};
  axes.l = [0, 0]; axes.r = [0, 0]; axesDirty = true;
  main.innerHTML = '';
  main.dataset.layout = next;
  overlay.hidden = hostOnline;

  if (next === 'lobby') {
    const el = h(`
      <section class="lobby">
        <div class="lobby-icon"><span></span></div>
        <h1>${title}</h1>
        <p>${subtitle}</p>
        <div class="lobby-missions"></div>
        ${cta ? `<button class="m-tile cta"><span class="mono">READY</span><b>${cta}</b></button>` : ''}
        <button class="btn ghost skip">Skip commander line ›</button>
      </section>`);
    const list = el.querySelector('.lobby-missions')!;
    for (const m of missions ?? []) {
      const b = h(`<button class="m-tile ${m.enabled ? '' : 'locked'}"><span class="mono">MISSION ${m.code}</span><b>${m.title}</b>${m.enabled ? '' : '<em>In development</em>'}</button>`);
      if (m.enabled) b.addEventListener('click', () => { vibrate(20); send({ t: 'tap', id: `mission:${m.id}` }); });
      list.appendChild(b);
    }
    el.querySelector('.skip')!.addEventListener('click', () => send({ t: 'tap', id: 'skip' }));
    el.querySelector('.cta')?.addEventListener('click', () => { vibrate(30); send({ t: 'tap', id: 'confirm' }); });
    main.appendChild(el);
    return;
  }

  if (next === 'jupiter') {
    const el = h(`
      <section class="pad-layout">
        <div class="hud-strip mono"><span class="objective">${title}</span><button class="mini skip">Skip ›</button></div>
        <div class="touchpad joy floating"><div class="knob"></div><div class="pad-hint">Drag to point the telescope</div><div class="pad-grid"></div></div>
        <div class="side">
          <div class="zoom-row">
            <button class="round zoom-out">−</button>
            <span class="mono label">ZOOM</span>
            <button class="round zoom-in">+</button>
          </div>
          <label class="sl"><span class="mono">FOCUS</span><input type="range" min="0" max="1" step="0.005" value="0.5" class="focus"></label>
          <label class="sl"><span class="mono">EXPOSURE</span><input type="range" min="0" max="1" step="0.01" value="0.5" class="exposure"></label>
          <button class="capture"><span>CAPTURE</span></button>
        </div>
      </section>`);
    joystick(el.querySelector('.touchpad')!, 'l', true);
    holdButton(el.querySelector('.zoom-in')!, 'zoomIn');
    holdButton(el.querySelector('.zoom-out')!, 'zoomOut');
    holdButton(el.querySelector('.capture')!, 'primary');
    slider(el.querySelector('.focus')!, 'focus');
    slider(el.querySelector('.exposure')!, 'exposure');
    el.querySelector('.skip')!.addEventListener('click', () => send({ t: 'tap', id: 'skip' }));
    main.appendChild(el);
    return;
  }

  if (next === 'mars') {
    const el = h(`
      <section class="drive-layout">
        <div class="hud-strip mono">
          <span class="objective">${title}</span>
          <span class="timer" hidden></span>
          <span class="batt"><i><b></b></i><em>100%</em></span>
          <button class="mini skip">Skip ›</button>
        </div>
        <div class="joy fixed left"><div class="ring"></div><div class="knob"></div><span class="joy-label mono">DRIVE</span></div>
        <div class="center">
          <div class="compass"><div class="arrow"></div><span class="dist mono">-</span></div>
          <button class="interact disabled"><span class="label">INTERACT</span></button>
          <button class="mini view-btn">VIEW · MASTCAM</button>
        </div>
        <div class="joy fixed right"><div class="ring"></div><div class="knob"></div><span class="joy-label mono">CAMERA</span></div>
      </section>`);
    joystick(el.querySelector('.joy.left')!, 'l');
    joystick(el.querySelector('.joy.right')!, 'r');
    holdButton(el.querySelector('.interact')!, 'interact');
    el.querySelector('.view-btn')!.addEventListener('click', () => { vibrate(10); send({ t: 'tap', id: 'view' }); });
    el.querySelector('.skip')!.addEventListener('click', () => send({ t: 'tap', id: 'skip' }));
    main.appendChild(el);
    return;
  }

  if (next === 'iss') {
    const el = h(`
      <section class="iss-layout">
        <div class="hud-strip mono"><span class="objective">${title}</span><button class="mini skip">Skip ›</button></div>
        <div class="iss-q"></div>
        <div class="iss-choices"></div>
        <div class="touchpad joy floating look"><div class="knob"></div><div class="pad-hint">Drag to look around</div></div>
      </section>`);
    joystick(el.querySelector('.touchpad')!, 'r', true);
    el.querySelector('.skip')!.addEventListener('click', () => send({ t: 'tap', id: 'skip' }));
    main.appendChild(el);
    return;
  }

  main.appendChild(h(`<section class="lobby"><h1>${title}</h1><p>${subtitle}</p></section>`));
}

let lastChoices = '';

function applyHud() {
  const obj = main.querySelector('.objective');
  if (obj && hud.objective) obj.textContent = hud.objective;
  main.classList.toggle('alert', !!hud.alert);

  if (layout === 'jupiter' && hud.vals) {
    for (const [k, v] of Object.entries(hud.vals)) {
      const s = main.querySelector<HTMLInputElement>(`.${k}`);
      if (s && !s.classList.contains('dragging')) s.value = String(v);
    }
  }
  if (layout === 'iss') {
    const box = main.querySelector<HTMLElement>('.iss-choices')!;
    const key = JSON.stringify(hud.choices ?? null);
    if (key !== lastChoices) {
      lastChoices = key;
      box.innerHTML = '';
      (hud.choices ?? []).forEach((c, i) => {
        const bad = c.startsWith('✕ ');
        const b = h(`<button class="m-tile choice${bad ? ' bad' : ''}"${bad ? ' disabled' : ''}><span class="mono">OPTION ${i + 1}</span><b></b></button>`);
        b.querySelector('b')!.textContent = bad ? c.slice(2) : c;
        if (!bad) b.addEventListener('click', () => { vibrate(20); send({ t: 'tap', id: `choice:${i + 1}` }); });
        box.appendChild(b);
      });
      box.classList.toggle('empty', !(hud.choices ?? []).length);
    }
    const q = main.querySelector<HTMLElement>('.iss-q')!;
    q.textContent = hud.choices?.length ? hud.prompt ?? '' : '';
    q.hidden = !q.textContent;
  }
  if (layout === 'mars') {
    const b = main.querySelector<HTMLElement>('.batt');
    if (b && hud.battery !== undefined) {
      b.querySelector<HTMLElement>('b')!.style.width = `${Math.round(hud.battery * 100)}%`;
      b.querySelector('em')!.textContent = `${Math.round(hud.battery * 100)}%`;
      b.classList.toggle('low', hud.battery < 0.25);
    }
    const t = main.querySelector<HTMLElement>('.timer')!;
    t.hidden = hud.timer == null;
    if (hud.timer != null) t.textContent = `${Math.floor(hud.timer / 60)}:${String(Math.floor(hud.timer % 60)).padStart(2, '0')}`;
    const c = main.querySelector<HTMLElement>('.compass')!;
    c.classList.toggle('off', hud.bearing == null);
    if (hud.bearing != null) c.querySelector<HTMLElement>('.arrow')!.style.transform = `rotate(${hud.bearing}rad)`;
    c.querySelector('.dist')!.textContent = hud.distance != null ? `${Math.round(hud.distance)} m` : '-';
    const btn = main.querySelector<HTMLElement>('.interact')!;
    btn.classList.toggle('disabled', !hud.prompt);
    btn.querySelector('.label')!.textContent = hud.prompt ?? 'INTERACT';
  }
}

connect();
