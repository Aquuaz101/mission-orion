import * as THREE from 'three';

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
  const offs = Array.from({ length: 6 }, () => new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize());
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let d = 1;
    for (const o of offs) d += Math.max(0, v.dot(o)) * (r() * 0.08 + 0.18) - 0.06;
    v.multiplyScalar(d);
    v.y *= flat;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Vertical light beam + pulsing ground ring used for objectives (visible through the storm). */
export function createBeacon(color: number) {
  const group = new THREE.Group();
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, intensity: { value: 1 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float time; uniform float intensity; varying vec2 vUv;
      void main(){
        float a = pow(1.0 - vUv.y, 2.2) * (0.55 + 0.15 * sin(time * 3.0 + vUv.y * 20.0));
        a *= smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
        gl_FragColor = vec4(color * 1.6, a * intensity);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, 90, 20, 1, true), beamMat);
  beam.position.y = 45;
  beam.frustumCulled = false;
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.75, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.25;
  const ring2 = ring.clone();
  ring2.material = ringMat.clone();
  group.add(beam, ring, ring2);
  return {
    group,
    update(t: number) {
      beamMat.uniforms.time.value = t;
      const k = (t * 0.6) % 1;
      ring2.scale.setScalar(1 + k * 1.6);
      (ring2.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
    },
    setRadius(r: number) {
      ring.scale.setScalar(r / 2.6);
    },
    dispose() {
      beam.geometry.dispose();
      beamMat.dispose();
      ring.geometry.dispose();
      ringMat.dispose();
      (ring2.material as THREE.Material).dispose();
    },
  };
}

/** A sample specimen sitting on the ground, styled by rock type. */
export function createSpecimen(kind: 'igneous' | 'hematite' | 'sedimentary') {
  const g = new THREE.Group();
  if (kind === 'sedimentary') {
    // stacked thin slabs: visible layering
    const cols = [0xb07850, 0x9a6440, 0xc08a60, 0x8a5a3c, 0xa87048];
    for (let i = 0; i < 5; i++) {
      const slab = new THREE.Mesh(rockGeometry(40 + i, 1, 0.18), new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.95 }));
      slab.scale.set(1.1 - i * 0.12, 0.9, 0.95 - i * 0.1);
      slab.position.y = i * 0.15;
      slab.rotation.y = i * 0.3;
      slab.castShadow = true;
      g.add(slab);
    }
  } else {
    const color = kind === 'igneous' ? 0x2d2a28 : 0x7a3e22;
    const main = new THREE.Mesh(rockGeometry(kind === 'igneous' ? 11 : 23, 2, 0.7), new THREE.MeshStandardMaterial({ color, roughness: kind === 'igneous' ? 0.7 : 0.9 }));
    main.scale.setScalar(0.7);
    main.position.y = 0.25;
    main.castShadow = true;
    g.add(main);
    if (kind === 'hematite') {
      // "blueberries": small dark grey spherules weathering out of the rock
      const r = rng(5);
      const berryMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.5, metalness: 0.2 });
      const berry = new THREE.SphereGeometry(0.05, 10, 8);
      for (let i = 0; i < 26; i++) {
        const b = new THREE.Mesh(berry, berryMat);
        const a = r() * Math.PI * 2, d = 0.55 + r() * 0.5;
        b.position.set(Math.cos(a) * d, 0.04, Math.sin(a) * d);
        g.add(b);
      }
    }
  }
  return g;
}

/** ARES-7: fictional solar-powered scout rover (original design, not a NASA vehicle). */
export function createAres7() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 0.6, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.4 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc8a050, roughness: 0.35, metalness: 0.8 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x9a6a46, roughness: 0.95, metalness: 0.0 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 1.6), white);
  body.position.y = 0.75;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 2.0), panelMat);
  deck.position.y = 1.02;
  // solar cell grid lines (visible once cleaned)
  const gridMat = new THREE.MeshBasicMaterial({ color: 0x3a5a8a, transparent: true, opacity: 0, toneMapped: false });
  const gridGeo = new THREE.PlaneGeometry(2.5, 1.9, 10, 8);
  const grid = new THREE.Mesh(gridGeo, gridMat);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = 1.05;
  (grid.material as THREE.MeshBasicMaterial).wireframe = true;

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.9, 8), dark);
  mast.position.set(0.35, 1.45, 0.55);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.18), white);
  head.position.set(0.35, 1.95, 0.6);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 12), dark);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0.35, 1.95, 0.7);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.02, 0.06, 16), gold);
  antenna.position.set(-0.4, 1.3, -0.5);
  const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.8, 4), dark);
  whip.position.set(-0.55, 1.45, 0.2);
  g.add(body, deck, grid, mast, head, lens, antenna, whip);

  const wheelGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.22, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const z of [-0.65, 0, 0.65]) for (const x of [-0.85, 0.85]) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(x, 0.26, z);
    g.add(w);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), white);
    strut.position.set(x * 0.85, 0.52, z);
    g.add(strut);
  }
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffaa33, toneMapped: false }));
  light.position.set(0.35, 2.08, 0.6);
  g.add(light);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });

  const dustCol = new THREE.Color(0x9a6a46), cleanCol = new THREE.Color(0x1a2a44);
  return {
    group: g,
    /** 0 = clean, 1 = fully dust-covered. */
    setDust(d: number) {
      panelMat.color.copy(cleanCol).lerp(dustCol, d);
      panelMat.metalness = 0.5 * (1 - d);
      panelMat.roughness = 0.35 + 0.6 * d;
      gridMat.opacity = 0.6 * (1 - d);
    },
    setStatus(color: number, blink: boolean, t: number) {
      (light.material as THREE.MeshBasicMaterial).color.setHex(color);
      light.visible = !blink || Math.sin(t * 5) > -0.2;
    },
  };
}
