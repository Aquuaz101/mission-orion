// Automated playthrough of Mission 02 (Mars, v2 cinematic). Usage: node scripts/qa-mars.mjs <outDir>
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
const fps = () => pc.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(Math.round(n / 2)); }; requestAnimationFrame(f); }));
const skip = async (n = 4) => { for (let i = 0; i < n; i++) { await pc.keyboard.press('Tab'); await pc.waitForTimeout(250); } };
const state = () => pc.evaluate(() => { const m = window.orion.mission; return { phase: m.phase, target: m.targetId, battery: m.battery.toFixed(2), timer: m.timer && Math.round(m.timer), collected: m.collected.join(','), storm: m.stage.storm.toFixed(2), dist: Math.round(m.stage.distance) }; });
const waitPhase = (p, ms = 60000) => pc.waitForFunction((p) => [].concat(p).includes(window.orion.mission?.phase), p, { timeout: ms });

async function driveTo(id, stopDist = 4.5, maxMs = 120000) {
  const t0 = Date.now();
  const held = new Set();
  const setKeys = async (keys) => {
    for (const k of [...held]) if (!keys.includes(k)) { await pc.keyboard.up(k); held.delete(k); }
    for (const k of keys) if (!held.has(k)) { await pc.keyboard.down(k); held.add(k); }
  };
  let stuck = 0, last = null;
  while (Date.now() - t0 < maxMs) {
    const s = await pc.evaluate((id) => {
      const m = window.orion.mission, st = m.stage;
      const tgt = id === 'ares' ? st.ares.group.position : m.pois.get(id).pos;
      const dx = tgt.x - st.roverPos.x, dz = tgt.z - st.roverPos.z;
      const rel = Math.atan2(Math.sin(Math.atan2(dx, dz) - st.roverYaw), Math.cos(Math.atan2(dx, dz) - st.roverYaw));
      return { d: Math.hypot(dx, dz), rel, locked: m.locked || st.inCutscene, x: st.roverPos.x, z: st.roverPos.z };
    }, id);
    if (s.d < stopDist) break;
    if (s.locked) { await setKeys([]); await pc.waitForTimeout(200); continue; }
    if (last && Math.hypot(s.x - last.x, s.z - last.z) < 0.05) stuck++; else stuck = 0;
    last = s;
    const keys = [];
    if (stuck > 15) { keys.push('KeyS', s.rel > 0 ? 'KeyD' : 'KeyA'); if (stuck > 30) stuck = 0; }
    else {
      if (Math.abs(s.rel) < 0.9) keys.push('KeyW');
      if (s.rel > 0.06) keys.push('KeyA'); else if (s.rel < -0.06) keys.push('KeyD');
    }
    await setKeys(keys);
    await pc.waitForTimeout(80);
  }
  await setKeys([]);
  await pc.waitForTimeout(700);
  return pc.evaluate((id) => { const m = window.orion.mission, st = m.stage; const t = id === 'ares' ? st.ares.group.position : m.pois.get(id).pos; return Math.hypot(t.x - st.roverPos.x, t.z - st.roverPos.z).toFixed(1); }, id);
}

await pc.goto(BASE);
await pc.waitForSelector('.intro', { timeout: 60000 });
await pc.click('.intro'); await pc.waitForTimeout(150); await pc.keyboard.press('Escape'); await pc.waitForTimeout(1200);
await pc.click('.cod-item[data-a="start"]'); await pc.waitForTimeout(600);
await pc.click('.choice[data-m="device"]'); await pc.waitForSelector('.ms'); await pc.waitForTimeout(900);
await pc.click('.ms-card[data-id="mars"]');
await pc.waitForSelector('.briefing', { timeout: 20000 }); await pc.waitForTimeout(2500);
await shot('v01-briefing');
const t0 = Date.now();
await pc.keyboard.press('Enter');
await pc.waitForTimeout(1300);
await shot('v02-dive');
await pc.waitForSelector('.mhud', { timeout: 40000 });
console.log(`descent + world build: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await pc.waitForTimeout(1500);
await shot('v03-intro-aerial');
await pc.waitForTimeout(3500);
await shot('v04-intro-low');
await waitPhase('explore', 30000);
await pc.waitForTimeout(1200);
await shot('v05-start');
console.log('mars fps:', await fps());
await pc.keyboard.press('KeyV'); await pc.waitForTimeout(900);
await shot('v06-firstperson');
await pc.keyboard.press('KeyV'); await pc.waitForTimeout(600);
await skip(3);

console.log('to s1, remaining', await driveTo('s1'), 'm', await state());
await shot('v07-at-s1');
await pc.keyboard.press('KeyE');
await pc.waitForTimeout(3600); await shot('v08-arm-reach');
await pc.waitForTimeout(1500); await shot('v09-arm-grab');
await pc.waitForFunction(() => window.orion.mission.collected.length === 1, null, { timeout: 20000 });
await pc.waitForTimeout(800); await shot('v10-sample-card');
await skip(4);

console.log('to s2, remaining', await driveTo('s2'), 'm');
await pc.keyboard.press('KeyE');
await pc.waitForFunction(() => window.orion.mission.collected.length === 2, null, { timeout: 25000 });
await skip(4);
await waitPhase('emergency-find', 40000);
await pc.waitForTimeout(7000); await shot('v11-storm-front');
console.log(await state());
await skip(5);

console.log('to ARES-7, remaining', await driveTo('ares', 8), 'm', await state());
await shot('v12-near-ares');
await pc.waitForFunction(() => !window.orion.mission.locked && !window.orion.mission.stage.inCutscene, null, { timeout: 30000 });
await pc.keyboard.press('KeyE');
await pc.waitForTimeout(3000); await shot('v13-latch');
await waitPhase('emergency-tow', 15000);
console.log('latched ✔', await state());
await pc.waitForTimeout(1500);
console.log('tow to zone, remaining', await driveTo('zone', 3, 150000), 'm');
await shot('v14-towing');
await waitPhase(['recovery', 'final'], 40000);
await pc.waitForTimeout(5500); await shot('v15-recovery');
await skip(6);
await waitPhase('final', 40000);
console.log('to s3, remaining', await driveTo('s3'), 'm');
await pc.keyboard.press('KeyE');
await pc.waitForFunction(() => window.orion.mission.collected.length === 3, null, { timeout: 25000 });
await skip(8);
await pc.waitForSelector('.report', { timeout: 40000 });
await pc.waitForTimeout(1200); await shot('v16-report');
console.log('final', await pc.evaluate(() => document.querySelector('.report-stats')?.innerText.replace(/\n/g, ' | ')));
console.log(errors.length ? `console issues:\n${[...new Set(errors)].join('\n')}` : 'no console errors');
await browser.close();
