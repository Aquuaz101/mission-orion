// Main menu shot after the HD station has streamed in (UI hidden for review). Usage: node scripts/qa-menu.mjs out.jpg [waitMs]
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5173'); await p.waitForSelector('.intro', { timeout: 60000 });
await p.click('.intro'); await p.waitForTimeout(150); await p.keyboard.press('Escape');
await p.addStyleTag({ content: '#ui * { opacity: 0 !important; }' });
await p.waitForFunction(() => !!window.orion?.assets?.models?.issHd, null, { timeout: 120000 });
await p.waitForTimeout(Number(process.argv[3] ?? 9000));
await p.screenshot({ path: process.argv[2] ?? 'qa-shots/menu.jpg', type: 'jpeg', quality: 88 });
console.log('fps', await p.evaluate(() => Math.round(window.orion.engine.fps)), errs.length ? errs.join('\n') : 'no errors');
await b.close();
