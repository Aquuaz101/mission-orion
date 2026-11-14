import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Bake a static model into one mesh per material (optionally per material per spatial cell), in the root's space.
 * Turns hundreds of draw calls into a few dozen. `cell` (metres, root space) keeps clusters small enough that
 * frustum culling and nearby-only shadow casting still work; 0 merges each material into a single mesh.
 * Hidden nodes are skipped. Geometry is de-quantised to float (meshopt packs it as normalised ints).
 * The source is not modified; materials are shared unless `material` returns new ones.
 */
export function mergeStatic(root: THREE.Object3D, cell = 0, material: (m: THREE.Material) => THREE.Material = (m) => m) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const shown = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p && p !== root.parent; p = p.parent) if (!p.visible) return false; return true; };
  const groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
  const c = new THREE.Vector3(), m = new THREE.Matrix4();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || !shown(mesh)) return;
    const src = mesh.geometry, n = src.attributes.position.count, g = new THREE.BufferGeometry();
    const f32 = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined, size: number) => {
      const out = new Float32Array(n * size);
      if (a) for (let i = 0; i < n; i++) { out[i * size] = a.getX(i); if (size > 1) out[i * size + 1] = a.getY(i); if (size > 2) out[i * size + 2] = a.getZ(i); }
      return new THREE.BufferAttribute(out, size);
    };
    g.setAttribute('position', f32(src.attributes.position, 3));
    g.setAttribute('normal', f32(src.attributes.normal, 3));
    g.setAttribute('uv', f32(src.attributes.uv, 2));
    g.setIndex(new THREE.BufferAttribute(src.index ? Uint32Array.from(src.index.array as ArrayLike<number>) : Uint32Array.from({ length: n }, (_, i) => i), 1));
    if (!src.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld));
    let key = mesh.material.uuid;
    if (cell > 0) {
      g.computeBoundingSphere();
      c.copy(g.boundingSphere!.center).divideScalar(cell).floor();
      key += `|${c.x},${c.y},${c.z}`;
    }
    const e = groups.get(key) ?? { mat: mesh.material, geos: [] };
    e.geos.push(g);
    groups.set(key, e);
  });
  const out = new THREE.Group();
  const mats = new Map<THREE.Material, THREE.Material>();
  for (const { mat, geos } of groups.values()) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    if (!mats.has(mat)) mats.set(mat, material(mat));
    out.add(new THREE.Mesh(merged, mats.get(mat)!));
  }
  return out;
}
