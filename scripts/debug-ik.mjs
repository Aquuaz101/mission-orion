// Arm IK diagnostics: deployed geometry, reach errors for a grid of targets.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'] });
const pc = await browser.newPage({ viewport: { width: 1280, height: 720 } });
pc.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await pc.goto('http://localhost:5173');
await pc.waitForSelector('.begin:not([hidden])', { timeout: 60000 });
await pc.click('.begin'); await pc.waitForTimeout(800);
await pc.click('.cod-item[data-a="start"]'); await pc.waitForTimeout(400);
await pc.click('.choice[data-m="device"]'); await pc.waitForSelector('.ms'); await pc.waitForTimeout(500);
await pc.click('.ms-card[data-id="mars"]'); await pc.waitForSelector('.briefing', { timeout: 20000 }); await pc.waitForTimeout(300);
await pc.keyboard.press('Enter');
await pc.waitForFunction(() => window.orion.mission?.phase === 'explore', null, { timeout: 60000 });
const r = await pc.evaluate(async () => {
  const THREE = await import('/node_modules/.vite/deps/three.js');
  const st = window.orion.mission.stage, a = st.arm, model = st.model;
  const f = (v) => v.toArray().map((x) => +x.toFixed(2));
  const local = (n) => f(model.worldToLocal(n.getWorldPosition(new THREE.Vector3())));
  const out = { stowed: {}, deployed: {}, grid: [] };
  model.updateMatrixWorld(true);
  for (const j of a.joints) out.stowed[j.node.name] = local(j.node);
  out.stowed.turret = local(a.turret);
  a.deploy = 1; a.apply(); model.updateMatrixWorld(true);
  for (const j of a.joints) out.deployed[j.node.name] = local(j.node);
  out.deployed.turret = local(a.turret);
  // turret extent below its origin (deployed)
  const box = new THREE.Box3().setFromObject(a.turret);
  out.turretBoxWorld = { min: f(box.min), max: f(box.max), origin: f(a.turret.getWorldPosition(new THREE.Vector3())) };
  // effect of each joint offset on the tip (deployed)
  out.jointEffect = [0, 1, 2, 3].map((j) => { const p = [0, 0, 0, 0]; p[j] = 0.3; a.apply(p); model.updateMatrixWorld(true); return local(a.turret); });
  a.deploy = 0; a.apply();
  for (const z of [1.7, 1.95, 2.2]) for (const x of [0, 0.4, 0.8]) for (const y of [0.36, 0.6]) {
    const s = a.solve(new THREE.Vector3(x, y, z));
    out.grid.push(`target(${x},${y},${z}) err=${s.error.toFixed(3)} pose=${s.pose.map((v) => v.toFixed(2)).join(',')}`);
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
