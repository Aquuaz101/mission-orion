// Fixed close-up views of the station in Mission 03 (daylight), for visual comparisons. Usage: node scripts/qa-iss-closeup.mjs outPrefix
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'qa-shots/closeup';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto('http://localhost:5173'); await p.waitForSelector('.intro', { timeout: 90000 });
await p.click('.intro'); await p.waitForTimeout(150); await p.keyboard.press('Escape');
await p.click('.cod-item[data-a="start"]'); await p.click('.choice[data-m="device"]'); await p.waitForSelector('.ms'); await p.waitForTimeout(400);
await p.click('.ms-card[data-id="iss"]'); await p.waitForSelector('.briefing', { timeout: 90000 }); await p.waitForTimeout(500);
await p.keyboard.press('Enter'); await p.waitForSelector('.ihud', { timeout: 120000 }); await p.waitForTimeout(3000);
await p.addStyleTag({ content: '#ui * { opacity: 0 !important; }' });
const views = [
  ['quest', (st) => [st.air(1.6, 0.6, 1.4), st.air(-2, -0.5, -1)]],
  ['truss', (st) => [st.at(1.5, 1.2, 3.2), st.at(-3, 0, 0)]],
  ['modules', (st) => [new st.body.position.constructor(-6, 3, 6), new st.body.position.constructor(4, -2, -6)]],
];
for (const [name] of views) {
  await p.evaluate((name) => {
    const st = window.orion.mission.stage; st.sunElev = 12;
    const V = st.body.position.constructor;
    const v = { quest: [st.air(1.6, 0.6, 1.4), st.air(-2, -0.5, -1)], truss: [st.at(1.5, 1.2, 3.2), st.at(-3, 0, 0)], modules: [new V(-6, 3, 6), new V(4, -2, -6)] }[name];
    st.travel = null; st.body.position.copy(v[0]); st.bodyLook.copy(v[1]);
    st.L.h.root.visible = st.R.h.root.visible = false;
  }, name);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}-${name}.jpg`, type: 'jpeg', quality: 85 });
}
await b.close();
console.log('ok');
