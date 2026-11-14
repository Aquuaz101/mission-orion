import * as THREE from 'three';

/**
 * Real-sky helpers. The NASA Tycho star map is equirectangular in equatorial
 * coordinates with u = 0.5 + RA/24h, v = (90° - Dec)/180° (verified against the
 * Pleiades and Orion's belt). raDecToDir() uses the same mapping as
 * THREE.SphereGeometry's UVs, so overlays land exactly on the texture's stars.
 */
export function raDecToDir(raHours: number, decDeg: number, out = new THREE.Vector3()) {
  const u = (((0.5 + raHours / 24) % 1) + 1) % 1;
  const v = (90 - decDeg) / 180;
  const phi = u * Math.PI * 2;
  const theta = v * Math.PI;
  return out.set(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
}

const hms = (h: number, m: number, s: number) => h + m / 60 + s / 3600;
const dms = (d: number, m: number, s: number) => Math.sign(d || 1) * (Math.abs(d) + m / 60 + s / 3600);

/** Orion's main stars (J2000 positions, apparent V magnitude, approximate colour). */
export const ORION = [
  { name: 'Betelgeuse', ra: hms(5, 55, 10), dec: dms(7, 24, 25), mag: 0.5, color: 0xffb27a },
  { name: 'Rigel', ra: hms(5, 14, 32), dec: dms(-8, 12, 6), mag: 0.13, color: 0xcfe0ff },
  { name: 'Bellatrix', ra: hms(5, 25, 8), dec: dms(6, 20, 59), mag: 1.64, color: 0xd6e4ff },
  { name: 'Saiph', ra: hms(5, 47, 45), dec: dms(-9, 40, 11), mag: 2.06, color: 0xd6e4ff },
  { name: 'Alnitak', ra: hms(5, 40, 46), dec: dms(-1, 56, 34), mag: 1.77, color: 0xd6e4ff },
  { name: 'Alnilam', ra: hms(5, 36, 13), dec: dms(-1, 12, 7), mag: 1.69, color: 0xd6e4ff },
  { name: 'Mintaka', ra: hms(5, 32, 0), dec: dms(-0, 17, 57), mag: 2.23, color: 0xd6e4ff },
  { name: 'Meissa', ra: hms(5, 35, 8), dec: dms(9, 56, 3), mag: 3.33, color: 0xd6e4ff },
];

/** Stick-figure lines between ORION indices. */
export const ORION_LINES: [number, number][] = [
  [7, 0], [7, 2], [0, 4], [2, 6], [4, 5], [5, 6], [4, 3], [6, 1],
];

/** Background sphere with the NASA Tycho star map, brightened for display. */
export function createStarSphere(tex: THREE.Texture, radius = 1000, gain = 2.4) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, gain: { value: gain }, opacity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float gain; uniform float opacity;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(map, vUv).rgb;
        // crush the faint noise floor, keep real stars crisp
        float l = max(max(c.r, c.g), c.b);
        c *= smoothstep(0.035, 0.16, l);
        c = pow(c, vec3(1.1)) * gain;
        gl_FragColor = vec4(c * opacity, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 48), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

/** Soft radial sprite texture (glows, sun, star halos). */
export function glowTexture(size = 256, stops: [number, string][] = [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
