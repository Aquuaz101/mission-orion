// Extracts the Mars mission terrain from real NASA/USGS data (build-time only).
//
// Source: USGS Astrogeology controlled HiRISE DTM DTEEC_048842_1985_048908_1985_U01
//         (Jezero crater delta front, ~1 m/px) + HiRISE ortho image ESP_048842_1985_RED.
//         Reads only the needed window from the cloud-optimized GeoTIFFs on S3.
// Output: public/data/jezero_height.bin (Uint16 LE, normalised), jezero_ortho.jpg, jezero.json
import { fromUrl } from 'geotiff';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'https://astrogeo-ard.s3-us-west-2.amazonaws.com/mars/mro/hirise/controlled/dtm/ESP_048842_1985_ESP_048908_1985/';
const DTM_URL = BASE + 'DTEEC_048842_1985_048908_1985_U01.tif';
const ORTHO_URL = BASE + 'ESP_048842_1985_RED_A_01_ORTHO.tif';

// Window in full-res DTM pixels (chosen with scripts/preview-dtm.mjs): delta-front mesas + channels.
// v2 (compact cinematic map): 720 m window at native ~1 m resolution.
const PX0 = Number(process.env.PX0 ?? 1650), PY0 = Number(process.env.PY0 ?? 520), SIZE_PX = Number(process.env.SIZE ?? 720);
const OUT = Number(process.env.OUT ?? 720);   // heightmap resolution (≈1 m / sample)
const ORTHO_OUT = 2048;                         // HiRISE image (≈0.36 m / px) for albedo + minimap

await mkdir('public/data', { recursive: true });

const dtm = await fromUrl(DTM_URL);
const img0 = await dtm.getImage(0);
const [ox, oy] = img0.getOrigin();
const [rx] = img0.getResolution();
const bbox = [ox + PX0 * rx, oy - (PY0 + SIZE_PX) * rx, ox + (PX0 + SIZE_PX) * rx, oy - PY0 * rx];
const sizeMeters = SIZE_PX * rx;
console.log('bbox (m, IAU_2015:49910):', bbox.map((v) => v.toFixed(1)).join(', '), `size ${sizeMeters.toFixed(1)} m`);

const nodata = img0.getGDALNoData();
const [h] = await dtm.readRasters({ bbox, width: OUT, height: OUT, resampleMethod: 'bilinear' });
let min = Infinity, max = -Infinity, invalid = 0;
const valid = (v) => Number.isFinite(v) && v > -1e30 && v !== nodata;
for (const v of h) {
  if (!valid(v)) { invalid++; continue; }
  if (v < min) min = v;
  if (v > max) max = v;
}
// Fill any nodata with the nearest valid value along the row (edge of the HiRISE strip).
for (let y = 0; y < OUT; y++) {
  let last = min;
  for (let x = 0; x < OUT; x++) { const i = y * OUT + x; if (valid(h[i])) last = h[i]; else h[i] = last; }
}
console.log(`elevation ${min.toFixed(1)} .. ${max.toFixed(1)} m (relief ${(max - min).toFixed(1)} m), filled ${invalid} nodata samples`);

const q = new Uint16Array(OUT * OUT);
for (let i = 0; i < q.length; i++) q[i] = Math.round(((h[i] - min) / (max - min)) * 65535);
await writeFile('public/data/jezero_height.bin', Buffer.from(q.buffer));

// Hillshade preview for checking the crop (not shipped).
const shade = Buffer.alloc(OUT * OUT);
const cell = sizeMeters / OUT;
for (let y = 1; y < OUT - 1; y++) for (let x = 1; x < OUT - 1; x++) {
  const dzdx = (h[y * OUT + x + 1] - h[y * OUT + x - 1]) / (2 * cell);
  const dzdy = (h[(y + 1) * OUT + x] - h[(y - 1) * OUT + x]) / (2 * cell);
  const nx = -dzdx, ny = -dzdy, nz = 1, len = Math.hypot(nx, ny, nz);
  shade[y * OUT + x] = Math.max(0, Math.min(255, 255 * ((nx * -0.6 + ny * 0.6 + nz * 0.55) / len)));
}
await sharp(shade, { raw: { width: OUT, height: OUT, channels: 1 } }).png().toFile('data-raw/jezero_hillshade_preview.png');

// Ortho image: same bbox (georeferenced), auto-contrast to 8-bit.
let orthoOk = false;
try {
  const ortho = await fromUrl(ORTHO_URL);
  const [o] = await ortho.readRasters({ bbox, width: ORTHO_OUT, height: ORTHO_OUT, resampleMethod: 'bilinear' });
  const vals = Array.from(o).filter((v) => v > 0).sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.01)] ?? 0, hi = vals[Math.floor(vals.length * 0.99)] ?? 1;
  const g = Buffer.alloc(ORTHO_OUT * ORTHO_OUT);
  for (let i = 0; i < g.length; i++) g[i] = o[i] > 0 ? Math.max(0, Math.min(255, ((o[i] - lo) / (hi - lo)) * 255)) : 128;
  await sharp(g, { raw: { width: ORTHO_OUT, height: ORTHO_OUT, channels: 1 } }).jpeg({ quality: 88 }).toFile('public/data/jezero_ortho.jpg');
  orthoOk = true;
} catch (e) {
  console.warn('ortho extraction failed:', e.message);
}

await writeFile('public/data/jezero.json', JSON.stringify({
  source: 'USGS Astrogeology / NASA MRO HiRISE controlled DTM DTEEC_048842_1985_048908_1985_U01 (Jezero crater delta front)',
  credit: 'NASA/JPL-Caltech/University of Arizona/USGS',
  resolution: OUT,
  sizeMeters,
  minElevation: min,
  maxElevation: max,
  ortho: orthoOk,
}, null, 2));
console.log('done');
