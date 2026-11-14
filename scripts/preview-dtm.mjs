// Hillshade preview of a window of the Jezero HiRISE DTM with a pixel grid, for choosing crops/routes.
// Usage: node scripts/preview-dtm.mjs <x0> <y0> <w> <h> <outW> <out.png> [exag]
import { fromUrl } from 'geotiff';
import sharp from 'sharp';
const [x0, y0, w, h, outW, out, exagArg] = process.argv.slice(2);
const X0 = +x0, Y0 = +y0, W = +w, H = +h, OW = +outW, OH = Math.round((OW * H) / W), EX = +(exagArg ?? 3);
const URL = 'https://astrogeo-ard.s3-us-west-2.amazonaws.com/mars/mro/hirise/controlled/dtm/ESP_048842_1985_ESP_048908_1985/DTEEC_048842_1985_048908_1985_U01.tif';
const tiff = await fromUrl(URL);
const img = await tiff.getImage(0);
const [ox, oy] = img.getOrigin();
const [rx] = img.getResolution();
const bbox = [ox + X0 * rx, oy - (Y0 + H) * rx, ox + (X0 + W) * rx, oy - Y0 * rx];
const [d] = await tiff.readRasters({ bbox, width: OW, height: OH, resampleMethod: 'bilinear' });
const cell = (W * rx) / OW;
let mn = Infinity, mx = -Infinity;
for (const v of d) if (v > -1e30) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
const buf = Buffer.alloc(OW * OH * 3);
for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
  const i = y * OW + x;
  const g = (xx, yy) => d[Math.min(OH - 1, Math.max(0, yy)) * OW + Math.min(OW - 1, Math.max(0, xx))];
  const dzdx = ((g(x + 1, y) - g(x - 1, y)) / (2 * cell)) * EX, dzdy = ((g(x, y + 1) - g(x, y - 1)) / (2 * cell)) * EX;
  const n = [-dzdx, -dzdy, 1], len = Math.hypot(...n);
  let s = (n[0] * -0.6 + n[1] * 0.6 + n[2] * 0.55) / len;
  const e = (d[i] - mn) / (mx - mn);
  const v = Math.max(0, Math.min(1, s));
  buf[i * 3] = Math.round(255 * v * (0.6 + 0.4 * e)); buf[i * 3 + 1] = Math.round(220 * v * (0.5 + 0.5 * e)); buf[i * 3 + 2] = Math.round(190 * v * (0.4 + 0.6 * e));
  const fx = X0 + (x / OW) * W, fy = Y0 + (y / OH) * H;
  if (Math.abs((fx % 100)) < W / OW || Math.abs((fy % 100)) < H / OH) { buf[i * 3] = 60; buf[i * 3 + 1] = 160; buf[i * 3 + 2] = 255; }
}
await sharp(buf, { raw: { width: OW, height: OH, channels: 3 } }).png().toFile(out);
console.log(`elev ${mn.toFixed(1)}..${mx.toFixed(1)} relief ${(mx - mn).toFixed(1)} m; cell ${cell.toFixed(2)} m; grid lines every 100 full-res px`);
