// Instrumented run of objectives A → B to see why B doesn't become ready.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'] });
const pc = await browser.newPage({ viewport: { width: 1280, height: 720 } });
pc.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await pc.goto('http://localhost:5173');
await pc.waitForSelector('.begin:not([hidden])', { timeout: 60000 });
await pc.click('.begin'); await pc.waitForTimeout(800);
await pc.click('[data-a="start"]'); await pc.waitForTimeout(600);
await pc.click('.choice[data-m="device"]'); await pc.waitForSelector('.mission[data-id="jupiter"]'); await pc.waitForTimeout(700);
await pc.click('.mission[data-id="jupiter"]'); await pc.waitForSelector('.briefing'); await pc.waitForTimeout(500);
await pc.keyboard.press('Enter'); await pc.waitForSelector('.jhud', { timeout: 15000 }); await pc.waitForTimeout(500);
// Objective A
await pc.evaluate(() => { const s = window.orion.mission.stage; s.centerTarget.set(0, 0); s.fieldTarget = 2.6; });
await pc.waitForTimeout(1500);
await pc.evaluate(() => { const s = window.orion.mission.stage; s.focus = s.bestFocus(); });
await pc.waitForTimeout(300);
await pc.keyboard.press('Space');
for (let i = 0; i < 30; i++) {
  const st = await pc.evaluate(() => {
    const m = window.orion.mission, s = m.stage, g = s.grs();
    if (m.objective?.id === 'grs' && g.visible) { s.centerTarget.set(g.pos.x, g.pos.y); s.fieldTarget = 0.8; s.focus = s.bestFocus(); }
    const chips = [...document.querySelectorAll('.chips span')].map((c) => c.dataset.c + (c.classList.contains('ok') ? '+' : '-')).join(' ');
    return { obj: m.objective?.id, busy: m.busy, vis: g.visible, ang: Math.round(s.grsAngle() * 57.3), ts: s.timeScale, f: s.focus.toFixed(3), best: s.bestFocus().toFixed(3), fh: s.fieldH.toFixed(2), chips, cmd: window.orion.commander.busy };
  });
  console.log(JSON.stringify(st));
  await pc.waitForTimeout(1000);
}
await browser.close();
