// Automated playthrough of Mission 03 (ISS spacewalk). Usage: node scripts/qa-iss.mjs [outDir]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const OUT = process.argv[2] ?? 'qa-shots';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const pc = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
pc.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
pc.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()} ${m.text()}`));
const shot = (n) => pc.screenshot({ path: `${OUT}/${n}.png` });

await pc.goto('http://localhost:5173');
await pc.waitForSelector('.intro', { timeout: 60000 });
await pc.click('.intro'); await pc.waitForTimeout(150); await pc.keyboard.press('Escape'); await pc.waitForTimeout(1000);
await pc.click('.cod-item[data-a="start"]'); await pc.waitForTimeout(500);
await pc.click('.choice[data-m="device"]'); await pc.waitForSelector('.ms'); await pc.waitForTimeout(800);
await pc.click('.ms-card[data-id="iss"]');
await pc.waitForSelector('.briefing', { timeout: 30000 }); await pc.waitForTimeout(2500);
await shot('i01-briefing');
await pc.keyboard.press('Enter');
await pc.waitForSelector('.ihud', { timeout: 60000 });
await pc.waitForTimeout(1500);
await shot('i02-airlock');

const t0 = Date.now();
const shots = new Set();
let tried = 0, lastChoiceKey = '', lastFps = '';
while (Date.now() - t0 < 8 * 60000) {
  const s = await pc.evaluate(() => {
    const m = window.orion.mission;
    const ch = document.querySelector('.ihud .choices.in');
    return {
      report: !!document.querySelector('.report'),
      choice: ch ? ch.querySelector('.ch-prompt')?.textContent : null,
      torque: !!document.querySelector('.ihud .torque'),
      val: Number(document.querySelector('.ihud .tq-val')?.textContent ?? -1),
      tol: Number(document.querySelector('.ihud .tq-tol')?.textContent ?? 0),
      obj: document.querySelector('.ihud .obj')?.textContent,
      talking: window.orion.commander.busy,
      debris: m?.stage?.debris ?? 0,
    };
  });
  if (s.report) break;
  if (s.choice) {
    if (s.choice !== lastChoiceKey) { lastChoiceKey = s.choice; tried = 0; const n = 'i-choice-' + s.choice.replace(/\W+/g, '-').slice(0, 30); if (!shots.has(n)) { shots.add(n); await shot(n); } }
    tried = (tried % 3) + 1;
    await pc.keyboard.press(`Digit${tried}`);
    await pc.waitForTimeout(350);
    continue;
  }
  if (s.torque) {
    if (!shots.has('torque')) { shots.add('torque'); await shot('i-torque'); }
    if (s.val >= 0 && Math.abs(s.val - 25) < Math.max(0.6, s.tol * 0.5)) await pc.keyboard.press('Space');
    await pc.waitForTimeout(16);
    continue;
  }
  for (const [key, cond] of [['i-reveal', s.obj === 'Exit the airlock' && Date.now() - t0 > 14000], ['i-truss', s.obj === 'Reach the P4 battery bank'], ['i-worksite', s.obj === 'Replace battery 3B'], ['i-online', s.obj === 'Battery 3B online'], ['i-debris', s.debris >= 0.9]]) {
    if (cond && !shots.has(key)) { shots.add(key); await pc.waitForTimeout(key === 'i-truss' ? 5000 : 300); await shot(key); console.log(key, 'fps', await pc.evaluate(() => Math.round(window.orion.engine.fps)), 'res', await pc.evaluate(() => window.orion.engine.resScale)); }
  }
  if (s.talking) await pc.keyboard.press('Tab');
  await pc.waitForTimeout(200);
}
await pc.waitForTimeout(1500);
await shot('i99-report');
const rep = await pc.evaluate(() => document.querySelector('.report-stats')?.textContent?.replace(/\s+/g, ' ').trim() ?? 'NO REPORT');
console.log('report:', rep, '| time', ((Date.now() - t0) / 60000).toFixed(1), 'min');
console.log(errors.length ? [...new Set(errors)].slice(0, 12).join('\n') : 'no console errors');
await browser.close();
