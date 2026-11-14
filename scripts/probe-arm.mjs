// Where does Perseverance's turret (hand) go during the NASA arm clips? Prints node names + turret path.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'] });
const pc = await browser.newPage();
await pc.goto('http://localhost:5173');
await pc.waitForSelector('.begin:not([hidden])', { timeout: 60000 });
const r = await pc.evaluate(async () => {
  const THREE = await import('/node_modules/.vite/deps/three.js');
  const g = window.orion.assets.models.rover;
  const scene = g.scene;
  const names = [];
  scene.traverse((o) => { if (/turret|arm|head|mast|top|Cylinder|bottom|hinge|drill|lens/i.test(o.name)) names.push(o.name); });
  const mixer = new THREE.AnimationMixer(scene);
  const clips = g.animations.filter((c) => /^(arm|turret|hinge)/i.test(c.name));
  const acts = clips.map((c) => { const a = mixer.clipAction(c); a.play(); return a; });
  const turret = scene.getObjectByName('turret_obj') || scene.getObjectByName('turret.001') || scene.getObjectByName('turret');
  const dur = Math.max(...clips.map((c) => c.duration));
  const path = [];
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * dur;
    mixer.setTime(t);
    scene.updateMatrixWorld(true);
    const p = turret.getWorldPosition(new THREE.Vector3());
    path.push(`${t.toFixed(1)}s: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
  }
  mixer.setTime(0);
  return { turret: turret?.name, dur, clips: clips.map((c) => c.name), names: [...new Set(names)].slice(0, 60), path };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
