// End-to-end smoke test: drives the PC game AND a phone-sized controller page
// in real Chrome, takes screenshots and reports console errors.
// Usage: node scripts/qa-flow.mjs <outDir>
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? 'qa-shots';
const BASE = 'http://localhost:5173';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const watch = (page, tag) => {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${tag} ${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${tag} pageerror] ${e.message}`));
};

const pc = await browser.newPage({ viewport: { width: 1600, height: 900 } });
watch(pc, 'pc');
const t0 = Date.now();
await pc.goto(BASE);
await pc.waitForTimeout(700);
await pc.screenshot({ path: `${OUT}/01-loading.png` });
await pc.waitForSelector('.intro', { timeout: 60000 });
console.log(`assets loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await pc.waitForTimeout(1500);
await pc.screenshot({ path: `${OUT}/02-loaded.png` });
await pc.click('.intro'); await pc.waitForTimeout(150); await pc.keyboard.press('Escape');
await pc.waitForTimeout(3500);
await pc.screenshot({ path: `${OUT}/03-menu.png` });
await pc.click('[data-a="start"]');
await pc.waitForTimeout(2500);
await pc.screenshot({ path: `${OUT}/04-controls.png` });
await pc.click('.choice[data-m="phone"]');
await pc.waitForFunction(() => /\d{4}/.test(document.querySelector('.pin')?.textContent ?? ''), null, { timeout: 10000 });
await pc.waitForTimeout(1200);
await pc.screenshot({ path: `${OUT}/05-pairing.png` });
const pin = (await pc.textContent('.pin')).trim();
const url = await pc.textContent('.pair-url');
console.log('pin', pin, 'controller url', url);

// Phone: real controller page in a mobile viewport.
const phoneCtx = await browser.newContext({ viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const phone = await phoneCtx.newPage();
watch(phone, 'phone');
await phone.goto(`${BASE}/controller/?pin=${pin}`);
await pc.waitForSelector('.pair-status[data-s="linked"]', { timeout: 10000 });
console.log('PC sees controller as linked ✔');
await pc.screenshot({ path: `${OUT}/06-linked.png` });
await pc.waitForSelector('.select', { timeout: 10000 });
await pc.waitForTimeout(2500);
await pc.screenshot({ path: `${OUT}/07-select.png` });
await phone.waitForSelector('.m-tile', { timeout: 10000 });
await phone.screenshot({ path: `${OUT}/08-phone-lobby.png` });

// Tap Jupiter on the phone → PC should react (toast for now).
await phone.tap('.m-tile:not(.locked)');
await pc.waitForSelector('.toast', { timeout: 5000 });
console.log('phone tap reached PC ✔:', (await pc.textContent('.toast')).trim());

// Wrong PIN handling.
const bad = await phoneCtx.newPage();
await bad.goto(`${BASE}/controller/?pin=0000`);
await bad.waitForSelector('.pin-error', { timeout: 5000 });
await bad.waitForTimeout(500);
console.log('bad pin message:', (await bad.textContent('.pin-error')).trim());
await bad.screenshot({ path: `${OUT}/09-phone-badpin.png` });

console.log(errors.length ? `console issues:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
