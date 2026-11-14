// Visual + perf check of the Mars look. Usage: node scripts/qa-look.mjs <outDir> [quality]
import { chromium } from 'playwright-core';
const OUT = process.argv[2] ?? '.';
const Q = process.argv[3] ?? 'high';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pc = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
pc.on('pageerror', (e) => errors.push(e.message));
pc.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
await pc.addInitScript((q) => localStorage.setItem('orion.quality', q), Q);
await pc.goto('http://localhost:5173');
await pc.waitForSelector('.begin:not([hidden])', { timeout: 60000 });
await pc.click('.begin'); await pc.waitForTimeout(1000);
await pc.click('.cod-item[data-a="start"]'); await pc.waitForTimeout(500);
await pc.click('.choice[data-m="device"]'); await pc.waitForSelector('.ms'); await pc.waitForTimeout(600);
await pc.click('.ms-card[data-id="mars"]'); await pc.waitForSelector('.briefing', { timeout: 20000 }); await pc.waitForTimeout(400);
await pc.keyboard.press('Enter');
await pc.waitForFunction(() => window.orion.mission?.phase === 'explore', null, { timeout: 60000 });
await pc.keyboard.press('F3');
for (let i = 0; i < 4; i++) { await pc.keyboard.press('Tab'); await pc.waitForTimeout(150); }
await pc.waitForTimeout(3000);
await pc.screenshot({ path: `${OUT}/L-${Q}-1-start.png` });
const perf = () => pc.evaluate(() => { const e = window.orion.engine; return { fps: +e.fps.toFixed(0), ms: +e.frameMs.toFixed(1), res: e.resScale, calls: e.renderer.info.render.calls, tris: e.renderer.info.render.triangles }; });
console.log(Q, 'start view', JSON.stringify(await perf()));
// Wheels: drive forward and check they rotate
const w0 = await pc.evaluate(() => window.orion.mission.stage.wheels.map((w) => w.pivot.rotation.x));
await pc.keyboard.down('KeyW'); await pc.waitForTimeout(2500);
await pc.screenshot({ path: `${OUT}/L-${Q}-2-driving.png` });
await pc.keyboard.up('KeyW');
const w1 = await pc.evaluate(() => window.orion.mission.stage.wheels.map((w) => w.pivot.rotation.x));
console.log('wheels:', w0.length, 'split; rotation delta (rad):', w1.map((v, i) => (v - w0[i]).toFixed(1)).join(' '));
// Turn on the spot: left/right should counter-rotate
const t0 = await pc.evaluate(() => window.orion.mission.stage.wheels.map((w) => w.pivot.rotation.x));
await pc.keyboard.down('KeyA'); await pc.waitForTimeout(1500); await pc.keyboard.up('KeyA');
const t1 = await pc.evaluate(() => window.orion.mission.stage.wheels.map((w) => w.pivot.rotation.x));
console.log('turn-on-spot deltas:', t1.map((v, i) => (v - t0[i]).toFixed(2)).join(' '));
// Reference-style shot: low camera, looking toward the Sun across the basin
await pc.evaluate(() => {
  const st = window.orion.mission.stage;
  const SUN = { x: -0.42, z: -0.84 };
  st.camDist = 7; st.lookPitch = 0.08;
  st.lookYaw = Math.atan2(SUN.x, SUN.z) - st.roverYaw + Math.PI * 0 ; // camera looks toward the sun
});
await pc.waitForTimeout(2500);
await pc.screenshot({ path: `${OUT}/L-${Q}-3-sunward.png` });
console.log(Q, 'sunward', JSON.stringify(await perf()));
await pc.evaluate(() => { const st = window.orion.mission.stage; st.lookYaw += Math.PI; });
await pc.waitForTimeout(2500);
await pc.screenshot({ path: `${OUT}/L-${Q}-4-away.png` });
console.log(Q, 'away', JSON.stringify(await perf()));
console.log(errors.length ? [...new Set(errors)].join('\n') : 'no console errors');
await browser.close();
