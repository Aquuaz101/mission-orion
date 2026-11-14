// Top-down slope map of the Mars level with POIs + straight-line legs. Usage: node scripts/debug-route.mjs <out.png>
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
const out = process.argv[2];
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'] });
const pc = await browser.newPage({ viewport: { width: 1280, height: 720 } });
pc.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await pc.goto('http://localhost:5173');
await pc.waitForSelector('.intro', { timeout: 60000 });
await pc.click('.intro'); await pc.waitForTimeout(150); await pc.keyboard.press('Escape'); await pc.waitForTimeout(1200);
await pc.click('.cod-item[data-a="start"]'); await pc.waitForTimeout(500);
await pc.click('.choice[data-m="device"]'); await pc.waitForSelector('.ms'); await pc.waitForTimeout(600);
await pc.click('.ms-card[data-id="mars"]'); await pc.waitForSelector('.briefing', { timeout: 20000 }); await pc.waitForTimeout(500);
await pc.keyboard.press('Enter');
await pc.waitForFunction(() => window.orion.mission?.stage, null, { timeout: 30000 });
await pc.waitForTimeout(500);
const res = await pc.evaluate(() => {
  const m = window.orion.mission, st = m.stage, t = st.terrain;
  const n = t.n, S = 720;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, gi = Math.round(y / (S - 1) * (n - 1)) * n + Math.round(x / (S - 1) * (n - 1));
    const s = t.slopes[gi];
    const steep = s > 28;
    const shade = 60 + Math.min(1, t.heights[gi] / 130) * 150;
    img.data[i * 4] = steep ? 230 : shade; img.data[i * 4 + 1] = steep ? 40 : shade * 0.8; img.data[i * 4 + 2] = steep ? 40 : shade * 0.6; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const toPx = (p) => [(p.x / t.size + 0.5) * S, (p.z / t.size + 0.5) * S];
  const order = ['start', 's1', 's2', 'ares', 'zone', 's3'];
  const legs = [];
  g.lineWidth = 2;
  for (let k = 0; k < order.length; k++) {
    const p = m.pois.get(order[k]).pos;
    const [x, y] = toPx(p);
    g.fillStyle = '#4fd8ff'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = '14px monospace'; g.fillText(order[k], x + 8, y - 8);
    if (k > 0) {
      const a = m.pois.get(order[k - 1]).pos;
      const [ax, ay] = toPx(a);
      g.strokeStyle = '#ffd36a'; g.beginPath(); g.moveTo(ax, ay); g.lineTo(x, y); g.stroke();
      let maxClimb = 0; const L = Math.hypot(p.x - a.x, p.z - a.z);
      for (let d = 0; d < L; d += 1) {
        const f = d / L, x1 = a.x + (p.x - a.x) * f, z1 = a.z + (p.z - a.z) * f;
        const f2 = Math.min(1, (d + 1.8) / L), x2 = a.x + (p.x - a.x) * f2, z2 = a.z + (p.z - a.z) * f2;
        maxClimb = Math.max(maxClimb, Math.atan2(t.heightAt(x2, z2) - t.heightAt(x1, z1), 1.8) * 57.3);
      }
      legs.push(`${order[k - 1]}→${order[k]}: ${L.toFixed(0)} m, max climb ${maxClimb.toFixed(0)}°`);
    }
  }
  return { url: c.toDataURL('image/png'), legs, relief: t.heights.reduce((a, b) => Math.max(a, b), 0).toFixed(0) };
});
await writeFile(out, Buffer.from(res.url.split(',')[1], 'base64'));
console.log('relief (exaggerated) m:', res.relief);
console.log(res.legs.join('\n'));
await browser.close();
