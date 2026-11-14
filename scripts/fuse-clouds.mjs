// Fuse NASA's real MODIS cloud map (Blue Marble 2002, cloud_combined_2048.jpg, 29 Jul 2001) with fine fractal
// detail so the real weather pattern stays crisp from 420 km. Usage: node scripts/fuse-clouds.mjs <cloud_combined_2048.jpg>
import sharp from 'sharp';

const src = process.argv[2];
const W = 4096, H = 2048;
const real = await sharp(src).greyscale().resize(W, H, { kernel: 'lanczos3' }).raw().toBuffer();

const perm = new Uint8Array(512);
{ let s = 4242; const p = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
const grad = (h, x, y, z) => { const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z; return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + t * (b - a);
function noise(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z, B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  return lerp(lerp(lerp(grad(perm[AA] & 15, x, y, z), grad(perm[BA] & 15, x - 1, y, z), u), lerp(grad(perm[AB] & 15, x, y - 1, z), grad(perm[BB] & 15, x - 1, y - 1, z), u), v),
    lerp(lerp(grad(perm[AA + 1] & 15, x, y, z - 1), grad(perm[BA + 1] & 15, x - 1, y, z - 1), u), lerp(grad(perm[AB + 1] & 15, x, y - 1, z - 1), grad(perm[BB + 1] & 15, x - 1, y - 1, z - 1), u), v), w);
}
const out = Buffer.alloc(W * H);
for (let j = 0; j < H; j++) {
  const th = ((j + 0.5) / H) * Math.PI, st = Math.sin(th), ct = Math.cos(th);
  for (let i = 0; i < W; i++) {
    const phi = ((i + 0.5) / W) * Math.PI * 2;
    const x = -Math.cos(phi) * st * 60, y = ct * 60, z = Math.sin(phi) * st * 60;
    // 3 octaves of small-scale billow (≈ 15–60 km), only where real cloud exists
    const d = 0.5 * Math.abs(noise(x, y, z)) + 0.3 * Math.abs(noise(x * 2.1, y * 2.1, z * 2.1)) + 0.2 * Math.abs(noise(x * 4.3, y * 4.3, z * 4.3));
    const c = real[j * W + i] / 255;
    // lift out the map's grey haze floor, steepen edges, then break them up with the detail
    const base = Math.min(1, Math.max(0, (c - 0.1) / 0.75));
    const v = Math.min(1, Math.max(0, base * (0.72 + 0.75 * d) - 0.04 * (1 - base)));
    out[j * W + i] = Math.round(Math.pow(v, 0.95) * 255);
  }
}
await sharp(out, { raw: { width: W, height: H, channels: 1 } }).jpeg({ quality: 88, mozjpeg: true }).toFile('public/textures/earth_clouds.jpg');
console.log('fused → public/textures/earth_clouds.jpg');
