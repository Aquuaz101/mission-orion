// Automated playthrough of Mission 02 (Mars). Usage: node scripts/qa-mars.mjs <outDir> [quick]
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? 'qa-shots';
const BASE = 'http://localhost:5173';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
const watch = (page, tag) => {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${tag} ${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${tag} pageerror] ${e.message}`));
};
const pc = await browser.newPage({ viewport: { width: 1600, height: 900 } });
watch(pc, 'pc');
const shot = (n) => pc.screenshot({ path: `${OUT}/${n}.png` });
const M = 'window.orion.mission';
const fps = () => pc.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(Math.round(n / 2)); }; requestAnimationFrame(f); }));
const skip = async (n = 4) => { for (let i = 0; i < n; i++) { await pc.keyboard.press('Tab'); await pc.waitForTimeout(300); } };
const state = () => pc.evaluate(`({ phase: ${M}.phase, target: ${M}.targetId, battery: ${M}.battery.toFixed(2), timer: ${M}.timer, collected: ${M}.collected.join(','), storm: ${M}.stage.storm.toFixed(2) })`);
// Drive the rover to a point by steering with real keyboard input (W + A/D).
async function driveTo(id, stopDist = 5, maxMs = 60000) {
  const t0 = Date.now();
  let held = new Set();
  const setKeys = async (keys) => {
    for (const k of held) if (!keys.includes(k)) { await pc.keyboard.up(k); held.delete(k); }
    for (const k of keys) if (!held.has(k)) { await pc.keyboard.down(k); held.add(k); }
  };
  while (Date.now() - t0 < maxMs) {
    const s = await pc.evaluate((id) => {
      const m = window.orion.mission, st = m.stage;
      const tgt = id === 'ares' ? st.ares.group.position : m.pois.get(id).pos;
      const dx = tgt.x - st.roverPos.x, dz = tgt.z - st.roverPos.z;
      const ty = Math.atan2(dx, dz);
      const rel = Math.atan2(Math.sin(ty - st.roverYaw), Math.cos(ty - st.roverYaw));
      return { d: Math.hypot(dx, dz), rel, blocked: st.blocked };
    }, id);
    if (s.d < stopDist) break;
    const keys = [];
    if (Math.abs(s.rel) < 1.0) keys.push('KeyW');
    if (s.rel > 0.08) keys.push('KeyA'); else if (s.rel < -0.08) keys.push('KeyD');
    await setKeys(keys);
    await pc.waitForTimeout(80);
  }
  await setKeys([]);
  await pc.waitForTimeout(600);
  return pc.evaluate((id) => { const m = window.orion.mission, st = m.stage; const t = id === 'ares' ? st.ares.group.position : m.pois.get(id).pos; return Math.hypot(t.x - st.roverPos.x, t.z - st.roverPos.z).toFixed(1); }, id);
}

await pc.goto(BASE);
await pc.waitForSelector('.begin:not([hidden])', { timeout: 60000 });
await pc.click('.begin');
await pc.waitForTimeout(1000);
await pc.click('[data-a="start"]');
await pc.waitForTimeout(600);
await pc.click('.choice[data-m="device"]');
await pc.waitForSelector('.mission[data-id="mars"]');
await pc.waitForTimeout(800);
await pc.click('.mission[data-id="mars"]');
await pc.waitForSelector('.briefing', { timeout: 15000 });
await pc.waitForTimeout(2800);
await shot('m01-briefing');

const pin = await pc.evaluate(() => window.orion.link.pin);
const phoneCtx = await browser.newContext({ viewport: { width: 860, height: 400 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const phone = await phoneCtx.newPage();
watch(phone, 'phone');
await phone.goto(`${BASE}/controller/?pin=${pin}`);

const t0 = Date.now();
await pc.keyboard.press('Enter');
await pc.waitForSelector('.mhud', { timeout: 30000 });
console.log(`descent + terrain build: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await pc.waitForTimeout(2500);
await shot('m02-start');
console.log('mars fps:', await fps());

// Phone: left joystick should drive the rover.
await phone.waitForSelector('.joy.left', { timeout: 8000 });
const p0 = await pc.evaluate(() => ({ ...window.orion.mission.stage.roverPos }));
const joy = await phone.locator('.joy.left').boundingBox();
await phone.mouse.move(joy.x + joy.width / 2, joy.y + joy.height / 2);
await phone.mouse.down();
await phone.mouse.move(joy.x + joy.width / 2, joy.y + 4, { steps: 5 });
await phone.waitForTimeout(1500);
await phone.screenshot({ path: `${OUT}/m03-phone-mars.png` });
await phone.mouse.up();
const p1 = await pc.evaluate(() => ({ ...window.orion.mission.stage.roverPos }));
console.log(`phone joystick drove rover ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} m`, Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2 ? '✔' : '✘');
await skip(3);

console.log('to s1, remaining', await driveTo('s1'), 'm');
await shot('m04-at-s1');
await pc.keyboard.press('KeyE');
await pc.waitForTimeout(2200);
await shot('m05-arm');
await pc.waitForTimeout(5500);
await shot('m06-sample-card');
console.log(await state());
await skip(4);

console.log('to s2, remaining', await driveTo('s2'), 'm');
await pc.keyboard.press('KeyE');
await pc.waitForTimeout(8000);
await skip(3);
await pc.waitForFunction(() => window.orion.mission.phase === 'emergency-find', null, { timeout: 30000 });
await pc.waitForTimeout(9000);
await shot('m07-storm');
console.log(await state());
await skip(5);

console.log('to ARES-7, remaining', await driveTo('ares', 6), 'm');
await shot('m08-ares');
await pc.keyboard.press('KeyE');
await pc.waitForFunction(() => window.orion.mission.phase === 'emergency-lead', null, { timeout: 8000 });
console.log('linked ✔', await state());
console.log('lead to zone, remaining', await driveTo('zone', 4, 90000), 'm');
await pc.waitForTimeout(2500);
await shot('m09-escort');
await pc.waitForFunction(() => ['recovery', 'final'].includes(window.orion.mission.phase), null, { timeout: 30000 });
console.log('recovery started ✔', await state());
await pc.waitForTimeout(6000);
await shot('m10-recovery');
await skip(6);
await pc.waitForFunction(() => window.orion.mission.phase === 'final', null, { timeout: 40000 });
console.log('to s3, remaining', await driveTo('s3'), 'm');
await pc.keyboard.press('KeyE');
await pc.waitForTimeout(8000);
await shot('m11-s3');
await skip(8);
await pc.waitForSelector('.report', { timeout: 40000 });
await pc.waitForTimeout(1500);
await shot('m12-report');
console.log('final', await pc.evaluate(() => document.querySelector('.report-stats')?.innerText.replace(/\n/g, ' | ')));

console.log(errors.length ? `console issues:\n${[...new Set(errors)].join('\n')}` : 'no console errors');
await browser.close();
