// Bakes a global cloud-cover texture (equirectangular, grayscale) from domain-warped 3D noise on the sphere.
// Baked (not computed per pixel at runtime) so the GPU's mipmaps keep the clouds alias-free to the horizon.
// Usage: node scripts/bake-clouds.mjs [width]   → public/textures/earth_clouds.jpg
import sharp from 'sharp';

const W = Number(process.argv[2] ?? 4096), H = W / 2;
const perm = new Uint8Array(512);
{ let s = 1337; const p = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
const grad = (h, x, y, z) => { const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z; return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function noise(x, y, z) { // Perlin improved noise, -1..1
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z, B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  const l = (a, b, t) => a + t * (b - a);
  return l(l(l(grad(perm[AA] & 15, x, y, z), grad(perm[BA] & 15, x - 1, y, z), u), l(grad(perm[AB] & 15, x, y - 1, z), grad(perm[BB] & 15, x - 1, y - 1, z), u), v),
    l(l(grad(perm[AA + 1] & 15, x, y, z - 1), grad(perm[BA + 1] & 15, x - 1, y, z - 1), u), l(grad(perm[AB + 1] & 15, x, y - 1, z - 1), grad(perm[BB + 1] & 15, x - 1, y - 1, z - 1), u), v), w);
}
const fbm = (x, y, z, oct) => { let a = 0.5, s = 0, f = 1; for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f, z * f); f *= 2.03; a *= 0.5; } return s; };
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

const out = Buffer.alloc(W * H);
const t0 = Date.now();
for (let j = 0; j < H; j++) {
  const lat = 90 - ((j + 0.5) / H) * 180, th = ((90 - lat) / 180) * Math.PI;
  const st = Math.sin(th), ct = Math.cos(th);
  const alat = Math.abs(lat);
  // climatology: cloudy ITCZ near the equator, drier subtropics (~20–30°), stormy mid-latitudes
  const cover = -0.04 + 0.07 * smooth(12, 24, alat) - 0.07 * smooth(28, 32, alat) * 0 - 0.04 * smooth(38, 55, alat) - 0.05 * (1 - smooth(0, 10, alat));
  for (let i = 0; i < W; i++) {
    const phi = ((i + 0.5) / W) * Math.PI * 2; // same mapping as three.js SphereGeometry
    const x = -Math.cos(phi) * st * 3.2, y = ct * 3.2, z = Math.sin(phi) * st * 3.2;
    const wx = fbm(x + 5.2, y + 1.3, z + 7.1, 4), wy = fbm(x + 1.7, y + 9.2, z + 3.4, 4), wz = fbm(x + 8.3, y + 2.8, z + 4.6, 4);
    let c = fbm(x * 1.6 + wx * 1.2, y * 1.6 + wy * 1.2, z * 1.6 + wz * 1.2, 8);
    // weather systems: large regions that are mostly clear or mostly overcast
    c += 0.22 * fbm(x * 0.45 + 3.3, y * 0.45 + 1.1, z * 0.45 + 7.7, 3);
    // streaky mid-latitude bands
    c += 0.08 * Math.sin(y * 6 + wx * 3) * smooth(30, 60, alat);
    const d = smooth(cover - 0.05, cover + 0.3, c);
    out[j * W + i] = Math.round(Math.pow(d, 0.9) * 255);
  }
  if (j % 128 === 0) process.stdout.write(`\r${Math.round((j / H) * 100)}%`);
}
await sharp(out, { raw: { width: W, height: H, channels: 1 } }).jpeg({ quality: 88, mozjpeg: true }).toFile('public/textures/earth_clouds.jpg');
console.log(`\rbaked ${W}x${H} in ${((Date.now() - t0) / 1000).toFixed(1)} s → public/textures/earth_clouds.jpg`);
