// Render ISS layout blueprints via debug/iss.html. Usage: node scripts/iss-views.mjs outDir "<hash>" name [more "<hash>" name ...]
import { chromium } from 'playwright-core';
const [out, ...pairs] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'] });
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
for (let i = 0; i < pairs.length; i += 2) {
  await p.goto('http://localhost:5173/debug/iss.html#' + pairs[i]);
  await p.reload();
  await p.waitForFunction(() => window.done, null, { timeout: 120000 });
  await p.screenshot({ path: `${out}/${pairs[i + 1]}.png` });
}
await b.close();
