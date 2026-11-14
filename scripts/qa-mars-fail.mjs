// Tests the Mars fail → retry path (timer expiry) and storm visuals. Usage: node scripts/qa-mars-fail.mjs <outDir>
import { chromium } from 'playwright-core';
const OUT = process.argv[2] ?? '.';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'] });
const pc = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
pc.on('pageerror', (e) => errors.push(e.message));
pc.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await pc.goto('http://localhost:5173');
await pc.waitForSelector('.begin:not([hidden])', { timeout: 60000 });
await pc.click('.begin'); await pc.waitForTimeout(800);
await pc.click('[data-a="start"]'); await pc.waitForTimeout(600);
await pc.click('.choice[data-m="device"]'); await pc.waitForSelector('.mission[data-id="mars"]'); await pc.waitForTimeout(700);
await pc.click('.mission[data-id="mars"]'); await pc.waitForSelector('.briefing'); await pc.waitForTimeout(600);
await pc.keyboard.press('Enter');
await pc.waitForSelector('.mhud', { timeout: 30000 });
await pc.waitForTimeout(800);
// Jump straight to the emergency.
await pc.evaluate(() => { const m = window.orion.mission; m.collected = ['igneous', 'hematite']; m.stage.removeSpecimen('s1'); m.stage.removeSpecimen('s2'); m.startEmergency(); });
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
console.log('after retry', JSON.stringify(s), s.phase === 'emergency-find' && s.timer === 150 && !s.locked && !s.overlay ? '✔' : '✘');
// Esc pause during mission → resume
await pc.keyboard.press('Escape');
await pc.waitForSelector('.pause');
await pc.click('[data-a="resume"]');
await pc.waitForTimeout(400);
console.log('pause/resume ✔', await pc.evaluate(() => !document.querySelector('.pause-backdrop') && !window.orion.mission.paused));
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
