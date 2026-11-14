// Where do the Mars draw calls come from? Counts visible meshes per subsystem.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'] });
const pc = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await pc.goto('http://localhost:5173');
await pc.waitForSelector('.begin:not([hidden])', { timeout: 60000 });
await pc.click('.begin'); await pc.waitForTimeout(800);
await pc.click('.cod-item[data-a="start"]'); await pc.waitForTimeout(400);
await pc.click('.choice[data-m="device"]'); await pc.waitForSelector('.ms'); await pc.waitForTimeout(500);
await pc.click('.ms-card[data-id="mars"]'); await pc.waitForSelector('.briefing', { timeout: 20000 }); await pc.waitForTimeout(300);
await pc.keyboard.press('Enter');
await pc.waitForFunction(() => window.orion.mission?.phase === 'explore', null, { timeout: 60000 });
const r = await pc.evaluate(() => {
  const st = window.orion.mission.stage;
  const count = (root) => { let vis = 0, shadow = 0, hidden = 0; root.traverseVisible((o) => { if (o.isMesh) { vis++; if (o.castShadow) shadow++; } }); root.traverse((o) => { if (o.isMesh && !o.visible) hidden++; }); return { vis, shadow, hidden }; };
  const out = { rover: count(st.rover), merged: st.merged?.meshes.length, wheels: st.wheels.length, terrainTiles: st.terrain.group.children.length };
  let other = 0; st.scene.children.forEach((c) => { if (c !== st.rover && c !== st.terrain.group) c.traverseVisible((o) => { if (o.isMesh || o.isPoints || o.isLine) other++; }); });
  out.otherObjects = other;
  const e = window.orion.engine; out.info = e.renderer.info.render; out.programs = e.renderer.info.programs?.length;
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
