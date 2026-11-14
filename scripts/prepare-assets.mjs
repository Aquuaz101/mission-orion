// Converts downloaded NASA source files (data-raw/) into game-ready assets (public/).
// Build-time only. Run: node scripts/prepare-assets.mjs
import sharp from 'sharp';
import { mkdir, copyFile } from 'node:fs/promises';

const R = 'data-raw/', N = 'data-raw/nasa3d/';
await mkdir('public/textures', { recursive: true });
await mkdir('public/models', { recursive: true });

const jobs = [
  // [source, output, width, height, options]
  [R + 'PIA07782.tif', 'jupiter.jpg', 4096, 2048, { quality: 90 }],
  [N + 'Jupiter - Europa.jpg', 'europa.jpg', 2048, 1024, {}],
  [N + 'Jupiter - Io (A).jpg', 'io.jpg', 2048, 1024, {}],
  [N + 'Jupiter - Ganymede.jpg', 'ganymede.jpg', 2048, 1024, {}],
  [N + 'Jupiter - Callisto.jpg', 'callisto.jpg', 2048, 1024, {}],
  [R + 'Land_ocean_ice_2048.jpg', 'earth_day.jpg', 2048, 1024, {}],
  [R + 'The_earth_at_night.jpg', 'earth_night.jpg', 4096, 2048, {}],
  [N + 'Mars.jpg', 'mars.jpg', 2048, 1024, {}],
  [N + 'Tycho Star Map.jpg', 'stars.jpg', 4096, 2048, { quality: 92 }],
];

for (const [src, out, w, h, o] of jobs) {
  const meta = await sharp(src, { limitInputPixels: false }).metadata();
  await sharp(src, { limitInputPixels: false })
    .resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
    .toColourspace('srgb')
    .jpeg({ quality: o.quality ?? 86, mozjpeg: true })
    .toFile('public/textures/' + out);
  console.log(`${out.padEnd(16)} <- ${meta.width}x${meta.height} ${meta.format}`);
}

await copyFile(N + 'Mars 2020 Perseverance Rover.glb', 'public/models/perseverance.glb');
await copyFile(N + 'Hubble Space Telescope (A).glb', 'public/models/hubble.glb'); // (B) renders as scattered parts
await copyFile(N + 'International Space Station (ISS) (B).glb', 'public/models/iss.glb');
console.log('models copied');
