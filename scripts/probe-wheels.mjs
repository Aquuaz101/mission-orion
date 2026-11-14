// Inspect Perseverance's wheel / suspension nodes (structure, vertex counts, bounds in model space).
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'] });
const pc = await browser.newPage();
await pc.goto('http://localhost:5173');
await pc.waitForSelector('.intro', { timeout: 60000 });
const r = await pc.evaluate(async () => {
  const THREE = await import('/node_modules/.vite/deps/three.js');
  const root = window.orion.assets.models.rover.scene;
  root.updateMatrixWorld(true);
  const out = [];
  root.traverse((o) => {
    if (!/wheel|suspen|rocker|bogie/i.test(o.name)) return;
    const box = new THREE.Box3().setFromObject(o);
    let verts = 0, meshes = 0, indexed = 0;
    o.traverse((m) => { if (m.isMesh) { meshes++; verts += m.geometry.attributes.position.count; if (m.geometry.index) indexed++; } });
    out.push({ name: o.name, type: o.type, parent: o.parent?.name, meshes, verts, indexed, min: box.min.toArray().map((v) => +v.toFixed(2)), max: box.max.toArray().map((v) => +v.toFixed(2)), children: o.children.map((c) => c.name).slice(0, 8) });
  });
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
