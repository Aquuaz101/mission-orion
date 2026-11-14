// Measures wheel-to-ground gaps on side slopes (should be ~0: no floating, no sinking) + screenshots.
import { chromium } from 'playwright-core';
const OUT = process.argv[2] ?? '.';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'] });
const pc = await browser.newPage({ viewport: { width: 1600, height: 900 } });
pc.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await pc.goto('http://localhost:5173');
await pc.waitForSelector('.intro', { timeout: 60000 });
await pc.click('.intro'); await pc.waitForTimeout(150); await pc.keyboard.press('Escape'); await pc.waitForTimeout(1000);
await pc.click('.cod-item[data-a="start"]'); await pc.waitForTimeout(500);
await pc.click('.choice[data-m="device"]'); await pc.waitForSelector('.ms'); await pc.waitForTimeout(600);
await pc.click('.ms-card[data-id="mars"]'); await pc.waitForSelector('.briefing', { timeout: 20000 }); await pc.waitForTimeout(400);
await pc.keyboard.press('Enter');
await pc.waitForFunction(() => window.orion.mission?.phase === 'explore', null, { timeout: 60000 });
// Find spots with 12–24° side slope, park the rover across the slope, measure.
const spots = await pc.evaluate(() => {
  const st = window.orion.mission.stage, t = st.terrain, out = [];
  for (let i = 0; i < 4000 && out.length < 3; i++) {
    const x = (Math.random() - 0.5) * 500, z = (Math.random() - 0.5) * 500;
    const s = t.slopeAt(x, z);
    if (s > 12 && s < 24) { const n = t.normalAt(x, z); out.push({ x, z, yaw: Math.atan2(n.z, -n.x), slope: s }); } // heading along the contour
  }
  return out;
});
let k = 0;
for (const s of spots) {
  await pc.evaluate((s) => { const st = window.orion.mission.stage; st.placeRover({ x: s.x, y: 0, z: s.z }, s.yaw); }, s);
  await pc.waitForTimeout(1500);
  const r = await pc.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const st = window.orion.mission.stage;
    st.rover.updateMatrixWorld(true);
    const W = [[-1.12, -1.18], [-1.12, 0.02], [-1.12, 1.15], [1.12, -1.18], [1.12, 0.02], [1.12, 1.15]];
    const gaps = W.map(([x, z]) => { const p = st.rover.localToWorld(new THREE.Vector3(x, 0, z)); return +(p.y - st.terrain.heightAt(p.x, p.z)).toFixed(2); });
    return { gaps, roll: +(st.roll * 57.3).toFixed(1), pitch: +(st.pitch * 57.3).toFixed(1) };
  });
  console.log(`slope ${s.slope.toFixed(0)}° roll ${r.roll}° pitch ${r.pitch}° wheel gaps (m, + = above ground):`, r.gaps.join(' '));
  await pc.screenshot({ path: `${OUT}/w${++k}.png` });
}
await browser.close();
