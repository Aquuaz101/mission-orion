/**
 * First-person EMU (spacesuit) arms: Phase VI-style gloves + lower arms, built procedurally with
 * canvas fabric textures (weave, seams, wear) and normal maps so they hold up at 30 cm from the lens.
 * Each hand: gauntlet, wrist disconnect (anodised ring + chrome bearing), palm with grip pad, restraint
 * straps, three-segment fingers with knuckle bellows and rubber tips, thumb; the sleeve carries convolute
 * bearing rings, plus the cuff checklist (left) or the wrist mirror and tether loop (right).
 */
import * as THREE from 'three';

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
  fingers: THREE.Group[][];
  thumb: THREE.Group[];
  grip: number;
}

/** One EMU glove + lower sleeve. side = -1 left, +1 right. Hand points along -Z, palm faces -Y. */
export function emuArm(side: number): EmuHand {
  const m = (shared ??= makeMats());
  const root = new THREE.Group();
  const add = (mesh: THREE.Mesh, parent: THREE.Object3D = root) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };

  // ── sleeve (lower arm): runs back and down toward the elbow, with bearing convolutes
  const arm = new THREE.Group();
  arm.rotation.x = 0.62;
  root.add(arm);
  const sleeveProfile = [[0.05, 0.04], [0.056, 0.06], [0.06, 0.14], [0.064, 0.24], [0.069, 0.34], [0.073, 0.44]].map(([x, y]) => new THREE.Vector2(x, y));
  const sleeve = add(new THREE.Mesh(new THREE.LatheGeometry(sleeveProfile, 32), m.fabric), arm);
  sleeve.rotation.x = Math.PI / 2;
  for (const [z, rr] of [[0.12, 0.059], [0.2, 0.062], [0.28, 0.065], [0.36, 0.069]]) {
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(rr + 0.004, 0.0065, 8, 32), m.fabricDark), arm);
    ring.position.z = z;
  }
  // ── wrist disconnect: anodised ring (left blue, right red) + chrome bearing + latch nubs
  const ano = side < 0 ? m.anoBlue : m.anoRed;
  const disc = add(new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.054, 0.022, 40), ano));
  disc.rotation.x = Math.PI / 2; disc.position.z = 0.03;
  const bearing = add(new THREE.Mesh(new THREE.TorusGeometry(0.053, 0.006, 10, 40), m.chrome));
  bearing.position.z = 0.012;
  for (let i = 0; i < 3; i++) {
    const nub = add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.01, 0.018), m.chrome));
    const a = (i / 3) * Math.PI * 2 + 0.5;
    nub.position.set(Math.cos(a) * 0.063, Math.sin(a) * 0.063, 0.03);
  }
  // ── gauntlet (flared cuff over the wrist)
  const gaunt = add(new THREE.Mesh(new THREE.LatheGeometry([[0.044, 0], [0.05, 0.02], [0.054, 0.045], [0.056, 0.06]].map(([x, y]) => new THREE.Vector2(x, y)), 28), m.fabric));
  gaunt.rotation.x = -Math.PI / 2; gaunt.position.z = 0.005;
  // ── palm: rounded, slightly cupped; dark grip pad underneath; restraint straps on the back
  const palmGeo = new THREE.SphereGeometry(1, 28, 18);
  palmGeo.scale(0.05, 0.02, 0.056);
  const palm = add(new THREE.Mesh(palmGeo, m.fabric));
  palm.position.set(0, 0, -0.06);
  const padGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45);
  padGeo.scale(0.047, 0.019, 0.052);
  const pad = add(new THREE.Mesh(padGeo, m.grip));
  pad.position.set(0, -0.002, -0.06);
  for (const z of [-0.042, -0.075]) {
    const strap = add(new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.004, 6, 24, Math.PI), m.strap));
    strap.position.set(0, 0.002, z); strap.rotation.set(0, Math.PI / 2, 0); strap.rotation.z = 0;
    strap.scale.set(1, 0.48, 1);
  }

  // ── fingers: proximal / middle / distal, knuckle bellows, rubber tips; slightly splayed
  const fingers: THREE.Group[][] = [];
  const lens = [[0.03, 0.022, 0.019], [0.033, 0.024, 0.02], [0.031, 0.023, 0.019], [0.025, 0.019, 0.017]];
  [-0.031, -0.0105, 0.0105, 0.03].forEach((x, fi) => {
    const chain: THREE.Group[] = [];
    let parent: THREE.Object3D = root;
    lens[fi].forEach((len, si) => {
      const j = new THREE.Group();
      if (si === 0) { j.position.set(x * side, 0.002, -0.108); j.rotation.y = -x * side * 1.2; }
      else j.position.z = -lens[fi][si - 1];
      const rad = 0.0112 - si * 0.0008 - (fi === 3 ? 0.0012 : 0);
      const seg = add(new THREE.Mesh(new THREE.CapsuleGeometry(rad, len * 0.62, 4, 12), si === 2 ? m.tip : m.fabric), j);
      seg.rotation.x = Math.PI / 2; seg.position.z = -len / 2;
      if (si < 2) { const bel = add(new THREE.Mesh(new THREE.TorusGeometry(rad * 0.98, 0.0022, 6, 16), m.fabricDark), j); bel.position.z = -len; }
      if (si === 0) { const under = add(new THREE.Mesh(new THREE.CapsuleGeometry(rad * 0.75, len * 0.4, 3, 8), m.grip), j); under.rotation.x = Math.PI / 2; under.position.set(0, -rad * 0.55, -len / 2); }
      parent.add(j); chain.push(j); parent = j;
    });
    fingers.push(chain);
  });
  const thumb: THREE.Group[] = [];
  let tp: THREE.Object3D = root;
  [0.03, 0.026].forEach((len, i) => {
    const j = new THREE.Group();
    if (i === 0) { j.position.set(-0.048 * side, -0.008, -0.055); j.rotation.set(-0.2, 0.85 * side, 0.5 * side); }
    else j.position.z = -0.03;
    const seg = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.0125 - i * 0.001, len * 0.6, 4, 12), i === 1 ? m.tip : m.fabric), j);
    seg.rotation.x = Math.PI / 2; seg.position.z = -len / 2;
    tp.add(j); thumb.push(j); tp = j;
  });

  // ── wrist accessories
  if (side < 0) {
    // cuff checklist: small spiral-bound flip book on top of the left forearm
    const book = new THREE.Group();
    const cover = add(new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.006, 0.065), m.black), book);
    cover.position.y = -0.002;
    const page = add(new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.06), m.page), book);
    page.rotation.x = -Math.PI / 2; page.position.y = 0.0015;
    for (let i = 0; i < 7; i++) { const coil = add(new THREE.Mesh(new THREE.TorusGeometry(0.0035, 0.0008, 4, 10), m.chrome), book); coil.position.set(-0.03 + i * 0.01, 0.002, 0.033); coil.rotation.y = Math.PI / 2; }
    book.position.set(0, 0.075, 0.13);
    book.rotation.set(0.62, Math.PI, 0);
    arm.add(book);
  } else {
    // wrist mirror on its bracket + a wrist tether loop
    const bracket = add(new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.03, 0.01), m.chrome), arm);
    bracket.position.set(-0.05, 0.05, 0.1);
    const mirror = add(new THREE.Mesh(new THREE.CircleGeometry(0.022, 24), m.mirror), arm);
    mirror.position.set(-0.058, 0.07, 0.1); mirror.rotation.set(-0.5, -0.9, 0);
    const rim = add(new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.003, 6, 24), m.black), arm);
    rim.position.copy(mirror.position); rim.rotation.copy(mirror.rotation);
    const loop = add(new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 6, 16), m.chrome), arm);
    loop.position.set(0.062, -0.01, 0.06); loop.rotation.y = Math.PI / 2;
  }

  const hand = { root, fingers, thumb, grip: 0 };
  setGrip(hand, 0.25);
  return hand;
}

/** 0 = relaxed (pressurised gloves never fully open), 1 = closed around a handrail. */
export function setGrip(h: EmuHand, g: number) {
  h.grip = g;
  h.fingers.forEach((chain, fi) => chain.forEach((j, si) => {
    const base = si === 0 ? 0.25 : 0.18;
    j.rotation.x = -(base + g * (si === 0 ? 1.05 : si === 1 ? 1.25 : 0.95)) * (fi === 3 ? 1.08 : 1);
  }));
  h.thumb[0].rotation.x = -0.2 - g * 0.55;
  h.thumb[1].rotation.x = -0.15 - g * 0.85;
}
