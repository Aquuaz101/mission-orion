// Probe a remote Cloud-Optimized GeoTIFF: size, data type, georef, and value stats on an overview.
// Usage: node scripts/probe-dtm.mjs <url>
import { fromUrl } from 'geotiff';

const url = process.argv[2];
const tiff = await fromUrl(url);
const count = await tiff.getImageCount();
const img = await tiff.getImage(0);
console.log('images (overviews):', count);
console.log('size:', img.getWidth(), 'x', img.getHeight(), 'bands:', img.getSamplesPerPixel());
console.log('sampleFormat:', img.getSampleFormat?.(), 'bitsPerSample:', img.getBitsPerSample?.());
console.log('resolution:', img.getResolution(), 'origin:', img.getOrigin());
console.log('nodata:', img.getGDALNoData());
const gdalMeta = img.getGDALMetadata?.();
if (gdalMeta) console.log('gdal metadata:', gdalMeta);
const fd = img.getFileDirectory();
console.log('ModelPixelScale:', fd.ModelPixelScale, 'GeoAscii:', String(fd.GeoAsciiParams ?? '').slice(0, 200));

const ov = await tiff.getImage(count - 1);
const [data] = await ov.readRasters();
let min = Infinity, max = -Infinity, zeros = 0, n = 0;
for (const v of data) {
  if (v === 0) { zeros++; continue; }
  if (v < min) min = v;
  if (v > max) max = v;
  n++;
}
console.log(`overview ${ov.getWidth()}x${ov.getHeight()}: valid=${n} zeros=${zeros} min=${min} max=${max}`);
