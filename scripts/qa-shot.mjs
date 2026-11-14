// Quick screenshot helper. Usage: node scripts/qa-shot.mjs <outPrefix> <step>
//   step = menu | select | select-hover | briefing:<missionId>
import { chromium } from 'playwright-core';
const [out, step = 'menu'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'] });
const pc = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
pc.on('pageerror', (e) => errs.push(e.message));
pc.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await pc.goto('http://localhost:5173');
await pc.waitForSelector('.begin:not([hidden])', { timeout: 60000 });
await pc.click('.begin');
await pc.waitForTimeout(3500);
if (step === 'menu') {
  await pc.hover('.cod-item[data-a="select"]');
  await pc.waitForTimeout(500);
  await pc.screenshot({ path: `${out}-menu.png` });
} else {
  await pc.click('.cod-item[data-a="start"]'); await pc.waitForTimeout(600);
  await pc.click('.choice[data-m="device"]'); await pc.waitForSelector('.ms'); await pc.waitForTimeout(2500);
  if (step.startsWith('briefing:')) {
    const id = step.split(':')[1];
    await pc.click(`.ms-card[data-id="${id}"]`);
    await pc.waitForSelector('.briefing', { timeout: 20000 });
    await pc.waitForTimeout(3000);
    await pc.screenshot({ path: `${out}-briefing.png` });
  } else {
    await pc.mouse.move(800, 300);
    await pc.waitForTimeout(500);
    await pc.screenshot({ path: `${out}-select-overview.png` });
    await pc.hover('.ms-card[data-id="jupiter"]');
    await pc.waitForTimeout(2600);
    await pc.screenshot({ path: `${out}-select-jupiter.png` });
    await pc.hover('.ms-card[data-id="mars"]');
    await pc.waitForTimeout(2600);
    await pc.screenshot({ path: `${out}-select-mars.png` });
  }
}
console.log(errs.length ? errs.join('\n') : 'no errors');
await browser.close();
