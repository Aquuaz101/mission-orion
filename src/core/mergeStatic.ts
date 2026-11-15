import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Float position/normal/uv copy of a mesh's geometry (meshopt packs as normalised ints), transformed by `m`. */
function bakeGeometry(src: THREE.BufferGeometry, m: THREE.Matrix4) {
  const n = src.attributes.position.count, g = new THREE.BufferGeometry();
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
  g.applyMatrix4(m);
  return g;
}

function meshesOf(root: THREE.Object3D) {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !Array.isArray((o as THREE.Mesh).material)) out.push(o as THREE.Mesh); });
  return out;
}

const shownIn = (root: THREE.Object3D) => (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p && p !== root.parent; p = p.parent) if (!p.visible) return false; return true; };

/** One distance-switched cluster: full detail `near`, simplified `far` (same parts, same material). */
export interface LodCluster { center: THREE.Vector3; radius: number; near: THREE.Mesh; far: THREE.Mesh | null }

/**
 * Bake a static model into one mesh per material (optionally per material per spatial cell), in the root's space.
 * Turns hundreds of draw calls into a few dozen. `cell` (root units) keeps clusters small enough that culling,
 * nearby-only shadow casting and LOD switching work per cluster; 0 merges each material into one mesh.
 * `farRoot` (optional) is the same model simplified, node for node: each cluster then gets a far version.
 * Hidden nodes are skipped. The sources are not modified; materials are shared unless `material` maps them.
 */
export function mergeStatic(root: THREE.Object3D, cell = 0, material: (m: THREE.Material) => THREE.Material = (m) => m, farRoot?: THREE.Object3D | null) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const near = meshesOf(root);
  let far: THREE.Mesh[] | null = null;
  if (farRoot) {
    farRoot.scale.copy(root.scale);
    farRoot.updateMatrixWorld(true);
    const f = meshesOf(farRoot);
    far = f.length === near.length ? f : null; // pairing is by traversal order; mismatched files fall back to no LOD
  }
  const invFar = farRoot ? new THREE.Matrix4().copy(farRoot.matrixWorld).invert() : inv;
  const shown = shownIn(root);
  const groups = new Map<string, { mat: THREE.Material; near: THREE.BufferGeometry[]; far: THREE.BufferGeometry[] }>();
  const c = new THREE.Vector3(), m = new THREE.Matrix4();
  near.forEach((mesh, i) => {
    if (!shown(mesh)) return;
    const g = bakeGeometry(mesh.geometry, m.multiplyMatrices(inv, mesh.matrixWorld));
    let key = (mesh.material as THREE.Material).uuid;
    if (cell > 0) {
      g.computeBoundingSphere();
      c.copy(g.boundingSphere!.center).divideScalar(cell).floor();
      key += `|${c.x},${c.y},${c.z}`;
    }
    const e = groups.get(key) ?? { mat: mesh.material as THREE.Material, near: [], far: [] };
    e.near.push(g);
    if (far) {
      // parts the simplifier left alone (flat panels: arrays, radiators) reuse the HD geometry: identical look, no pop
      const fg = far[i].geometry, triCount = (gg: THREE.BufferGeometry) => (gg.index ? gg.index.count : gg.attributes.position.count);
      e.far.push(triCount(fg) >= triCount(mesh.geometry) ? g.clone() : bakeGeometry(fg, m.multiplyMatrices(invFar, far[i].matrixWorld)));
    }
    groups.set(key, e);
  });
  const out = new THREE.Group();
  const clusters: LodCluster[] = [];
  const mats = new Map<THREE.Material, THREE.Material>();
  const merge = (geos: THREE.BufferGeometry[]) => { const r = geos.length ? mergeGeometries(geos, false) : null; geos.forEach((g) => g.dispose()); return r; };
  for (const e of groups.values()) {
    const ng = merge(e.near);
    if (!ng) continue;
    ng.computeBoundingSphere();
    if (!mats.has(e.mat)) mats.set(e.mat, material(e.mat));
    const nm = new THREE.Mesh(ng, mats.get(e.mat)!);
    out.add(nm);
    const fg = merge(e.far);
    let fm: THREE.Mesh | null = null;
    if (fg) { fg.computeBoundingSphere(); fm = new THREE.Mesh(fg, nm.material); fm.visible = false; out.add(fm); }
    clusters.push({ center: ng.boundingSphere!.center.clone(), radius: ng.boundingSphere!.radius, near: nm, far: fm });
  }
  out.userData.clusters = clusters;
  return out;
}

/**
 * Show each cluster's full-detail mesh when the camera is within `nearDist` of the cluster's surface, else its far
 * version. Centres are in the baked group's local space; `local` is the camera position in that space.
 */
export function updateLod(group: THREE.Object3D, local: THREE.Vector3, nearDist: number) {
  for (const cl of group.userData.clusters as LodCluster[]) {
    if (!cl.far) continue;
    const isNear = cl.center.distanceTo(local) - cl.radius < nearDist;
    cl.near.visible = isNear;
    cl.far.visible = !isNear;
  }
}

/**
 * Merge rigid meshes that share a parent and a material (e.g. all chrome parts riding on one bone of a suit) into
 * one mesh in that parent's space. Skinned meshes are left alone. Cuts draw calls without changing how anything moves.
 */
export function mergeSiblings(root: THREE.Object3D) {
  const groups = new Map<string, { parent: THREE.Object3D; mat: THREE.Material; meshes: THREE.Mesh[] }>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(mesh.material) || !mesh.parent) return;
    const key = mesh.parent.uuid + '|' + mesh.material.uuid;
    const e = groups.get(key) ?? { parent: mesh.parent, mat: mesh.material, meshes: [] };
    e.meshes.push(mesh);
    groups.set(key, e);
  });
  for (const { parent, mat, meshes } of groups.values()) {
    if (meshes.length < 2) continue;
    const m = new THREE.Matrix4();
    const geos = meshes.map((mesh) => { mesh.updateMatrix(); return bakeGeometry(mesh.geometry, m.copy(mesh.matrix)); });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const out = new THREE.Mesh(merged, mat);
    out.castShadow = meshes[0].castShadow; out.receiveShadow = meshes[0].receiveShadow; out.frustumCulled = meshes[0].frustumCulled;
    for (const mesh of meshes) mesh.removeFromParent();
    parent.add(out);
  }
}

