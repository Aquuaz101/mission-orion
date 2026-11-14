// Close-up check of the arm pick-up, the Sun, and the satellite exit. Usage: node scripts/qa-arm.mjs <outDir> [arm|sun|exit|all]
import { chromium } from 'playwright-core';
const OUT = process.argv[2] ?? '.';
const WHAT = process.argv[3] ?? 'all';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pc = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
pc.on('pageerror', (e) => errors.push(e.message));
pc.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
await pc.addInitScript(() => localStorage.setItem('orion.quality', 'high'));
await pc.goto('http://localhost:5173');
await pc.waitForSelector('.intro', { timeout: 60000 });
await pc.click('.intro'); await pc.waitForTimeout(150); await pc.keyboard.press('Escape'); await pc.waitForTimeout(1000);
await pc.click('.cod-item[data-a="start"]'); await pc.waitForTimeout(500);
await pc.click('.choice[data-m="device"]'); await pc.waitForSelector('.ms'); await pc.waitForTimeout(600);
await pc.click('.ms-card[data-id="mars"]'); await pc.waitForSelector('.briefing', { timeout: 20000 }); await pc.waitForTimeout(400);
await pc.keyboard.press('Enter');
await pc.waitForFunction(() => window.orion.mission?.phase === 'explore', null, { timeout: 60000 });
for (let i = 0; i < 4; i++) { await pc.keyboard.press('Tab'); await pc.waitForTimeout(150); }
const shot = (n) => pc.screenshot({ path: `${OUT}/${n}.png` });
const near = (id, d = 4.5) => pc.evaluate(([id, d]) => {
  const m = window.orion.mission, st = m.stage, p = m.pois.get(id).pos;
  st.placeRover({ x: p.x + d * 0.6, y: 0, z: p.z + d * 0.8 }, Math.atan2(-0.6, -0.8) + 0.5);
}, [id, d]);

if (WHAT === 'sun' || WHAT === 'all') {
  await pc.evaluate(() => { const st = window.orion.mission.stage; st.setView('fp'); st.lookYaw = Math.atan2(-0.42, -0.84) - st.roverYaw; st.lookPitch = 0.42; });
  await pc.waitForTimeout(1500); await shot('sun-fp');
  await pc.evaluate(() => { const st = window.orion.mission.stage; st.setView('chase'); st.lookYaw = Math.atan2(-0.42, -0.84) - st.roverYaw; st.lookPitch = 0.0; st.camDist = 12; });
  await pc.waitForTimeout(2500); await shot('sun-chase');
}
if (WHAT === 'arm' || WHAT === 'all') {
  console.log('pickup spot (rover-local):', await pc.evaluate(() => window.orion.mission.stage.pickupLocal.toArray().map((v) => +v.toFixed(2))));
  await near('s1');
  await pc.waitForTimeout(600);
  await pc.keyboard.press('KeyE');
  const stages = [
    ['arm-1-deploying', (a) => a.deploy > 0.5],
    ['arm-2-deployed', (a) => a.deploy > 0.99],
    ['arm-3-reached', (a) => a.reach > 0.99],
    ['arm-4-drilling', (a) => a.spin > 6],
    ['arm-5-lifted', (a) => a.spin > 15 && a.reach < 0.05],
    ['arm-6-stowing', (a) => a.spin > 15 && a.deploy < 0.45],
  ];
  for (const [name, cond] of stages) {
    await pc.waitForFunction(`(() => { const m = window.orion.mission; if ((${cond.toString()})(m.stage.arm)) { m.setPaused(true); return true; } return false; })()`, null, { timeout: 20000, polling: 16 });
    await pc.waitForTimeout(250);
    await shot(name);
    const st = await pc.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const st = window.orion.mission.stage, a = st.arm;
      const tip = a.turret.getWorldPosition(new THREE.Vector3());
      return { deploy: +a.deploy.toFixed(2), reach: +a.reach.toFixed(2), tipAboveGround: +(tip.y - st.terrain.heightAt(tip.x, tip.z)).toFixed(2) };
    });
    console.log(name, JSON.stringify(st));
    await pc.evaluate(() => window.orion.mission.setPaused(false));
  }
  await pc.waitForFunction(() => window.orion.mission.collected.length === 1, null, { timeout: 20000 });
  await pc.waitForTimeout(1200); await shot('arm-7-hud-bar');
  console.log('bar:', await pc.evaluate(() => document.querySelector('.sample-bar').innerText.replace(/\n/g, ' | ')));
}
if (WHAT === 'exit' || WHAT === 'all') {
  await pc.evaluate(() => {
    const m = window.orion.mission, st = m.stage;
    for (const k of ['s1', 's2']) st.removeSpecimen(k);
    m.collected = ['igneous', 'hematite']; m.phase = 'final'; m.locked = false;
    st.addSpecimen('s3', 'sedimentary', m.pois.get('s3').pos); m.setTarget('s3'); m.paintInventory();
    window.orion.commander.clear();
  });
  await near('s3');
  await pc.waitForTimeout(500);
  await pc.keyboard.press('KeyE');
  await pc.waitForFunction(() => window.orion.mission.collected.length === 3, null, { timeout: 30000 });
  for (let i = 0; i < 6; i++) { await pc.keyboard.press('Tab'); await pc.waitForTimeout(120); }
  await pc.waitForSelector('.sat-ui', { timeout: 30000 });
  const t0 = Date.now();
  for (const [alt, name] of [[25, 'exit-1-tilt'], [94, 'exit-2-level1'], [184, 'exit-3-level2'], [299, 'exit-4-level3']]) {
    await pc.waitForFunction((alt) => { const m = window.orion.mission, st = m.stage; if (st.camera.position.y - st.roverPos.y >= alt) { m.setPaused(true); return true; } return false; }, alt, { timeout: 20000, polling: 16 });
    await pc.waitForTimeout(250); await shot(name);
    await pc.evaluate(() => window.orion.mission.setPaused(false));
  }
  await pc.waitForSelector('.report', { timeout: 30000 });
  console.log(`exit → report in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await pc.waitForTimeout(1000); await shot('exit-5-report');
  await pc.click('.to-select');
  await pc.waitForSelector('.ms', { timeout: 10000 });
  await pc.waitForTimeout(700); await shot('exit-6-select-pullout');
  await pc.waitForTimeout(2500); await shot('exit-7-select');
}
console.log(errors.length ? [...new Set(errors)].join('\n') : 'no console errors');
await browser.close();
