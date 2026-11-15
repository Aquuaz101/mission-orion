import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Seeded RNG so rock fields are identical every run. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Irregular rock: a noise-displaced icosahedron, flattened a little. */
export function rockGeometry(seed: number, detail = 1, flat = 0.65) {
  const r = rng(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position as THREE.BufferAttribute;
  const offs = Array.from({ length: 7 }, () => new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize());
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let d = 1;
    for (const o of offs) d += Math.max(0, v.dot(o)) * (r() * 0.08 + 0.2) - 0.07;
    v.multiplyScalar(d);
    v.y *= flat;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A sample specimen sitting on the ground, styled by rock type. Radius ≈ 0.25 m. */
export function createSpecimen(kind: 'igneous' | 'hematite' | 'sedimentary') {
  const g = new THREE.Group();
  if (kind === 'sedimentary') {
    const cols = [0xb07850, 0x9a6440, 0xc08a60, 0x8a5a3c, 0xa87048];
    for (let i = 0; i < 5; i++) {
      const slab = new THREE.Mesh(rockGeometry(40 + i, 1, 0.2), new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.95 }));
      slab.scale.set(0.3 - i * 0.03, 0.24, 0.26 - i * 0.025);
      slab.position.y = 0.04 + i * 0.045;
      slab.rotation.y = i * 0.3;
      slab.castShadow = true;
      g.add(slab);
    }
  } else {
    const color = kind === 'igneous' ? 0x2d2a28 : 0x7a3e22;
    const main = new THREE.Mesh(rockGeometry(kind === 'igneous' ? 11 : 23, 2, 0.7), new THREE.MeshStandardMaterial({ color, roughness: kind === 'igneous' ? 0.7 : 0.9 }));
    main.scale.setScalar(0.24);
    main.position.y = 0.1;
    main.castShadow = true;
    g.add(main);
    if (kind === 'hematite') {
      const r = rng(5);
      const berryMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.5, metalness: 0.2 });
      const berry = new THREE.SphereGeometry(0.018, 8, 6);
      for (let i = 0; i < 16; i++) {
        const b = new THREE.Mesh(berry, berryMat);
        const a = r() * Math.PI * 2, d = 0.2 + r() * 0.12;
        b.position.set(Math.cos(a) * d, 0.015, Math.sin(a) * d);
        g.add(b);
      }
    }
  }
  return g;
}

/** Solar cell texture (dark blue cells with fine bus lines). */
function solarCellTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d1a33';
  g.fillRect(0, 0, 256, 128);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
    const grd = g.createLinearGradient(x * 16, y * 16, x * 16 + 16, y * 16 + 16);
    grd.addColorStop(0, '#1b2f57'); grd.addColorStop(1, '#0f1d3b');
    g.fillStyle = grd;
    g.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
  }
  g.strokeStyle = 'rgba(190,200,220,0.35)';
  g.lineWidth = 0.6;
  for (let y = 0; y < 8; y++) { g.beginPath(); g.moveTo(0, y * 16 + 8); g.lineTo(256, y * 16 + 8); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * ARES-7: fictional solar-powered scout rover (original design, not a NASA vehicle).
 * Six-wheel rocker-bogie style chassis, solar deck + two hinged wings, mast camera, HGA dish.
 */
export function createAres7() {
  const g = new THREE.Group();
  const body = new THREE.Group(); // tilts when stuck
  g.add(body);
  const white = new THREE.MeshStandardMaterial({ color: 0xe2ddd2, roughness: 0.55, metalness: 0.1 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.5, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.7, metalness: 0.3 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a14c, roughness: 0.3, metalness: 0.9 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xd8642a, roughness: 0.6 });
  const cellTex = solarCellTexture();
  const panelMat = new THREE.MeshStandardMaterial({ map: cellTex, color: 0xffffff, roughness: 0.3, metalness: 0.5 });
  const dustMat = new THREE.MeshStandardMaterial({ color: 0xa8714a, roughness: 1, transparent: true, opacity: 1, depthWrite: false });
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; };

  // chassis
  body.add(mesh(new RoundedBoxGeometry(1.25, 0.42, 1.5, 3, 0.08), white, 0, 0.78, 0));
  body.add(mesh(new THREE.BoxGeometry(1.0, 0.06, 1.3), dark, 0, 0.55, 0));
  body.add(mesh(new THREE.BoxGeometry(0.5, 0.12, 0.04), orange, 0, 0.84, 0.76)); // ID stripe
  for (const x of [-0.25, 0.25]) body.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 12).rotateX(Math.PI / 2), dark, x, 0.68, 0.77)); // hazcams

  // solar deck + wings (wings hinge along the deck edges)
  const deckW = 1.5, deckD = 1.7;
  const deck = new THREE.Group();
  deck.position.y = 1.02;
  body.add(deck);
  const deckPanel = mesh(new THREE.BoxGeometry(deckW, 0.035, deckD), panelMat);
  const deckDust = mesh(new THREE.BoxGeometry(deckW + 0.005, 0.005, deckD + 0.005), dustMat, 0, 0.021, 0);
  deck.add(deckPanel, deckDust);
  const wings: THREE.Group[] = [];
  const wingDust: THREE.Mesh[] = [deckDust];
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(side * deckW / 2, 0, 0);
    const p = mesh(new THREE.BoxGeometry(0.9, 0.03, deckD - 0.1), panelMat, side * 0.45, 0, 0);
    const d = mesh(new THREE.BoxGeometry(0.905, 0.005, deckD - 0.095), dustMat, side * 0.45, 0.019, 0);
    hinge.add(p, d);
    hinge.rotation.z = side * 3.08; // folded flat over the deck
    deck.add(hinge);
    wings.push(hinge);
    wingDust.push(d);
  }

  // mast + camera head
  const mast = new THREE.Group();
  mast.position.set(0.42, 1.04, 0.55);
  body.add(mast);
  mast.add(mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.9, 10), grey, 0, 0.45, 0));
  const head = new THREE.Group();
  head.position.y = 0.95;
  mast.add(head);
  head.add(mesh(new RoundedBoxGeometry(0.36, 0.16, 0.18, 2, 0.03), white));
  for (const x of [-0.09, 0.09]) head.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 14).rotateX(Math.PI / 2), dark, x, 0, 0.1));
  const light = mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffaa33, toneMapped: false }), 0, 0.11, -0.02);
  head.add(light);

  // high-gain dish + whip antenna
  const dish = new THREE.Group();
  dish.position.set(-0.45, 1.08, -0.5);
  body.add(dish);
  dish.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 8), grey, 0, 0.09, 0));
  const plate = mesh(new THREE.SphereGeometry(0.22, 20, 8, 0, Math.PI * 2, 0, 0.6), gold, 0, 0.32, 0);
  plate.rotation.x = Math.PI * 0.7;
  dish.add(plate);
  body.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.0, 5), dark, -0.58, 1.5, 0.35));

  // rocker-bogie style legs + six treaded wheels
  const wheelGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.2, 20, 1);
  wheelGeo.rotateZ(Math.PI / 2);
  const treadGeo = new THREE.TorusGeometry(0.22, 0.03, 6, 20);
  treadGeo.rotateY(Math.PI / 2);
  const wheelPivots: THREE.Group[] = [];
  const hubGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.22, 10).rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.21, 0.03, 0.4);
  for (const side of [-1, 1]) {
    const x = side * 0.88;
    body.add(mesh(new THREE.BoxGeometry(0.06, 0.06, 1.45), grey, side * 0.72, 0.52, 0));
    for (const [z, h] of [[-0.62, 0.42], [0, 0.42], [0.62, 0.42]] as const) {
      body.add(mesh(new THREE.BoxGeometry(0.05, h, 0.05), grey, side * 0.78, 0.36, z));
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.24, z);
      pivot.add(mesh(wheelGeo, dark), mesh(treadGeo, dark), mesh(hubGeo, grey), mesh(spokeGeo, grey)); // spoke shows rotation
      body.add(pivot);
      wheelPivots.push(pivot);
    }
  }

  return {
    group: g,
    body,
    wheels: wheelPivots,
    /** World-space front tow point (where the cable clamps). */
    hitchLocal: new THREE.Vector3(0, 0.62, 0.8),
    /** 0 = clean panels, 1 = covered in dust. */
    setDust(d: number) {
      for (const m of wingDust) {
        (m.material as THREE.MeshStandardMaterial).opacity = d;
        m.visible = d > 0.01;
      }
    },
    /** 0 = wings folded over the deck, 1 = fully deployed flat. */
    setWings(k: number) {
      wings.forEach((w, i) => (w.rotation.z = (i === 0 ? -1 : 1) * THREE.MathUtils.lerp(3.08, 0.06, k)));
    },
    setStatus(color: number, blink: boolean, t: number) {
      ((light as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(color);
      light.visible = !blink || Math.sin(t * 5) > -0.2;
    },
    lookMast(yaw: number) {
      head.rotation.y = yaw;
    },
  };
}

/**
 * Physical tow cable: a verlet chain under Mars gravity (3.71 m/s²) pinned to both hitches. It sags under its own
 * weight, goes slack and drags on the ground when ARES-7 rolls closer, and pulls straight when towing. Braided steel
 * with high-visibility orange sleeves and a shackle at each end. Rebuilt every frame from the simulated points.
 */
export class TowCable {
  readonly mesh = new THREE.Group();
  /** Cable length when deployed (m). */
  length = 3.6;
  extend = 0; // 0..1 animation (cable shooting out from the rover)
  private readonly n = 22;
  private pts: THREE.Vector3[] = [];
  private prev: THREE.Vector3[] = [];
  private tube: THREE.Mesh;
  private hooks: THREE.Group[] = [];
  private live = false;

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ map: cableTexture(), color: 0xffffff, roughness: 0.42, metalness: 0.65 });
    this.tube = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.tube.castShadow = true;
    this.tube.frustumCulled = false;
    this.mesh.add(this.tube);
    const red = new THREE.MeshStandardMaterial({ color: 0xd8401f, roughness: 0.45, metalness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.3, metalness: 0.9 });
    for (let i = 0; i < 2; i++) {
      // bow shackle: a loop + a threaded pin, plus a short crimped ferrule where the cable enters
      const h = new THREE.Group();
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.016, 10, 24, Math.PI * 1.4), red);
      bow.rotation.z = -Math.PI * 0.2;
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 10), steel);
      pin.rotation.z = Math.PI / 2; pin.position.y = -0.05;
      const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 12), steel);
      ferrule.position.y = 0.11;
      h.add(bow, pin, ferrule);
      h.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      this.hooks.push(h);
      this.mesh.add(h);
    }
    this.mesh.visible = false;
  }

  private reset(a: THREE.Vector3, b: THREE.Vector3) {
    this.pts = []; this.prev = [];
    for (let i = 0; i < this.n; i++) { const p = a.clone().lerp(b, i / (this.n - 1)); this.pts.push(p); this.prev.push(p.clone()); }
    this.live = true;
  }

  /** a = rover hitch, b = ARES-7 hitch (world); ground(x, z) = terrain height. */
  update(a: THREE.Vector3, b: THREE.Vector3, dt: number, ground?: (x: number, z: number) => number) {
    if (this.extend <= 0.001) { this.mesh.visible = false; this.live = false; return; }
    const end = a.clone().lerp(b, this.extend);
    if (!this.live) this.reset(a, end);
    const n = this.n, pts = this.pts, prev = this.prev;
    // rest length: while shooting out, just longer than the gap; once deployed, the full cable (slack when close)
    const total = this.extend < 1 ? a.distanceTo(end) * 1.03 + 0.05 : Math.max(this.length, a.distanceTo(b) * 1.01);
    const seg = total / (n - 1);
    const h = Math.min(dt, 1 / 30), g = 3.71 * h * h;
    for (let i = 1; i < n - 1; i++) {
      const p = pts[i], q = prev[i];
      const vx = (p.x - q.x) * 0.985, vy = (p.y - q.y) * 0.985, vz = (p.z - q.z) * 0.985;
      q.copy(p);
      p.x += vx; p.y += vy - g; p.z += vz;
    }
    pts[0].copy(a); pts[n - 1].copy(end);
    for (let it = 0; it < 14; it++) {
      for (let i = 0; i < n - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const k = (d - seg) / d;
        const wa = i === 0 ? 0 : 0.5, wb = i + 1 === n - 1 ? 0 : 0.5;
        const t = wa + wb || 1;
        p.x += dx * k * (wa / t); p.y += dy * k * (wa / t); p.z += dz * k * (wa / t);
        q.x -= dx * k * (wb / t); q.y -= dy * k * (wb / t); q.z -= dz * k * (wb / t);
      }
      if (ground) for (let i = 1; i < n - 1; i++) {
        const p = pts[i], gy = ground(p.x, p.z) + 0.035;
        if (p.y < gy) { p.y = gy; prev[i].x += (p.x - prev[i].x) * 0.4; prev[i].z += (p.z - prev[i].z) * 0.4; } // rests and drags on the regolith
      }
      pts[0].copy(a); pts[n - 1].copy(end);
    }
    // rebuild the tube through the simulated points
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.tube.geometry.dispose();
    this.tube.geometry = new THREE.TubeGeometry(curve, 64, 0.04, 10);
    (this.tube.material as THREE.MeshStandardMaterial).map!.repeat.set(total / 0.5, 1);
    // shackles sit on the hitches, turned along the cable
    const up = new THREE.Vector3(0, 1, 0);
    this.hooks[0].position.copy(a);
    this.hooks[0].quaternion.setFromUnitVectors(up, pts[1].clone().sub(a).normalize());
    this.hooks[1].position.copy(end);
    this.hooks[1].quaternion.setFromUnitVectors(up, pts[n - 2].clone().sub(end).normalize());
    this.hooks[1].visible = this.extend >= 1;
    this.mesh.visible = true;
  }
}

/** Braided steel with an orange high-visibility sleeve every half metre (u runs along the cable). */
function cableTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7d828a'; g.fillRect(0, 0, 128, 32);
  g.strokeStyle = 'rgba(30,32,36,0.65)'; g.lineWidth = 2;
  for (let x = -32; x < 160; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 18, 32); g.stroke(); }
  g.strokeStyle = 'rgba(220,225,232,0.35)'; g.lineWidth = 1;
  for (let x = -32; x < 160; x += 6) { g.beginPath(); g.moveTo(x + 2, 0); g.lineTo(x + 20, 32); g.stroke(); }
  g.fillStyle = '#ff6a1f'; g.fillRect(0, 0, 22, 32);
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 4, 22, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
