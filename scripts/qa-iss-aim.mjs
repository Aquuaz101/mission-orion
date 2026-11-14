// Mission 03 mouse aim: cursor hidden, the helmet camera follows the mouse directly, full range at the screen edges.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5173'); await p.waitForSelector('.intro', { timeout: 60000 });
await p.click('.intro'); await p.waitForTimeout(150); await p.keyboard.press('Escape');
await p.click('.cod-item[data-a="start"]'); await p.click('.choice[data-m="device"]'); await p.waitForSelector('.ms'); await p.waitForTimeout(500);
await p.click('.ms-card[data-id="iss"]'); await p.waitForSelector('.briefing', { timeout: 30000 }); await p.waitForTimeout(500);
await p.keyboard.press('Enter');
await p.waitForSelector('.ihud', { timeout: 120000 });
await p.waitForTimeout(1500);
const look = () => p.evaluate(() => { const s = window.orion.mission.stage; return [s.lookYaw.toFixed(2), s.lookPitch.toFixed(2)].join(','); });
console.log('cursor:', await p.evaluate(() => getComputedStyle(document.querySelector('canvas')).cursor), '| body.iss-aim', await p.evaluate(() => document.body.classList.contains('iss-aim')));
for (const [x, y, name] of [[800, 450, 'centre'], [1599, 450, 'right edge'], [0, 450, 'left edge'], [800, 0, 'top'], [800, 899, 'bottom'], [1200, 300, 'upper right']]) {
  await p.mouse.move(x, y, { steps: 8 }); await p.waitForTimeout(900);
  console.log(name.padEnd(12), 'yaw,pitch =', await look());
}
await p.keyboard.press('Escape'); await p.waitForTimeout(500);
console.log('paused → cursor:', await p.evaluate(() => getComputedStyle(document.body).cursor), '| iss-aim', await p.evaluate(() => document.body.classList.contains('iss-aim')));
await p.keyboard.press('Escape'); await p.waitForTimeout(500);
console.log('resumed → iss-aim', await p.evaluate(() => document.body.classList.contains('iss-aim')));
// first decision by number key
await p.waitForSelector('.ihud .choices.in', { timeout: 60000 });
await p.screenshot({ path: 'qa-shots/iss-aim-choice.jpg', type: 'jpeg', quality: 80 });
await p.keyboard.press('Digit1');
await p.waitForTimeout(1200);
console.log('Digit1 picked the tether:', await p.evaluate(() => document.querySelector('.st-tether b')?.textContent));
console.log(errs.length ? errs.join('\n') : 'no errors');
await b.close();
