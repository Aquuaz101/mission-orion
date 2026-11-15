import { LINK_PATH, type CtrlMsg, type HostMsg, type HudState, type RelayMsg } from '../shared/protocol';
import { PEER_LINK, PeerHostSocket } from '../shared/peerSocket';

export type LinkStatus = 'connecting' | 'online' | 'offline';

type Listener<T> = (v: T) => void;

/**
 * PC side of the phone link. Connects to the local relay, gets a PIN,
 * reconnects automatically and reclaims the same PIN after a page reload
 * so an already-paired phone stays paired.
 */
export class Link {
  status: LinkStatus = 'connecting';
  pin: string | null = sessionStorage.getItem('orion.pin');
  addresses: string[] = [];
  port = Number(location.port) || 5173;
  peerConnected = false;

  private ws: WebSocket | null = null;
  private retry = 0;
  private lastHud = '';
  private hudTimer: number | null = null;
  private pendingHud: HudState | null = null;
  private lastLayout: HostMsg | null = null;

  private readonly msgListeners = new Set<Listener<CtrlMsg>>();
  private readonly changeListeners = new Set<Listener<Link>>();

  constructor() {
    this.connect();
  }

  /** URL the phone should open (encoded in the QR code). */
  get controllerUrl(): string | null {
    if (!this.pin) return null;
    // Hosted build: the phone opens the same website, anywhere with internet.
    if (PEER_LINK) return `${location.origin}${import.meta.env.BASE_URL}controller/?pin=${this.pin}`;
    const host = location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const ip = isLocal ? this.addresses[0] : host;
    if (!ip) return null;
    return `http://${ip}:${this.port}/controller/?pin=${this.pin}`;
  }

  onMessage(fn: Listener<CtrlMsg>) {
    this.msgListeners.add(fn);
    return () => this.msgListeners.delete(fn);
  }

  onChange(fn: Listener<Link>) {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  send(msg: HostMsg) {
    if (msg.t === 'layout') this.lastLayout = msg;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** HUD updates are throttled to ~8 Hz and only sent when something changed. */
  hud(state: HudState) {
    this.pendingHud = { ...this.pendingHud, ...state };
    if (this.hudTimer !== null) return;
    this.hudTimer = window.setTimeout(() => {
      this.hudTimer = null;
      const s = JSON.stringify(this.pendingHud);
      if (s !== this.lastHud) {
        this.lastHud = s;
        this.send({ t: 'hud', hud: this.pendingHud! });
      }
    }, 120);
  }

  buzz(pattern: number | number[]) {
    this.send({ t: 'buzz', pattern });
  }

  private emitChange() {
    for (const fn of this.changeListeners) fn(this);
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = new URLSearchParams({ role: 'host' });
    if (this.pin) q.set('pin', this.pin);
    let ws: WebSocket;
    try {
      ws = PEER_LINK
        ? (new PeerHostSocket(this.pin) as unknown as WebSocket)
        : new WebSocket(`${proto}://${location.host}${LINK_PATH}?${q}`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.status = 'connecting';
    this.emitChange();

    ws.onopen = () => {
      this.retry = 0;
    };
    ws.onmessage = (ev) => {
      let msg: RelayMsg | CtrlMsg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.t) {
        case 'welcome':
          this.pin = msg.pin;
          this.port = msg.port;
          this.addresses = msg.addresses;
          sessionStorage.setItem('orion.pin', msg.pin);
          this.status = 'online';
          this.emitChange();
          return;
        case 'peer':
          this.peerConnected = msg.connected;
          // A (re)joining phone needs the current layout immediately.
          if (msg.connected && this.lastLayout) this.send(this.lastLayout);
          if (msg.connected) this.lastHud = '';
          this.emitChange();
          return;
        case 'joined':
        case 'error':
          return;
        default:
          for (const fn of this.msgListeners) fn(msg as CtrlMsg);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.status = 'offline';
      this.peerConnected = false;
      this.emitChange();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    const delay = Math.min(5000, 500 * 2 ** this.retry++);
    window.setTimeout(() => this.connect(), delay);
  }
}
