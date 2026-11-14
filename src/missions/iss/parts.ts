/**
 * Procedural International Space Station hardware for helmet-cam close-ups.
 * Everything is built from primitives + canvas textures so it stays sharp at 30 cm and costs no downloads:
 * quilted beta-cloth MLI blankets, gold Kapton, yellow EVA handrails, a lattice truss, solar-array wings,
 * radiators, a lithium-ion battery ORU with bolts and keyed connectors, EMU gloves and a pistol-grip tool.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// ───────────────────────────────────────────── textures
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

/** Quilted beta-cloth MLI blanket: puffy stitched cells, subtle wrinkles. Returns colour + bump. */
function mliTextures() {
  const N = 512, cell = 128, r = rng(7);
  const drawCells = (g: CanvasRenderingContext2D, bump: boolean) => {
    g.fillStyle = bump ? '#808080' : '#e9e6dd';
    g.fillRect(0, 0, N, N);
    for (let y = 0; y < N; y += cell) for (let x = 0; x < N; x += cell) {
      const grd = g.createRadialGradient(x + cell / 2, y + cell / 2, 4, x + cell / 2, y + cell / 2, cell * 0.72);
      if (bump) { grd.addColorStop(0, '#c8c8c8'); grd.addColorStop(1, '#5a5a5a'); }
      else { const v = 226 + Math.floor(r() * 12); grd.addColorStop(0, `rgb(${v},${v - 2},${v - 8})`); grd.addColorStop(1, `rgb(${v - 14},${v - 16},${v - 22})`); }
      g.fillStyle = grd;
      g.fillRect(x, y, cell, cell);
    }
    // stitch lines + stitch dots
    g.strokeStyle = bump ? '#404040' : 'rgba(160,156,145,0.35)';
    g.lineWidth = 1.5;
    for (let i = 0; i <= N; i += cell) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, N); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(N, i); g.stroke(); }
    // wrinkles
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = bump ? `rgba(40,40,40,${0.25 + r() * 0.3})` : `rgba(160,155,145,${0.12 + r() * 0.15})`;
      g.lineWidth = 1 + r() * 2;
      const x = r() * N, y = r() * N, a = r() * Math.PI, l = 10 + r() * 40;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.5) * l * 0.5, y + Math.sin(a + 0.5) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    if (!bump) {
      // grime + scuffs from decades in orbit
      for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(120,105,80,${r() * 0.05})`; g.beginPath(); g.arc(r() * N, r() * N, 2 + r() * 14, 0, Math.PI * 2); g.fill(); }
    }
  };
  return { map: canvasTex(N, N, (g) => drawCells(g, false)), bump: canvasTex(N, N, (g) => drawCells(g, true), false) };
}

/** Crinkled gold Kapton / foil bump. */
function crinkleTex() {
  const r = rng(19);
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},0.08)`;
      g.beginPath();
      const x = r() * 256, y = r() * 256;
      g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 50, y + (r() - 0.5) * 50); g.lineTo(x + (r() - 0.5) * 50, y + (r() - 0.5) * 50); g.fill();
    }
  }, false);
}

/** Solar array blanket: dark blue cells with silver busbars, framed in gold. */
function solarTextures() {
  const front = canvasTex(512, 512, (g) => {
    g.fillStyle = '#c9a24a'; g.fillRect(0, 0, 512, 512);
    const r = rng(3);
    const cw = 512 / 8, ch = 512 / 16;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) {
      const v = 18 + Math.floor(r() * 10);
      g.fillStyle = `rgb(${v},${v + 14},${v + 52})`;
      g.fillRect(x * cw + 2, y * ch + 2, cw - 4, ch - 4);
      g.fillStyle = 'rgba(190,200,220,0.35)';
      for (let k = 1; k < 4; k++) g.fillRect(x * cw + 2, y * ch + (ch * k) / 4, cw - 4, 1);
    }
  }, true);
  const back = canvasTex(256, 256, (g) => {
    g.fillStyle = '#b8742a'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(80,40,10,0.5)';
    for (let i = 0; i <= 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); }
  }, true);
  return { front, back };
}

/** Simple text decal (stencilled labels on hardware). */
export function decal(lines: string[], w = 512, h = 256, bg = '#e8e3d6', fg = '#1b1b1b') {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    let size = Math.floor(h / (lines.length + 1.2));
    g.font = `bold ${size}px "JetBrains Mono", monospace`;
    const widest = Math.max(...lines.map((l) => g.measureText(l).width));
    if (widest > w * 0.88) { size = Math.floor((size * w * 0.88) / widest); g.font = `bold ${size}px "JetBrains Mono", monospace`; }
    g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, w * 0.06, (h / (lines.length + 1)) * (i + 1)));
    g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
  });
}

// ───────────────────────────────────────────── materials
export function makeMaterials() {
  const mli = mliTextures();
  const crinkle = crinkleTex();
  const solar = solarTextures();
  return {
    mli: new THREE.MeshStandardMaterial({ map: mli.map, bumpMap: mli.bump, bumpScale: 1.2, roughness: 0.9, metalness: 0 }),
    mliSmall: (() => { const m = new THREE.MeshStandardMaterial({ map: mli.map.clone(), bumpMap: mli.bump.clone(), bumpScale: 1.0, roughness: 0.9 }); m.map!.repeat.set(1.4, 1.4); m.bumpMap!.repeat.set(1.4, 1.4); return m; })(),
    alu: new THREE.MeshStandardMaterial({ color: 0xa9afb6, metalness: 0.7, roughness: 0.5 }),
    aluDark: new THREE.MeshStandardMaterial({ color: 0x5b6067, metalness: 0.7, roughness: 0.45 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe9eaea, metalness: 0.05, roughness: 0.6 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4a23c, metalness: 1, roughness: 0.28, bumpMap: crinkle, bumpScale: 2 }),
    handrail: new THREE.MeshStandardMaterial({ color: 0xe0b12a, metalness: 0.25, roughness: 0.42 }),
    black: new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.3, roughness: 0.6 }),
    solarFront: new THREE.MeshStandardMaterial({ map: solar.front, metalness: 0.35, roughness: 0.32, side: THREE.FrontSide }),
    solarBack: new THREE.MeshStandardMaterial({ map: solar.back, metalness: 0.5, roughness: 0.45, side: THREE.FrontSide }),
    radiator: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, metalness: 0.0, roughness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0a1018, metalness: 0.9, roughness: 0.05 }),
    interior: new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.8 }),
  };
}
export type Mats = ReturnType<typeof makeMaterials>;

// ───────────────────────────────────────────── station pieces
/** Yellow EVA handrail: two stand-offs and a bar. `len` along local X. */
export function handrail(m: Mats, len = 0.6) {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, len, 12), m.handrail);
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 0.075;
  g.add(bar);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.075, 10), m.handrail);
    leg.position.set((s * len) / 2 - s * 0.02, 0.037, 0);
    g.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.01, 0.04), m.aluDark);
    foot.position.set((s * len) / 2 - s * 0.02, 0.004, 0);
    g.add(foot);
  }
  return g;
}

/** Lattice truss along +X from x0 to x1, square section `s`, centred on (y, z). */
export function truss(m: Mats, x0: number, x1: number, s = 3.6) {
  const g = new THREE.Group();
  const h = s / 2, L = x1 - x0, cx = (x0 + x1) / 2;
  // longerons
  for (const [y, z] of [[-h, -h], [-h, h], [h, -h], [h, h]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(L, 0.14, 0.14), m.alu);
    b.position.set(cx, y, z);
    g.add(b);
  }
  // bays: cross members + diagonals (instanced)
  const bay = 4.5, n = Math.floor(L / bay);
  const strut = new THREE.CylinderGeometry(0.045, 0.045, 1, 8);
  const inst = new THREE.InstancedMesh(strut, m.alu, n * 12 + 4);
  let k = 0;
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const put = (a: THREE.Vector3, b: THREE.Vector3) => {
    const d = b.clone().sub(a), len = d.length();
    q.setFromUnitVectors(up, d.normalize());
    M.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, len, 1));
    inst.setMatrixAt(k++, M);
  };
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * bay;
    const c = [[-h, -h], [-h, h], [h, h], [h, -h]].map(([y, z]) => new THREE.Vector3(x, y, z));
    for (let j = 0; j < 4; j++) put(c[j], c[(j + 1) % 4]);
    if (i < n) {
      const c2 = c.map((p) => p.clone().setX(x + bay));
      for (let j = 0; j < 4; j++) put(j % 2 ? c[j] : c[(j + 1) % 4], j % 2 ? c2[(j + 1) % 4] : c2[j]);
      for (let j = 0; j < 4; j++) put(c[j], c2[(j + 2) % 4]);
    }
  }
  inst.count = k;
  inst.instanceMatrix.needsUpdate = true;
  inst.castShadow = inst.receiveShadow = true;
  g.add(inst);
  // the face toward the worksite (+Z) and the Earth face (-Y) are partly closed with MLI-covered boxes, trays and ORUs
  const r = rng(41);
  for (let x = x0 + 1; x < x1 - 1; x += 1.2 + r() * 2.2) {
    const w = 0.6 + r() * 1.4, hh = 0.4 + r() * 0.7, d = 0.25 + r() * 0.35;
    const box = new THREE.Mesh(new RoundedBoxGeometry(w, hh, d, 2, 0.03), r() > 0.35 ? m.mliSmall : m.white);
    const face = r();
    if (face < 0.55 && x > -1 && x < 29) continue; // keep the handrail path + battery bank clear
    if (face < 0.55) box.position.set(x, (r() - 0.5) * (s - hh - 0.4), h + d / 2 - 0.1);
    else box.position.set(x, -h - d / 2 + 0.1, (r() - 0.5) * (s - w));
    if (face >= 0.55) box.rotation.x = Math.PI / 2;
    box.castShadow = box.receiveShadow = true;
    g.add(box);
  }
  // cable trays running the length
  for (const [y, z] of [[h - 0.35, h + 0.05], [-h + 0.3, h + 0.05]]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(L, 0.06, 0.14), m.aluDark);
    t.position.set(cx, y, z);
    g.add(t);
  }
  return g;
}

/** Pressurised module: cylinder wrapped in MLI with end cones and a few details. Axis along +X. */
export function module(m: Mats, length: number, radius: number) {
  const g = new THREE.Group();
  const mat = m.mli.clone();
  mat.map = m.mli.map!.clone(); mat.map.repeat.set(length / 1.6, (radius * Math.PI * 2) / 1.6); mat.map.needsUpdate = true;
  mat.bumpMap = m.mli.bumpMap!.clone(); mat.bumpMap.repeat.copy(mat.map.repeat); mat.bumpMap.needsUpdate = true;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 48, 1, true), mat);
  body.rotation.z = Math.PI / 2;
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  for (const s of [-1, 1]) {
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius, 0.6, 48, 1, true), m.alu);
    cone.rotation.z = (-s * Math.PI) / 2;
    cone.position.x = s * (length / 2 + 0.3);
    g.add(cone);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.55, 0.06, 8, 40), m.aluDark);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = s * (length / 2 + 0.6);
    g.add(ring);
  }
  // longitudinal handrails + hull rings
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const hr = handrail(m, length * 0.8);
    hr.position.set(0, Math.cos(a) * radius, Math.sin(a) * radius);
    hr.rotation.x = -a;
    g.add(hr);
  }
  for (let i = -1; i <= 1; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.02, 0.03, 6, 48), m.aluDark);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = (i * length) / 3;
    g.add(ring);
  }
  return g;
}

/** Solar array wing: mast + two blankets, extending along +Z from the origin. */
export function solarWing(m: Mats, length = 34, width = 4.6) {
  const g = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, length), m.aluDark);
  mast.position.z = length / 2;
  g.add(mast);
  for (const s of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(width, length, 1, 1);
    const front = new THREE.Mesh(geo, m.solarFront);
    const map = (m.solarFront.map as THREE.Texture);
    map.repeat.set(1, length / 4.5);
    front.rotation.x = -Math.PI / 2;
    front.position.set(s * (width / 2 + 0.3), 0.01, length / 2);
    front.castShadow = true;
    const back = new THREE.Mesh(geo, m.solarBack);
    back.rotation.x = Math.PI / 2;
    back.position.set(s * (width / 2 + 0.3), -0.01, length / 2);
    g.add(front, back);
    // blanket box at the root and tip
    for (const z of [0.2, length]) {
      const bx = new THREE.Mesh(new THREE.BoxGeometry(width, 0.3, 0.35), m.aluDark);
      bx.position.set(s * (width / 2 + 0.3), 0, z);
      g.add(bx);
    }
  }
  return g;
}

/** Radiator: a set of white panels hanging from a hinge, along -Y. */
export function radiator(m: Mats, panels = 4, w = 3.2, h = 2.2) {
  const g = new THREE.Group();
  for (let i = 0; i < panels; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), m.radiator);
    p.position.y = -(i + 0.5) * (h + 0.08);
    p.rotation.x = (i % 2 ? 1 : -1) * 0.04;
    p.castShadow = p.receiveShadow = true;
    g.add(p);
    for (let t = 0; t < 6; t++) {
      const tube = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 0.02, 0.07), m.aluDark);
      tube.position.set(0, p.position.y - h / 2 + ((t + 0.5) * h) / 6, 0);
      g.add(tube);
    }
  }
  return g;
}

// ───────────────────────────────────────────── battery ORU (the job)
export interface Oru {
  group: THREE.Group;
  bolts: THREE.Mesh[];
  ports: THREE.Mesh[];
  leds: THREE.MeshStandardMaterial[];
  status: THREE.MeshStandardMaterial;
}

/** Lithium-ion battery Orbital Replacement Unit. Front face is +Z. */
export function batteryOru(m: Mats, label: string[], ok: boolean): Oru {
  const g = new THREE.Group();
  const W = 1.0, H = 0.86, D = 0.52;
  const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 3, 0.03), m.mliSmall);
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  // front plate with stencil
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.3), new THREE.MeshStandardMaterial({ map: decal(label), roughness: 0.7 }));
  plate.position.set(-0.05, 0.12, D / 2 + 0.002);
  g.add(plate);
  // gold handle on top-front
  const h = handrail(m, 0.5);
  h.rotation.x = Math.PI / 2;
  h.position.set(0, H / 2 - 0.08, D / 2);
  g.add(h);
  // four captive bolts (hex heads in recessed cups)
  const bolts: THREE.Mesh[] = [];
  for (const [x, y] of [[-0.42, 0.36], [0.42, 0.36], [-0.42, -0.36], [0.42, -0.36]]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 20), m.black);
    cup.rotation.x = Math.PI / 2;
    cup.position.set(x, y, D / 2 + 0.005);
    g.add(cup);
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 6), m.alu);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(x, y, D / 2 + 0.03);
    g.add(bolt);
    bolts.push(bolt);
  }
  // keyed connectors on the right side, with dust caps colour-coded
  const ports: THREE.Mesh[] = [];
  const leds: THREE.MeshStandardMaterial[] = [];
  const shapes = [new THREE.CylinderGeometry(0.04, 0.04, 0.06, 24), new THREE.CylinderGeometry(0.05, 0.05, 0.06, 3), new THREE.BoxGeometry(0.075, 0.06, 0.075)];
  [-0.24, 0, 0.24].forEach((y, i) => {
    const p = new THREE.Mesh(shapes[i], m.aluDark);
    p.rotation.z = Math.PI / 2;
    p.position.set(W / 2 + 0.03, y, 0.08);
    g.add(p);
    ports.push(p);
    const led = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x000000, emissiveIntensity: 4 });
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), led);
    l.position.set(W / 2 + 0.01, y + 0.07, 0.2);
    g.add(l);
    leds.push(led);
  });
  // status lamp
  const status = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: ok ? 0x00ff66 : 0xff2200, emissiveIntensity: ok ? 0 : 5 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), status);
  lamp.position.set(0.36, 0.14, D / 2 + 0.01);
  g.add(lamp);
  return { group: g, bolts, ports, leds, status };
}

// ───────────────────────────────────────────── EMU gloves (first person)
export interface Hand {
  root: THREE.Group;
  fingers: THREE.Group[][]; // [finger][segment]
  thumb: THREE.Group[];
  grip: number;
}

/** One EMU glove + sleeve, in camera space. side = -1 left, +1 right. */
export function glove(side: number): Hand {
  const fabric = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.75 });
  const palmMat = new THREE.MeshStandardMaterial({ color: 0x8b8f94, roughness: 0.85 });
  const tipMat = new THREE.MeshStandardMaterial({ color: 0x6d7177, roughness: 0.8 });
  const cuffMat = new THREE.MeshStandardMaterial({ color: side < 0 ? 0x2a5fb0 : 0xb03030, metalness: 0.6, roughness: 0.35 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xc0c4c8, metalness: 0.9, roughness: 0.25 });
  const root = new THREE.Group();

  // sleeve (runs back toward the shoulder, out of frame)
  const arm = new THREE.Group();
  arm.rotation.x = 0.8; // forearm runs back and down, out of frame
  root.add(arm);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.08, 0.34, 20), fabric);
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.set(0, 0, 0.25);
  arm.add(sleeve);
  for (const z of [0.14, 0.24, 0.34]) {
    const fold = new THREE.Mesh(new THREE.TorusGeometry(0.07 + (z - 0.14) * 0.04, 0.007, 6, 24), fabric);
    fold.position.z = z;
    arm.add(fold);
  }
  // wrist disconnect: coloured ring + bearing (EMU left = blue, right = red)
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.045, 28), cuffMat);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.z = 0.06;
  const bearing = new THREE.Mesh(new THREE.TorusGeometry(0.064, 0.009, 8, 28), ringMat);
  bearing.position.z = 0.035;
  root.add(cuff, bearing);
  // gauntlet + palm
  const gaunt = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.062, 0.07, 20), fabric);
  gaunt.rotation.x = Math.PI / 2;
  gaunt.position.z = 0.0;
  root.add(gaunt);
  const palm = new THREE.Mesh(new RoundedBoxGeometry(0.095, 0.034, 0.1, 3, 0.014), fabric);
  palm.position.set(0, 0, -0.075);
  root.add(palm);
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.085, 0.01, 0.085, 2, 0.004), palmMat);
  pad.position.set(0, -0.018, -0.075);
  root.add(pad);

  // fingers: 4 × 3 segments, hinged so they can curl
  const fingers: THREE.Group[][] = [];
  const seg = [0.034, 0.026, 0.022];
  [-0.033, -0.011, 0.011, 0.033].forEach((x, fi) => {
    const chain: THREE.Group[] = [];
    let parent: THREE.Object3D = root;
    let z = -0.125;
    seg.forEach((len, si) => {
      const j = new THREE.Group();
      j.position.set(si === 0 ? x * side : 0, 0, si === 0 ? z : -seg[si - 1]);
      const s = fi === 0 || fi === 3 ? 0.92 : 1;
      const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.0105, len * s * 0.8, 4, 10), si === 2 ? tipMat : fabric);
      cap.rotation.x = Math.PI / 2;
      cap.position.z = (-len * s) / 2;
      j.add(cap);
      parent.add(j);
      chain.push(j);
      parent = j;
      z = 0;
    });
    fingers.push(chain);
  });
  // thumb
  const thumb: THREE.Group[] = [];
  let tp: THREE.Object3D = root;
  [0.03, 0.026].forEach((len, i) => {
    const j = new THREE.Group();
    if (i === 0) { j.position.set(-0.052 * side, -0.006, -0.06); j.rotation.y = 0.75 * side; }
    else j.position.z = -0.03;
    const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, len * 0.8, 4, 10), i === 1 ? tipMat : fabric);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = -len / 2;
    j.add(cap);
    tp.add(j);
    thumb.push(j);
    tp = j;
  });
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const hand = { root, fingers, thumb, grip: 0 };
  setGrip(hand, 0.15);
  return hand;
}

/** 0 = open flat glove (pressurised gloves never fully open), 1 = fist around a handrail. */
export function setGrip(h: Hand, g: number) {
  h.grip = g;
  h.fingers.forEach((chain, fi) => chain.forEach((j, si) => (j.rotation.x = -(0.18 + g * (si === 0 ? 1.15 : 1.0)) * (fi === 0 ? 0.95 : 1))));
  h.thumb[0].rotation.x = -0.2 - g * 0.6;
  h.thumb[1].rotation.x = -0.15 - g * 0.7;
}

/** Pistol Grip Tool: NASA's battery-powered EVA torque driver, with socket extension. Points along -Z. */
export function pistolGripTool() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x4c5560, metalness: 0.35, roughness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.22 });
  const main = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.09, 0.2, 3, 0.015), body);
  const grip = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.13, 0.06, 3, 0.015), accent);
  grip.position.set(0, -0.09, 0.05);
  grip.rotation.x = -0.25;
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.03), new THREE.MeshStandardMaterial({ color: 0x0b1a10, emissive: 0x2cff8a, emissiveIntensity: 0.6 }));
  disp.position.set(0, 0.046, 0.05);
  disp.rotation.x = -Math.PI / 2;
  const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.22, 12), steel);
  ext.rotation.x = Math.PI / 2;
  ext.position.z = -0.2;
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.018, 0.04, 6), steel);
  socket.rotation.x = Math.PI / 2;
  socket.position.z = -0.31;
  g.add(main, grip, disp, ext, socket);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return { group: g, socket, display: disp.material as THREE.MeshStandardMaterial };
}
