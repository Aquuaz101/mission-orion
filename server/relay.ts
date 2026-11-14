/**
 * Local controller relay.
 *
 * Runs inside the Vite dev/preview server (same port), so `npm run dev` starts
 * everything. The PC game connects as `host` and receives a 4-digit PIN; the
 * phone connects as `controller` with that PIN. Messages are forwarded verbatim
 * between the two sockets of a session. No internet required.
 */
import type { Plugin } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'node:os';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { LINK_PATH, type RelayMsg } from '../src/shared/protocol.ts';

interface Session {
  pin: string;
  host?: WebSocket;
  controller?: WebSocket;
  lastActive: number;
}

const VIRTUAL_IFACE = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|Bluetooth|docker|Tailscale|ZeroTier/i;

/** LAN IPv4 addresses, real adapters first. Windows hotspot (192.168.137.x) is kept. */
function lanAddresses(): string[] {
  const out: { ip: string; score: number }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      let score = VIRTUAL_IFACE.test(name) ? 0 : 2;
      if (/wi-?fi|wlan|wireless/i.test(name)) score += 1;
      out.push({ ip: a.address, score });
    }
  }
  return out.sort((a, b) => b.score - a.score).map((o) => o.ip);
}

const isOpen = (ws?: WebSocket): ws is WebSocket => !!ws && ws.readyState === WebSocket.OPEN;

function send(ws: WebSocket | undefined, msg: RelayMsg) {
  if (isOpen(ws)) ws.send(JSON.stringify(msg));
}

export function orionRelay(): Plugin {
  const sessions = new Map<string, Session>();
  const wss = new WebSocketServer({ noServer: true });
  const alive = new WeakMap<WebSocket, boolean>();
  let httpServer: HttpServer | undefined;

  const newPin = () => {
    let pin: string;
    do pin = String(Math.floor(1000 + Math.random() * 9000));
    while (sessions.has(pin));
    return pin;
  };

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const role = url.searchParams.get('role');
    const requestedPin = url.searchParams.get('pin') ?? '';
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));

    if (role === 'host') {
      // A reloading PC can reclaim its previous PIN so the phone stays paired.
      let s = requestedPin ? sessions.get(requestedPin) : undefined;
      if (!s) {
        s = { pin: newPin(), lastActive: Date.now() };
        sessions.set(s.pin, s);
      }
      const session = s;
      if (session.host && session.host !== ws) session.host.close(4000, 'replaced');
      session.host = ws;
      const port = (httpServer?.address() as AddressInfo | null)?.port ?? 5173;
      send(ws, { t: 'welcome', pin: session.pin, port, addresses: lanAddresses() });
      send(ws, { t: 'peer', connected: isOpen(session.controller) });
      send(session.controller, { t: 'peer', connected: true });

      ws.on('message', (data) => {
        session.lastActive = Date.now();
        if (isOpen(session.controller)) session.controller.send(data.toString());
      });
      ws.on('close', () => {
        if (session.host !== ws) return;
        session.host = undefined;
        send(session.controller, { t: 'peer', connected: false });
      });
      return;
    }

    if (role === 'controller') {
      const session = sessions.get(requestedPin);
      if (!session) {
        send(ws, { t: 'error', code: 'bad-pin' });
        ws.close(4004, 'bad pin');
        return;
      }
      // Newest phone wins: handles a phone that woke from sleep before its old socket timed out.
      if (session.controller && session.controller !== ws) session.controller.close(4001, 'replaced');
      session.controller = ws;
      session.lastActive = Date.now();
      send(ws, { t: 'joined', pin: session.pin });
      send(ws, { t: 'peer', connected: isOpen(session.host) });
      send(session.host, { t: 'peer', connected: true });

      ws.on('message', (data) => {
        session.lastActive = Date.now();
        if (isOpen(session.host)) session.host.send(data.toString());
      });
      ws.on('close', () => {
        if (session.controller !== ws) return;
        session.controller = undefined;
        send(session.host, { t: 'peer', connected: false });
      });
      return;
    }

    send(ws, { t: 'error', code: 'bad-role' });
    ws.close(4002, 'bad role');
  });

  // Heartbeat: drop dead sockets (phones that lost Wi-Fi) and stale sessions.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
    const now = Date.now();
    for (const [pin, s] of sessions) {
      if (!isOpen(s.host) && !isOpen(s.controller) && now - s.lastActive > 30 * 60_000) sessions.delete(pin);
    }
  }, 5000);
  heartbeat.unref?.();

  const attach = (server: HttpServer | null | undefined) => {
    if (!server) return;
    httpServer = server;
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!req.url?.startsWith(LINK_PATH)) return; // leave Vite's HMR socket alone
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    server.once('listening', () => {
      const port = (server.address() as AddressInfo | null)?.port;
      const ips = lanAddresses();
      console.log(`\n  🛰  MISSION: ORION controller relay ready on ${LINK_PATH}`);
      for (const ip of ips) console.log(`     Phone controller: http://${ip}:${port}/controller/`);
      if (!ips.length) console.log('     No LAN address found: connect this PC to Wi-Fi or a hotspot.');
    });
  };

  return {
    name: 'orion-relay',
    configureServer(server) {
      attach(server.httpServer as HttpServer | null);
    },
    configurePreviewServer(server) {
      attach(server.httpServer as HttpServer);
    },
  };
}
