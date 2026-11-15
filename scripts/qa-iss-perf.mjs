// Mission 03 render budget: draw calls + triangles per frame (all passes), GPU memory counts and frame rate at three
// fixed moments: night start, daytime worksite (light shafts + shadows), and a third-person cutscene.
// Usage: node scripts/qa-iss-perf.mjs
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const t0 = Date.now();
await p.goto('http://localhost:5173'); await p.waitForSelector('.intro', { timeout: 90000 });
await p.click('.intro'); await p.waitForTimeout(150); await p.keyboard.press('Escape');
await p.click('.cod-item[data-a="start"]'); await p.click('.choice[data-m="device"]'); await p.waitForSelector('.ms'); await p.waitForTimeout(400);
await p.click('.ms-card[data-id="iss"]'); await p.waitForSelector('.briefing', { timeout: 90000 }); await p.waitForTimeout(500);
const tb = Date.now();
await p.keyboard.press('Enter'); await p.waitForSelector('.ihud', { timeout: 120000 });
console.log(`boot (briefing → helmet cam): ${((Date.now() - tb) / 1000).toFixed(1)} s`);
await p.waitForTimeout(11000);
const sample = (tag) => p.evaluate(async (tag) => {
  const r = window.orion.engine.renderer, info = r.info;
  info.autoReset = false;
  const frame = () => new Promise((res) => requestAnimationFrame(res));
  await frame(); info.reset();
  let calls = 0, tris = 0, n = 0; const t = performance.now();
  for (let i = 0; i < 40; i++) { await frame(); calls += info.render.calls; tris += info.render.triangles; info.reset(); n++; }
  const ms = (performance.now() - t) / n;
  info.autoReset = true;
  return `${tag.padEnd(22)} ${String(Math.round(calls / n)).padStart(5)} calls  ${(tris / n / 1e6).toFixed(2)}M tris  ${ms.toFixed(1)} ms/frame (${Math.round(1000 / ms)} fps)  res ${window.orion.engine.resScale.toFixed(2)}  | geometries ${info.memory.geometries} textures ${info.memory.textures} programs ${info.programs.length}`;
}, tag);
console.log(await sample('night start'));
await p.evaluate(() => { const st = window.orion.mission.stage; st.sunElev = 8; st.body.position.copy(st.at(0, 0.1, 1.0)); st.bodyLook.copy(st.at(-6, -1.5, 14)); });
await p.waitForTimeout(2500);
console.log(await sample('day, facing the Sun'));
await p.evaluate(() => { const st = window.orion.mission.stage; st.bodyLook.copy(st.at(0, 0, 0.27)); });
await p.waitForTimeout(1500);
console.log(await sample('day, at the battery'));
await p.evaluate(() => { const st = window.orion.mission.stage; void st.cine([{ dur: 30, fov: 46, cam: () => st.at(2.4, 0.75, 2.7), look: () => st.at(0, 0, 0.8) }]); });
await p.waitForTimeout(2000);
console.log(await sample('cutscene (wide)'));
console.log(errs.length ? [...new Set(errs)].join('\n') : 'no errors');
await b.close();
