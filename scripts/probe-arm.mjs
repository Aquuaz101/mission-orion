// Arm rig probe: joint chain, pivots, and what every arm/turret/hinge clip animates (node, property, times, axis).
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'] });
const pc = await browser.newPage();
await pc.goto('http://localhost:5173');
await pc.waitForSelector('.begin:not([hidden])', { timeout: 60000 });
const r = await pc.evaluate(async () => {
  const THREE = await import('/node_modules/.vite/deps/three.js');
  const g = window.orion.assets.models.rover;
  const root = g.scene;
  root.updateMatrixWorld(true);
  const f = (v) => v.toArray().map((x) => +x.toFixed(3));
  const chain = [];
  for (let n = root.getObjectByName('turret_obj'); n && n !== root; n = n.parent) {
    chain.push({ name: n.name, type: n.type, world: f(n.getWorldPosition(new THREE.Vector3())), children: n.children.map((c) => c.name).slice(0, 10) });
  }
  const clips = g.animations.map((c) => ({
    name: c.name, dur: +c.duration.toFixed(2),
    tracks: c.tracks.slice(0, 6).map((t) => {
      const o = { track: t.name, keys: t.times.length, t0: +t.times[0].toFixed(2), t1: +t.times[t.times.length - 1].toFixed(2) };
      if (t.name.endsWith('.quaternion')) {
        const q0 = new THREE.Quaternion().fromArray(t.values, 0);
        let best = 0, axis = null, when = 0;
        for (let k = 1; k < t.times.length; k++) {
          const q = new THREE.Quaternion().fromArray(t.values, k * 4);
          const d = q0.clone().invert().multiply(q); // rotation in the node's local frame
          const ang = 2 * Math.acos(Math.min(1, Math.abs(d.w)));
          if (ang > best) { best = ang; when = t.times[k]; const s = Math.sqrt(1 - d.w * d.w) || 1; axis = [d.x / s, d.y / s, d.z / s].map((x) => +(x * Math.sign(d.w || 1)).toFixed(2)); }
        }
        o.maxAngleDeg = +(best * 57.3).toFixed(1); o.atTime = +when.toFixed(2); o.localAxis = axis;
        // when does it move?
        const moving = [];
        for (let k = 1; k < t.times.length; k++) { const a = new THREE.Quaternion().fromArray(t.values, (k - 1) * 4), b = new THREE.Quaternion().fromArray(t.values, k * 4); if (a.angleTo(b) > 1e-4) moving.push(t.times[k]); }
        o.movesFrom = moving.length ? +moving[0].toFixed(2) : null; o.movesTo = moving.length ? +moving[moving.length - 1].toFixed(2) : null;
      }
      return o;
    }),
    trackCount: c.tracks.length,
  }));
  return { chain, clips };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
