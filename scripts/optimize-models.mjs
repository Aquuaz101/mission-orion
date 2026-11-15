// Playability pass on the heavy models. Usage:
//   node scripts/optimize-models.mjs in.glb out.glb <ratio> [maxError]          weld + error-bounded simplify (arms, suit)
//   node scripts/optimize-models.mjs in.glb out.glb <ratio> [maxError] --sloppy  far LOD: seams may move (ISS beyond ~22 m)
// Output is quantised + meshopt-compressed.
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dequantize, weld, simplify, quantize, reorder, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sloppy = process.argv.includes('--sloppy');
const [inp, out, ratioArg, errArg] = args;
const ratio = Number(ratioArg ?? 0.4), error = Number(errArg ?? 0.001);
await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(inp);
const prims = () => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
const count = () => prims().reduce((s, p) => s + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
const before = count();
await doc.transform(dequantize(), weld());
if (sloppy) {
  // per primitive: sloppy simplification (collapses across CAD hard edges), then drop unused vertices
  for (const p of prims()) {
    const idx = p.getIndices(), pos = p.getAttribute('POSITION');
    if (!idx || !pos || idx.getCount() < 300) continue;
    const target = Math.max(36, Math.floor((idx.getCount() * ratio) / 3) * 3);
    // flat panels (solar arrays, corrugated radiators: thinnest extent < 15 % of the longest) keep exact geometry: their large
    // textured faces smear visibly if a UV seam moves, even at distance
    const P = pos.getArray(), n = pos.getCount(), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { const v = P[i * 3 + c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
    const ext = [0, 1, 2].map((c) => hi[c] - lo[c]).sort((a, b) => a - b);
    if (ext[0] < ext[2] * 0.15) continue;
    const [out32] = MeshoptSimplifier.simplifySloppy(new Uint32Array(idx.getArray()), new Float32Array(P), 3, null, target, error);
    if (out32.length >= 36) idx.setArray(out32.length < 65536 && pos.getCount() < 65536 ? new Uint16Array(out32) : out32);
  }
  await doc.transform(prune({ keepAttributes: true }));
} else {
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }));
}
// materials are matched by name in the game (Blender placeholders export identical): never merge them
await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }), prune());
const after = count();
// UVs stay full precision: the arrays' cell texture tiles finely and flattens at 12 bits
await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize({ pattern: /^(POSITION|NORMAL)$/, quantizePosition: 14, quantizeNormal: 10 }));
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(out, doc);
console.log(`${inp.split(/[\\/]/).pop()} → ${out.split(/[\\/]/).pop()}: ${Math.round(before).toLocaleString()} → ${Math.round(after).toLocaleString()} triangles (${((after / before) * 100).toFixed(0)}%)`);
