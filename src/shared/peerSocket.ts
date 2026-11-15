import type { DataConnection, Peer as PeerT } from 'peerjs';

/**
 * Internet phone link for the hosted (GitHub Pages) build, where no local relay exists.
 *
 * The PC and the phone find each other through the free public PeerJS broker using the 4-digit PIN,
 * then talk directly over WebRTC. Both classes mimic the small slice of the WebSocket API that
 * Link.ts and the controller use, and emit the same relay messages ('welcome', 'peer', 'joined',
 * 'error') the local relay sends, so the rest of the game is unchanged.
 */

/** True in the hosted build (`VITE_LINK=peer`); local `npm run dev` keeps the offline relay. */
export const PEER_LINK = import.meta.env.VITE_LINK === 'peer';

const peerId = (pin: string) => `mission-orion-x7q2-${pin}`;
const randomPin = () => String(Math.floor(1000 + Math.random() * 9000));
const KICK = '{"t":"__kick"}';

type MsgEvent = { data: string };
type CloseEvent = { code: number };

abstract class PeerSocketBase {
  readyState = 0; // WebSocket.CONNECTING
  onopen: (() => void) | null = null;
  onmessage: ((ev: MsgEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  protected peer: PeerT | null = null;
  protected closed = false;

  protected emit(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  protected finish(code: number) {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3; // WebSocket.CLOSED
    try { this.peer?.destroy(); } catch { /* already gone */ }
    this.onclose?.({ code });
  }

  close() {
    this.finish(1000);
  }
}

/** PC side: registers `mission-orion-…-<pin>` with the broker and accepts one phone (newest wins). */
export class PeerHostSocket extends PeerSocketBase {
  private ctrl: DataConnection | null = null;
  private idTries = 0;

  constructor(private pin: string | null) {
    super();
    void this.start();
  }

  private async start() {
    const { Peer } = await import('peerjs');
    if (this.closed) return;
    const pin = this.pin ?? randomPin();
    const peer = new Peer(peerId(pin), { debug: 0 });
    this.peer = peer;

    peer.on('open', () => {
      this.pin = pin;
      this.readyState = 1; // WebSocket.OPEN
      this.onopen?.();
      this.emit({ t: 'welcome', pin, port: 0, addresses: [] });
      this.emit({ t: 'peer', connected: !!this.ctrl?.open });
    });

    peer.on('connection', (conn) => {
      conn.on('open', () => {
        if (this.ctrl && this.ctrl !== conn) {
          try { this.ctrl.send(KICK); this.ctrl.close(); } catch { /* old phone already gone */ }
        }
        this.ctrl = conn;
        this.emit({ t: 'peer', connected: true });
      });
      conn.on('data', (d) => {
        if (this.ctrl === conn && typeof d === 'string') this.onmessage?.({ data: d });
      });
      conn.on('close', () => {
        if (this.ctrl !== conn) return;
        this.ctrl = null;
        this.emit({ t: 'peer', connected: false });
      });
    });

    // Lost the broker (Wi-Fi blip): reconnect without dropping an already-linked phone.
    peer.on('disconnected', () => {
      if (!this.closed && !peer.destroyed) setTimeout(() => !this.closed && !peer.destroyed && peer.reconnect(), 1500);
    });

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // After a reload the broker may still hold the old PIN for a few seconds: retry, then take a new one.
        try { peer.destroy(); } catch { /* ignore */ }
        if (this.idTries++ >= 2) this.pin = null;
        setTimeout(() => !this.closed && void this.start(), 2000);
        return;
      }
      if (err.type === 'peer-unavailable') return; // not fatal for the host
      this.finish(1006);
    });
  }

  send(data: string) {
    if (this.ctrl?.open) void this.ctrl.send(data);
  }
}

/** Phone side: connects to the PC registered under the PIN. */
export class PeerControllerSocket extends PeerSocketBase {
  private conn: DataConnection | null = null;

  constructor(private pin: string) {
    super();
    void this.start();
  }

  private async start() {
    const { Peer } = await import('peerjs');
    if (this.closed) return;
    const peer = new Peer({ debug: 0 });
    this.peer = peer;
    // A direct link that can't be made (strict networks) would hang forever: give up and retry.
    const timeout = setTimeout(() => { if (this.readyState !== 1) this.finish(1006); }, 20000);

    peer.on('open', () => {
      const conn = peer.connect(peerId(this.pin), { reliable: true, serialization: 'raw' });
      this.conn = conn;
      conn.on('open', () => {
        clearTimeout(timeout);
        this.readyState = 1;
        this.onopen?.();
        this.emit({ t: 'joined', pin: this.pin });
        this.emit({ t: 'peer', connected: true });
      });
      conn.on('data', (d) => {
        if (typeof d !== 'string') return;
        if (d === KICK) return this.finish(4001);
        this.onmessage?.({ data: d });
      });
      conn.on('close', () => this.finish(1006));
    });

    peer.on('error', (err) => {
      clearTimeout(timeout);
      if (err.type === 'peer-unavailable') {
        this.emit({ t: 'error', code: 'bad-pin' });
        return this.finish(4004);
      }
      this.finish(1006);
    });
  }

  send(data: string) {
    if (this.conn?.open) void this.conn.send(data);
  }
}
