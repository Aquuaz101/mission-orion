// Automated playthrough of Mission 01 (Jupiter) in real Chrome + phone controller check.
// Usage: node scripts/qa-jupiter.mjs <outDir>
import { chromium } from 'playwright-core';

const OUT = process.argv[2] ?? 'qa-shots';
const BASE = 'http://localhost:5173';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const errors = [];
const watch = (page, tag) => {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${tag} ${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${tag} pageerror] ${e.message}`));
};
const pc = await browser.newPage({ viewport: { width: 1600, height: 900 } });
watch(pc, 'pc');
const shot = (n) => pc.screenshot({ path: `${OUT}/${n}.png` });
const skipLines = async (n = 6) => { for (let i = 0; i < n; i++) { await pc.keyboard.press('Tab'); await pc.waitForTimeout(150); } };
const fps = () => pc.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(Math.round(n / 2)); }; requestAnimationFrame(f); }));

await pc.goto(BASE);
await pc.waitForSelector('.begin:not([hidden])', { timeout: 60000 });
await pc.click('.begin');
await pc.waitForTimeout(1200);
await pc.click('.cod-item[data-a="start"]');
await pc.waitForTimeout(800);
await pc.click('.choice[data-m="device"]');
await pc.waitForSelector('.ms-card[data-id="jupiter"]');
await pc.waitForTimeout(900);
await pc.click('.ms-card[data-id="jupiter"]');
await pc.waitForSelector('.briefing', { timeout: 10000 });
await pc.waitForTimeout(2600);
await shot('j01-briefing');

// Phone joins (same PIN) to test the Jupiter controller layout.
const pin = await pc.evaluate(() => window.orion.link.pin);
const phoneCtx = await browser.newContext({ viewport: { width: 860, height: 400 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const phone = await phoneCtx.newPage();
watch(phone, 'phone');
await phone.goto(`${BASE}/controller/?pin=${pin}`);

await pc.keyboard.press('Enter');
await pc.waitForSelector('.jhud', { timeout: 15000 });
await pc.waitForTimeout(2200);
await shot('j02-telescope-start');
console.log('telescope fps:', await fps());

// Phone: drag the touch pad and confirm the telescope moved.
await phone.waitForSelector('.touchpad', { timeout: 8000 });
await phone.screenshot({ path: `${OUT}/j03-phone-jupiter.png` });
const before = await pc.evaluate(() => ({ x: window.orion.mission.stage.centerTarget.x, y: window.orion.mission.stage.centerTarget.y }));
const pad = await phone.locator('.touchpad').boundingBox();
await phone.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
await phone.mouse.down();
await phone.mouse.move(pad.x + pad.width / 2 - 120, pad.y + pad.height / 2 - 60, { steps: 6 });
await phone.waitForTimeout(900);
await phone.mouse.up();
await pc.waitForTimeout(200);
const after = await pc.evaluate(() => ({ x: window.orion.mission.stage.centerTarget.x, y: window.orion.mission.stage.centerTarget.y }));
console.log(`phone pad moved telescope: (${before.x.toFixed(2)},${before.y.toFixed(2)}) â†’ (${after.x.toFixed(2)},${after.y.toFixed(2)})`, after.x < before.x ? 'âœ”' : 'âœ˜');
// Phone zoom button
const f0 = await pc.evaluate(() => window.orion.mission.stage.fieldTarget);
const zin = await phone.locator('.zoom-in').boundingBox();
await phone.mouse.move(zin.x + 20, zin.y + 20); await phone.mouse.down(); await phone.waitForTimeout(600); await phone.mouse.up();
const f1 = await pc.evaluate(() => window.orion.mission.stage.fieldTarget);
console.log(`phone zoom-in: field ${f0.toFixed(2)} â†’ ${f1.toFixed(2)}`, f1 < f0 ? 'âœ”' : 'âœ˜');

// Bad capture first: must be rejected.
await pc.keyboard.press('Space');
await pc.waitForTimeout(700);
await shot('j04-rejected');
console.log('rejected card:', (await pc.textContent('.capture-card .cc-title')).trim(), '|', (await pc.textContent('.capture-card .cc-sub')).trim());
await skipLines(2);

// Perfect operator for each objective.
async function solve(kind, label) {
  await pc.waitForFunction((k) => window.orion.mission?.objective?.id === k && !window.orion.mission.busy, kind, { timeout: 30000 });
  for (let i = 0; i < 160; i++) {
    const ok = await pc.evaluate((kind) => {
      const s = window.orion.mission.stage;
      let p, field;
      if (kind === 'disk') { p = { x: 0, y: 0 }; field = 2.6; }
      if (kind === 'grs') { const g = s.grs(); if (!g.visible) return false; p = g.pos; field = 0.8; }
      if (kind === 'europa') { const b = s.body('europa'); p = b.pos; field = 0.14; }
      s.centerTarget.set(p.x, p.y); s.fieldTarget = field;
      s.focus = s.bestFocus(); s.exposure = 0.5;
      const settled = Math.abs(s.fieldH - field) / field < 0.01;
      return settled && document.querySelector('.jhud')?.classList.contains('ready');
    }, kind);
    if (ok) break;
    await pc.waitForTimeout(250);
  }
  await pc.waitForTimeout(400);
  await shot(`j-${label}-ready`);
  await pc.keyboard.press('Space');
  await pc.waitForTimeout(900);
  await shot(`j-${label}-captured`);
  console.log(`${label}:`, (await pc.textContent('.capture-card .cc-title')).trim());
  await skipLines(4);
  await pc.waitForTimeout(600);
}
await solve('disk', '05-disk');
await solve('grs', '06-grs');
await solve('europa', '07-europa');
await skipLines(4);
await pc.waitForSelector('.report', { timeout: 20000 });
await pc.waitForTimeout(1500);
await shot('j08-report');
console.log('report figures:', await pc.locator('.report-figs figure').count());

// Pause menu works during a mission â†’ restart path
await pc.click('.replay');
await pc.waitForSelector('.briefing', { timeout: 10000 });
await pc.keyboard.press('Escape');
await pc.waitForSelector('.pause', { timeout: 3000 });
await shot('j09-pause');
await pc.click('[data-a="abort"]');
await pc.waitForSelector('.ms', { timeout: 8000 });
console.log('abort â†’ mission select âœ”');

console.log(errors.length ? `console issues:\n${errors.join('\n')}` : 'no console errors');
await browser.close();

