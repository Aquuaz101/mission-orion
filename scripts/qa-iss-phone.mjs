// Plays Mission 03 entirely from a paired phone controller page: launch, Begin, every decision, the look pad.
// Also captures PC frames along the way (Earth review). Usage: node scripts/qa-iss-phone.mjs outDir
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const OUT = process.argv[2] ?? 'qa-shots/iss-phone';
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5173';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errs = [];
const watch = (page, tag) => { page.on('pageerror', (e) => errs.push(`[${tag}] ${e.message}`)); page.on('console', (m) => m.type() === 'error' && errs.push(`[${tag}] ${m.text()}`)); };
const pc = await b.newPage({ viewport: { width: 1600, height: 900 } });
watch(pc, 'pc');
await pc.goto(BASE); await pc.waitForSelector('.intro', { timeout: 60000 });
await pc.click('.intro'); await pc.waitForTimeout(150); await pc.keyboard.press('Escape');
await pc.click('.cod-item[data-a="start"]');
await pc.click('.choice[data-m="phone"]');
await pc.waitForFunction(() => /\d{4}/.test(document.querySelector('.pin')?.textContent ?? ''), null, { timeout: 10000 });
const pin = (await pc.textContent('.pin')).trim();
const ctx = await b.newContext({ viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const phone = await ctx.newPage();
watch(phone, 'phone');
await phone.goto(`${BASE}/controller/?pin=${pin}`);
await pc.waitForSelector('.ms', { timeout: 15000 });
console.log('paired ✔ pin', pin);
await phone.waitForSelector('.m-tile', { timeout: 10000 });
await phone.locator('.m-tile', { hasText: 'MISSION 03' }).first().tap();
await pc.waitForSelector('.briefing', { timeout: 30000 });
console.log('phone launched Mission 03 ✔');
await phone.waitForSelector('.lobby .cta', { timeout: 10000 });
await phone.screenshot({ path: `${OUT}/p0-briefing.png` });
await pc.waitForTimeout(4000);
await pc.screenshot({ path: `${OUT}/pc-briefing.jpg`, type: 'jpeg', quality: 80 });
await phone.tap('.lobby .cta');
await pc.waitForSelector('.ihud', { timeout: 120000 });
console.log('phone Begin started the spacewalk ✔');
await phone.waitForSelector('.iss-layout', { timeout: 10000 });

// look pad: drag on the phone, PC look yaw should move
const pad = await phone.locator('.touchpad').boundingBox();
const yaw0 = await pc.evaluate(() => window.orion.mission.stage.lookYaw);
const cdp = await phone.context().newCDPSession(phone);
const cx = pad.x + pad.width / 2, cy = pad.y + pad.height / 2;
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + i * 6, y: cy }] }); await phone.waitForTimeout(60); }
await phone.waitForTimeout(800);
const yaw1 = await pc.evaluate(() => window.orion.mission.stage.lookYaw);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
console.log(`phone look pad: yaw ${yaw0.toFixed(3)} → ${yaw1.toFixed(3)} ${Math.abs(yaw1 - yaw0) > 0.05 ? '✔' : '✘'}`);

const t0 = Date.now(); let shots = 0, next = 0, calls = 0, lastQ = '', phoneShots = 0;
while (Date.now() - t0 < 7 * 60000) {
  if (await pc.locator('.report').count()) break;
  if (Date.now() - t0 >= next) { next += 6000; await pc.screenshot({ path: `${OUT}/f${String(shots++).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 75 }); }
  const tiles = phone.locator('.iss-choices .choice:not(.bad)');
  if (await tiles.count()) {
    const q = (await phone.locator('.iss-q').textContent().catch(() => '')) ?? '';
    if (q !== lastQ) {
      lastQ = q; calls++;
      await phone.waitForTimeout(600);
      if (phoneShots < 12) await phone.screenshot({ path: `${OUT}/p${String(++phoneShots).padStart(2, '0')}.png` });
      console.log(`call ${calls}: "${q}" → ${(await phone.locator('.iss-choices .choice b').allTextContents()).join(' | ')}`);
    }
    await tiles.first().tap().catch(() => {});
    await phone.waitForTimeout(700);
    continue;
  }
  await pc.waitForTimeout(250);
}
const report = await pc.locator('.report').count();
console.log(report ? `report reached ✔ (${calls} calls, ${((Date.now() - t0) / 60000).toFixed(1)} min)` : '✘ no report');
await phone.screenshot({ path: `${OUT}/p-end.png` });
console.log(errs.length ? [...new Set(errs)].slice(0, 10).join('\n') : 'no errors');
await b.close();
