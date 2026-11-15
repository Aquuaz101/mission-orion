// Test the GitHub Pages build (dist-pages) before publishing: assets load under /<repo>/ and a phone
// pairs over the internet link (PeerJS). Usage: node scripts/qa-pages.mjs [base=/mission-orion/] [url]
// With a url (e.g. the live site), it tests that instead of serving dist-pages locally.
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.argv[2] ?? '/mission-orion/';
let url = process.argv[3];
let server;
if (!url) {
  const dir = path.resolve(import.meta.dirname, '../dist-pages');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml' };
  server = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!p.startsWith(base)) { res.writeHead(404).end(); return; }
    p = p.slice(base.length) || 'index.html';
    if (p.endsWith('/')) p += 'index.html';
    try {
      const body = await readFile(path.join(dir, p));
      res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  }).listen(4789);
  url = `http://localhost:4789${base}`;
}

const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'] });
const missing = [];
const errs = [];
const pc = await b.newPage({ viewport: { width: 1600, height: 900 } });
pc.on('pageerror', (e) => errs.push('PC: ' + e.message));
pc.on('response', (r) => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
await pc.goto(url);
await pc.waitForSelector('.intro', { timeout: 60000 });
await pc.waitForFunction(() => !!window.orion?.assets?.models?.rover, null, { timeout: 120000 }).catch(() => errs.push('PC: rover model never loaded'));
await pc.waitForFunction(() => window.orion?.link?.status === 'online', null, { timeout: 30000 }).catch(() => errs.push('PC: link never came online'));
const link = await pc.evaluate(() => ({ pin: window.orion.link.pin, url: window.orion.link.controllerUrl }));
console.log('PC link:', link);

const phone = await b.newPage({ viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true });
phone.on('pageerror', (e) => errs.push('phone: ' + e.message));
await phone.goto(link.url.replace(/^https?:\/\/[^/]+/, new URL(url).origin));
const linked = await phone.waitForSelector('.c-status[data-s="linked"]', { timeout: 30000 }).then(() => true, () => false);
const pcSees = await pc.waitForFunction(() => window.orion.link.peerConnected, null, { timeout: 10000 }).then(() => true, () => false);
const status = await phone.$eval('.c-status', (e) => e.textContent);
console.log('phone linked:', linked, '| PC sees phone:', pcSees, '| phone status:', status);

// Phone input reaches the PC
await pc.evaluate(() => { window.__got = []; window.orion.link.onMessage((m) => window.__got.push(m.t)); });
const btn = await phone.$('button');
if (btn) await btn.tap().catch(() => {});
await phone.waitForTimeout(1500);
console.log('PC received from phone:', await pc.evaluate(() => window.__got.slice(0, 5)));

console.log(missing.length ? 'MISSING FILES:\n' + missing.join('\n') : 'all files loaded');
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no errors');
await b.close();
server?.close();
