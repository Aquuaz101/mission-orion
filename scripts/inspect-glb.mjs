// Prints the node tree, mesh bounds and materials of a GLB (no dependencies).
import { readFile } from 'node:fs/promises';

const buf = await readFile(process.argv[2]);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
console.log('asset:', gltf.asset, '| nodes', gltf.nodes?.length, '| meshes', gltf.meshes?.length,
  '| materials', gltf.materials?.length, '| textures', gltf.textures?.length, '| images', gltf.images?.length, '| anims', gltf.animations?.length ?? 0);
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
let tris = 0;
for (const m of gltf.meshes ?? []) for (const p of m.primitives) {
  const acc = gltf.accessors[p.attributes.POSITION];
  if (acc.min) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], acc.min[i]); max[i] = Math.max(max[i], acc.max[i]); }
  tris += p.indices !== undefined ? gltf.accessors[p.indices].count / 3 : acc.count / 3;
}
console.log('raw mesh bounds min', min.map((v) => v.toFixed(3)), 'max', max.map((v) => v.toFixed(3)), '| triangles', Math.round(tris));
const depth = Number(process.argv[3] ?? 4);
const walk = (i, d) => {
  const n = gltf.nodes[i];
  if (d > depth) return;
  const t = [n.translation && 'T' + n.translation.map((v) => v.toFixed(2)), n.rotation && 'R', n.scale && 'S' + n.scale.map((v) => v.toFixed(3)), n.matrix && 'M'].filter(Boolean).join(' ');
  console.log('  '.repeat(d) + `- ${n.name ?? '(node ' + i + ')'}${n.mesh !== undefined ? ' [mesh]' : ''} ${t}`);
  for (const c of n.children ?? []) walk(c, d + 1);
};
for (const r of gltf.scenes[gltf.scene ?? 0].nodes) walk(r, 0);
console.log('materials:', (gltf.materials ?? []).map((m) => m.name).join(', '));
