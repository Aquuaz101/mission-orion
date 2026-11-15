// Films the full-screen objectives intro of a mission. Usage: node scripts/qa-objintro.mjs <jupiter|mars|iss> outDir
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [id = 'mars', OUT = 'qa-shots/objintro'] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5173'); await p.waitForSelector('.intro', { timeout: 90000 });
await p.click('.intro'); await p.waitForTimeout(150); await p.keyboard.press('Escape');
await p.click('.cod-item[data-a="start"]'); await p.click('.choice[data-m="device"]'); await p.waitForSelector('.ms'); await p.waitForTimeout(400);
await p.click(`.ms-card[data-id="${id}"]`); await p.waitForSelector('.briefing', { timeout: 90000 }); await p.waitForTimeout(600);
await p.keyboard.press('Enter');
// skip cutscene lines quickly until the intro appears
const t0 = Date.now();
while (!(await p.locator('.obj-intro').count())) { if (Date.now() - t0 > 180000) throw new Error('no intro'); await p.waitForTimeout(250); }
console.log(`${id}: intro appeared after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const shots = [300, 1300, 2300, 3300, 4600, 5600, 6400, 7400];
const s0 = Date.now();
for (const [i, ms] of shots.entries()) { await p.waitForTimeout(Math.max(0, ms - (Date.now() - s0))); await p.screenshot({ path: `${OUT}/${id}-${i}.jpg`, type: 'jpeg', quality: 80 }); }
console.log('intro still up at end:', await p.locator('.obj-intro').count() > 0, '| gameplay objective:', await p.evaluate(() => document.querySelector('.obj-text, .jh-obj-title, .ih-obj .obj')?.textContent?.trim()));
console.log(errs.length ? errs.join('\n') : 'no errors');
await b.close();
