// Jumps straight to Mission 03's exit pull-out (daylight) and captures each cut. Usage: node scripts/qa-iss-exit.mjs outDir
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const OUT = process.argv[2] ?? 'qa-shots/iss-exit';
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
await p.evaluate(() => { const m = window.orion.mission; m.stage.sunElev = 12; void m.exitCut(); });
for (let i = 0; i < 14; i++) { await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/e${String(i).padStart(2, '0')}.jpg`, quality: 75, type: 'jpeg' }); }
console.log(errs.length ? [...new Set(errs)].join('\n') : 'no errors');
await b.close();
