// Quick screenshot helper: navigates to a given point in the flow.
// Usage: node scripts/qa-shot.mjs <outFile> <step>   step = menu | select | briefing:<missionId>
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
await pc.waitForTimeout(1500);
if (step !== 'menu') {
  await pc.click('[data-a="start"]'); await pc.waitForTimeout(600);
  await pc.click('.choice[data-m="device"]'); await pc.waitForSelector('.select'); await pc.waitForTimeout(1500);
  if (step.startsWith('briefing:')) {
    await pc.click(`.mission[data-id="${step.split(':')[1]}"]`);
    await pc.waitForSelector('.briefing', { timeout: 15000 });
    await pc.waitForTimeout(3000);
  }
}
await pc.screenshot({ path: out });
console.log(errs.length ? errs.join('\n') : 'no errors');
await browser.close();
