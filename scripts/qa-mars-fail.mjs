// Tests the Mars fail → retry path (timer expiry) and storm visuals. Usage: node scripts/qa-mars-fail.mjs <outDir>
import { chromium } from 'playwright-core';
const OUT = process.argv[2] ?? '.';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'] });
const pc = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
pc.on('pageerror', (e) => errors.push(e.message));
pc.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await pc.goto('http://localhost:5173');
await pc.waitForSelector('.intro', { timeout: 60000 });
await pc.click('.intro'); await pc.waitForTimeout(150); await pc.keyboard.press('Escape'); await pc.waitForTimeout(800);
await pc.click('.cod-item[data-a="start"]'); await pc.waitForTimeout(500);
await pc.click('.choice[data-m="device"]'); await pc.waitForSelector('.ms'); await pc.waitForTimeout(700);
await pc.click('.ms-card[data-id="mars"]'); await pc.waitForSelector('.briefing', { timeout: 30000 }); await pc.waitForTimeout(600);
await pc.keyboard.press('Enter');
await pc.waitForFunction(() => window.orion.mission?.phase === 'explore', null, { timeout: 60000 });
await pc.waitForTimeout(800);
// Jump straight to the emergency.
await pc.evaluate(() => { const m = window.orion.mission; m.collected = ['igneous', 'hematite']; m.startEmergency(); });
await pc.waitForTimeout(13000);
await pc.screenshot({ path: `${OUT}/f01-full-storm.png` });
// Force the timer to expire.
await pc.evaluate(() => { window.orion.mission.timer = 0.5; });
await pc.waitForSelector('.mars-fail', { timeout: 5000 });
await pc.waitForTimeout(600);
await pc.screenshot({ path: `${OUT}/f02-fail.png` });
console.log('fail overlay ✔', await pc.evaluate(() => window.orion.mission.phase));
await pc.click('.mars-fail .retry');
await pc.waitForTimeout(800);
const s = await pc.evaluate(() => { const m = window.orion.mission; return { phase: m.phase, timer: Math.round(m.timer), locked: m.locked, overlay: !!document.querySelector('.mars-fail') }; });
console.log('after retry', JSON.stringify(s), s.phase === 'emergency-find' && s.timer >= 175 && !s.locked && !s.overlay ? '✔' : '✘');
// Esc pause during mission → resume
await pc.keyboard.press('Escape');
await pc.waitForSelector('.pause-backdrop.in');
await pc.click('.pz-item[data-a="resume"]');
await pc.waitForTimeout(400);
console.log('pause/resume ✔', await pc.evaluate(() => !document.querySelector('.pause-backdrop') && !window.orion.mission.paused));
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
