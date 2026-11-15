/**
 * First-person EMU (spacesuit) arms: the Blender model (scripts/blender/emu_arm.py → public/models/emu_arm.glb) dressed
 * in canvas fabric (weave normal map), rubber grip, anodised and chrome materials made here, plus the cuff checklist
 * (left) and wrist mirror (right).
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

let shared: ReturnType<typeof makeMats> | null = null;

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb: boolean, rep = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.anisotropy = 8;
  return t;
}
const rnd = (s: number) => () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;

/** Normal map from a height function drawn into a canvas (Sobel). */
function normalFrom(height: HTMLCanvasElement, strength = 2.5) {
  const w = height.width, h = height.height;
  const src = height.getContext('2d')!.getImageData(0, 0, w, h).data;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const out = g.createImageData(w, h);
  const H = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    out.data[i] = (-dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Materials for the third-person EMU suit (emu_suit.glb), sharing the gloves' fabric and metal looks. */
export function suitMaterials(): Record<string, THREE.Material> {
  const m = (shared ??= makeMats());
  return {
    suit: m.fabric, grey: m.fabricDark, chrome: m.chrome, ano: m.anoRed, dark: m.black,
    hard: new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.42, metalness: 0.0 }),
    stripe: new THREE.MeshStandardMaterial({ color: 0xb3171b, roughness: 0.7 }),
    visor: new THREE.MeshStandardMaterial({ color: 0xe0a83c, metalness: 1, roughness: 0.07, envMapIntensity: 2.2 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0b0d10, metalness: 0.9, roughness: 0.06 }),
    lens: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 6 }),
  };
}

function makeMats() {
  const r = rnd(11);
  // Ortho-fabric outer layer: fine basket weave, quilting seams, scuffs
  const weaveH = document.createElement('canvas'); weaveH.width = weaveH.height = 256;
  {
    const g = weaveH.getContext('2d')!;
    g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 4) for (let x = 0; x < 256; x += 4) {
      const v = ((x / 4 + y / 4) % 2 ? 150 : 105) + r() * 20;
      g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 4, 2);
      g.fillStyle = `rgb(${255 - v},${255 - v},${255 - v})`; g.fillRect(x, y + 2, 4, 2);
    }
    g.strokeStyle = '#2a2a2a'; g.lineWidth = 3;
    for (const y of [64, 192]) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    g.strokeStyle = '#d0d0d0'; g.lineWidth = 1;
    for (const y of [60, 68, 188, 196]) { g.setLineDash([3, 4]); g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  }
  const fabric = canvas(256, 256, (g) => {
    g.fillStyle = '#ecebe5'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) { const v = 220 + r() * 30; g.fillStyle = `rgba(${v},${v - 2},${v - 8},0.25)`; g.fillRect(r() * 256, r() * 256, 2, 1); }
    g.strokeStyle = 'rgba(120,115,105,0.55)'; g.lineWidth = 2;
    for (const y of [64, 192]) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    g.strokeStyle = 'rgba(150,145,135,0.6)'; g.lineWidth = 1; g.setLineDash([3, 4]);
    for (const y of [60, 68, 188, 196]) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    g.setLineDash([]);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(110,100,85,${r() * 0.06})`; g.beginPath(); g.arc(r() * 256, r() * 256, 4 + r() * 18, 0, 7); g.fill(); }
  }, true, 2);
  const fabricN = normalFrom(weaveH, 3);
  fabricN.repeat.set(2, 2);
  // rubberised palm / fingertip grip
  const gripH = document.createElement('canvas'); gripH.width = gripH.height = 128;
  { const g = gripH.getContext('2d')!; g.fillStyle = '#555'; g.fillRect(0, 0, 128, 128); for (let y = 4; y < 128; y += 9) for (let x = (y % 18 ? 4 : 8); x < 128; x += 9) { g.fillStyle = '#d8d8d8'; g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill(); } }
  const gripN = normalFrom(gripH, 4);
  gripN.repeat.set(3, 3);
  return {
    fabric: new THREE.MeshStandardMaterial({ map: fabric, normalMap: fabricN, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.88, color: 0xffffff }),
    fabricDark: new THREE.MeshStandardMaterial({ map: fabric, normalMap: fabricN, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.9, color: 0xc9c7c0 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.75, normalMap: gripN, normalScale: new THREE.Vector2(0.9, 0.9) }),
    tip: new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.55, normalMap: gripN, normalScale: new THREE.Vector2(0.5, 0.5) }),
    strap: new THREE.MeshStandardMaterial({ color: 0x8d9097, roughness: 0.7 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 1, roughness: 0.18 }),
    anoRed: new THREE.MeshStandardMaterial({ color: 0xb2262a, metalness: 0.75, roughness: 0.3 }),
    anoBlue: new THREE.MeshStandardMaterial({ color: 0x2457b5, metalness: 0.75, roughness: 0.3 }),
    black: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5 }),
    page: new THREE.MeshStandardMaterial({ map: checklistTexture(), roughness: 0.8 }),
    mirror: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.05 }),
  };
}

function checklistTexture() {
  return canvas(256, 192, (g) => {
    g.fillStyle = '#f1efe6'; g.fillRect(0, 0, 256, 192);
    g.fillStyle = '#1b1b1b'; g.font = 'bold 15px monospace'; g.fillText('EVA 1 · P3/P4 BATT R&R', 12, 22);
    g.fillStyle = '#c0392b'; g.fillRect(12, 30, 232, 3);
    g.fillStyle = '#2a2a2a'; g.font = '11px monospace';
    ['1. EGRESS QUEST · TETHER', '2. SSRMS APFR INGRESS', '3. TRANSLATE TO P3 FACE', '4. RPC OPEN (MCC)', '5. DEMATE J1 J2 J3', '6. BOLTS 1-4 RELEASE', '7. SWAP ORU 3B', '8. MATE · VERIFY'].forEach((l, i) => g.fillText(l, 12, 52 + i * 17));
  }, true);
}

export interface EmuHand {
  root: THREE.Group;
  fingers: THREE.Object3D[][];
  thumb: THREE.Object3D[];
  grip: number;
  /** Skinned Blender glove: joints curl about their own X axis from a stored rest pose. */
  skinned?: boolean;
}

/**
 * High-detail EMU arm from scripts/blender/emu_arm.py (public/models/emu_arm.glb): one continuous skinned glove
 * (finger + thumb bones), convolute sleeve with fabric folds, gauntlet, anodised wrist disconnect with chrome bearing,
 * latch pins and bolt heads. The game's textured materials (fabric weave, rubber grip, anodised rings) replace the
 * export's placeholders by name. The model is a right arm; the left is its mirror with a blue disconnect ring.
 */
export function emuArmModel(side: number, gltf: GLTF): EmuHand {
  const m = (shared ??= makeMats());
  const root = new THREE.Group();
  const model = cloneSkinned(gltf.scene);
  if (side < 0) model.scale.x = -1;
  const byName: Record<string, THREE.Material> = { fabric: m.fabric, fabricDark: m.fabricDark, grip: m.grip, tip: m.tip, chrome: m.chrome, black: m.black, ano: side < 0 ? m.anoBlue : m.anoRed };
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = (mesh.material as THREE.Material).name;
    mesh.material = byName[name] ?? m.fabric;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false; // bones move the glove outside its bind-pose bounds
  });
  bakeRigidParts(model);
  root.add(model);
  const bone = (n: string) => { const b = model.getObjectByName(n)!; b.userData.rest = b.quaternion.clone(); return b; };
  const fingers = [0, 1, 2, 3].map((fi) => [0, 1, 2].map((si) => bone(`f${fi}_${si}`)));
  const thumb = [0, 1, 2].map((i) => bone(`t_${i}`));
  // wrist accessories ride on the sleeve (same frame as the procedural arm)
  const arm = new THREE.Group();
  arm.rotation.x = 0.62;
  root.add(arm);
  addAccessories(arm, side, m);
  const hand: EmuHand = { root, fingers, thumb, grip: 0, skinned: true };
  setGrip(hand, 0.25);
  return hand;
}

/**
 * The arm's rigid parts (sleeve, gauntlet, disconnect ring, bearing, pins, bolt heads) never move relative to the
 * hand root: bake them into one mesh per material so each arm costs a handful of draw calls instead of ~30.
 * The skinned glove and anything riding on a bone are left alone.
 */
function bakeRigidParts(model: THREE.Object3D) {
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const onBone = (o: THREE.Object3D) => { for (let p = o.parent; p && p !== model; p = p.parent) if ((p as THREE.Bone).isBone) return true; return false; };
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const rigid: THREE.Mesh[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || onBone(mesh) || Array.isArray(mesh.material)) return;
    const g = mesh.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    for (const k of ['position', 'normal', 'uv']) {
      const at = g.getAttribute(k) as THREE.BufferAttribute | undefined;
      if (at && !(at.array instanceof Float32Array)) { const n = at.count, sz = at.itemSize, out = new Float32Array(n * sz); for (let i = 0; i < n; i++) for (let c = 0; c < sz; c++) out[i * sz + c] = at.getComponent(i, c); g.setAttribute(k, new THREE.BufferAttribute(out, sz)); }
    }
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    const list = groups.get(mesh.material) ?? [];
    list.push(g); groups.set(mesh.material, list); rigid.push(mesh);
  });
  for (const mesh of rigid) mesh.removeFromParent();
  for (const [mat, geos] of groups) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    model.add(mesh);
  }
}

function addAccessories(arm: THREE.Object3D, side: number, m: ReturnType<typeof makeMats>) {
  const add = (mesh: THREE.Mesh, parent: THREE.Object3D) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };
  if (side < 0) {
    const book = new THREE.Group();
    const cover = add(new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.006, 0.065), m.black), book);
    cover.position.y = -0.002;
    const page = add(new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.06), m.page), book);
    page.rotation.x = -Math.PI / 2; page.position.y = 0.0015;
    for (let i = 0; i < 7; i++) { const coil = add(new THREE.Mesh(new THREE.TorusGeometry(0.0035, 0.0008, 4, 10), m.chrome), book); coil.position.set(-0.03 + i * 0.01, 0.002, 0.033); coil.rotation.y = Math.PI / 2; }
    book.position.set(0, 0.08, 0.15);
    book.rotation.set(0.62, Math.PI, 0);
    arm.add(book);
  } else {
    const bracket = add(new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.03, 0.01), m.chrome), arm);
    bracket.position.set(-0.058, 0.055, 0.12);
    const mirror = add(new THREE.Mesh(new THREE.CircleGeometry(0.022, 32), m.mirror), arm);
    mirror.position.set(-0.066, 0.075, 0.12); mirror.rotation.set(-0.5, -0.9, 0);
    const rim = add(new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.003, 8, 32), m.black), arm);
    rim.position.copy(mirror.position); rim.rotation.copy(mirror.rotation);
  }
}

/** 0 = relaxed (pressurised gloves never fully open), 1 = closed around a handrail. */
const _qx = new THREE.Quaternion(), _ax = new THREE.Vector3(1, 0, 0);
export function setGrip(h: EmuHand, g: number) {
  h.grip = g;
  if (h.skinned) {
    // bone roll puts +Z on the palm side, so +X rotation curls toward the palm
    const curl = (b: THREE.Object3D, a: number) => b.quaternion.copy(b.userData.rest as THREE.Quaternion).multiply(_qx.setFromAxisAngle(_ax, a));
    h.fingers.forEach((chain, fi) => chain.forEach((b, si) => curl(b, ((si === 0 ? 0.22 : 0.16) + g * (si === 0 ? 1.05 : si === 1 ? 1.3 : 0.95)) * (fi === 3 ? 1.08 : 1))));
    curl(h.thumb[0], 0.05 + g * 0.3);
    curl(h.thumb[1], 0.12 + g * 0.6);
    curl(h.thumb[2], 0.12 + g * 0.85);
    return;
  }
  h.fingers.forEach((chain, fi) => chain.forEach((j, si) => {
    const base = si === 0 ? 0.25 : 0.18;
    j.rotation.x = -(base + g * (si === 0 ? 1.05 : si === 1 ? 1.25 : 0.95)) * (fi === 3 ? 1.08 : 1);
  }));
  h.thumb[0].rotation.x = -0.2 - g * 0.55;
  h.thumb[1].rotation.x = -0.15 - g * 0.85;
}
