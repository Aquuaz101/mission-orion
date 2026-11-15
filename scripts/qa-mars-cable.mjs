// Close look at the tow cable: latch ARES-7 behind the rover, pull it taut, then reverse so it goes slack.
// Usage: node scripts/qa-mars-cable.mjs outPrefix
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'qa-shots/cable';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5173'); await p.waitForSelector('.intro', { timeout: 90000 });
await p.click('.intro'); await p.waitForTimeout(150); await p.keyboard.press('Escape');
await p.click('.cod-item[data-a="start"]'); await p.click('.choice[data-m="device"]'); await p.waitForSelector('.ms'); await p.waitForTimeout(400);
await p.click('.ms-card[data-id="mars"]'); await p.waitForSelector('.briefing', { timeout: 90000 }); await p.waitForTimeout(600);
await p.keyboard.press('Enter');
await p.waitForFunction(() => window.orion.mission?.phase === 'explore', null, { timeout: 180000 });
await p.waitForTimeout(800);
await p.evaluate(async () => {
  const m = window.orion.mission, st = m.stage;
  // park ARES-7 a cable length behind the rover and latch it
  const yaw = st.roverYaw, back = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const g = st.ares.group;
  g.position.set(st.roverPos.x + back.x * 5.2, st.terrain.heightAt(st.roverPos.x + back.x * 5.2, st.roverPos.z + back.z * 5.2), st.roverPos.z + back.z * 5.2);
  g.rotation.y = yaw; g.visible = true;
  await st.latch();
});
await p.keyboard.down('KeyW'); await p.waitForTimeout(2600);
await p.screenshot({ path: `${out}-taut.jpg`, type: 'jpeg', quality: 85 });
await p.keyboard.up('KeyW'); await p.keyboard.down('KeyS'); await p.waitForTimeout(1400); await p.keyboard.up('KeyS'); await p.waitForTimeout(900);
await p.screenshot({ path: `${out}-slack.jpg`, type: 'jpeg', quality: 85 });
// side close-up of the slack cable
await p.evaluate(() => { const st = window.orion.mission.stage; const h = st.rearHitch(); st.setOrbit(h, 4.2, 1.0, 0.02); });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}-close.jpg`, type: 'jpeg', quality: 85 });
console.log(errs.length ? errs.join('\n') : 'no errors');
await b.close();
