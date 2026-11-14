// Plays Mission 03 automatically and saves a frame every N seconds (visual review). Usage: node scripts/qa-iss-film.mjs outDir [everySec]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const OUT = process.argv[2] ?? 'qa-shots/iss-film', EVERY = Number(process.argv[3] ?? 3) * 1000;
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://localhost:5173'); await p.waitForSelector('.intro', { timeout: 60000 });
await p.click('.intro'); await p.waitForTimeout(150); await p.keyboard.press('Escape');
await p.click('.cod-item[data-a="start"]'); await p.click('.choice[data-m="device"]'); await p.waitForSelector('.ms'); await p.waitForTimeout(500);
await p.click('.ms-card[data-id="iss"]'); await p.waitForSelector('.briefing', { timeout: 30000 }); await p.waitForTimeout(500);
await p.keyboard.press('Enter');
await p.waitForSelector('.ihud', { timeout: 120000 });
const t0 = Date.now(); let n = 0, next = 0, tried = 0, lastChoice = '';
while (Date.now() - t0 < 6 * 60000) {
  const s = await p.evaluate(() => ({ report: !!document.querySelector('.report'), choice: document.querySelector('.ihud .choices.in .ch-prompt')?.textContent ?? null, obj: document.querySelector('.ihud .obj')?.textContent, sun: window.orion.mission?.stage?.sunElev, fps: Math.round(window.orion.engine.fps), res: window.orion.engine.resScale }));
  if (s.report) break;
  if (Date.now() - t0 >= next) {
    next += EVERY;
    await p.screenshot({ path: `${OUT}/f${String(n++).padStart(3, '0')}.jpg`, quality: 70, type: 'jpeg' });
    console.log(`f${n - 1}`, ((Date.now() - t0) / 1000).toFixed(0) + 's', `sun ${s.sun?.toFixed(1)}`, `fps ${s.fps} res ${s.res}`, '|', s.obj);
  }
  if (s.choice) {
    if (s.choice !== lastChoice) { lastChoice = s.choice; tried = 0; await p.waitForTimeout(700); }
    tried = (tried % 3) + 1; await p.keyboard.press(`Digit${tried}`); await p.waitForTimeout(400); continue;
  }
  await p.waitForTimeout(250);
}
console.log('done', ((Date.now() - t0) / 60000).toFixed(1), 'min'); console.log('grab misses', JSON.stringify(await p.evaluate(() => window.orionGrabMisses ?? null)));
console.log(errs.length ? [...new Set(errs)].slice(0, 10).join('\n') : 'no errors');
await b.close();
