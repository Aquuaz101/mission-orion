// Inspect the loaded Perseverance GLB in the running game: bounds, clip names/durations.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'] });
const pc = await browser.newPage();
await pc.goto('http://localhost:5173');
await pc.waitForSelector('.intro', { timeout: 60000 });
const info = await pc.evaluate(async () => {
  const THREE = await import('/node_modules/.vite/deps/three.js');
  const g = window.orion.assets.models.rover;
  const box = new THREE.Box3().setFromObject(g.scene);
  const s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const arm = g.scene.getObjectByName('arm.001') || g.scene.getObjectByName('arm.003');
  const armPos = arm ? arm.getWorldPosition(new THREE.Vector3()) : null;
  let meshes = 0; g.scene.traverse((o) => o.isMesh && meshes++);
  return {
    size: s.toArray().map((v) => +v.toFixed(2)), center: c.toArray().map((v) => +v.toFixed(2)), min: box.min.toArray().map((v) => +v.toFixed(2)),
    armWorld: armPos?.toArray().map((v) => +v.toFixed(2)), meshes,
    clips: g.animations.map((a) => `${a.name}:${a.duration.toFixed(2)}s/${a.tracks.length}`),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
