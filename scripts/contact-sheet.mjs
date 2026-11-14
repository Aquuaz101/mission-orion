// Builds a labelled contact sheet of images in a folder (for reviewing candidates).
// Usage: node scripts/contact-sheet.mjs <dir> <out.png>
import sharp from 'sharp';
import { readdir } from 'node:fs/promises';
const [dir, out] = process.argv.slice(2);
const files = (await readdir(dir)).filter((f) => /\.jpe?g$/i.test(f)).sort();
const W = 320, H = 240, cols = 4;
const tiles = await Promise.all(files.map(async (f, i) => {
  const img = await sharp(`${dir}/${f}`).resize(W, H - 22, { fit: 'contain', background: '#111' }).toBuffer();
  const label = Buffer.from(`<svg width="${W}" height="22"><rect width="100%" height="100%" fill="#000"/><text x="6" y="16" font-size="13" fill="#fff" font-family="monospace">${f}</text></svg>`);
  return [{ input: img, left: (i % cols) * W, top: Math.floor(i / cols) * H }, { input: label, left: (i % cols) * W, top: Math.floor(i / cols) * H + H - 22 }];
}));
const rows = Math.ceil(files.length / cols);
await sharp({ create: { width: W * cols, height: H * rows, channels: 3, background: '#222' } }).composite(tiles.flat()).png().toFile(out);
console.log(out);
