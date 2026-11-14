import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { Stage } from '../../core/Engine';
import type { Assets } from '../../core/Assets';

/**
 * Hubble's view of the Jupiter system.
 *
 * Units: 1 = Jupiter's equatorial radius (71,492 km). Moon radii and orbital
 * distances are true to scale. An orthographic camera is used because, at
 * Jupiter's distance, a telescope sees an essentially parallel projection.
 * Time runs as a labelled time-lapse.
 */
export const RJ_KM = 71_492;
export const TIMELAPSE = 238; // ⇒ Jupiter's 9.925 h day lasts ~150 s

interface MoonDef {
  key: string;
  name: string;
  radiusKm: number;
  orbitRj: number;
  periodH: number;
  phase0: number; // degrees; 0 = directly in front of Jupiter (towards the observer)
  tint: [number, number, number];
}

// Radii, mean orbital distances and periods from NASA planetary fact sheets.
const MOONS: MoonDef[] = [
  { key: 'io', name: 'Io', radiusKm: 1821.6, orbitRj: 5.9, periodH: 42.46, phase0: 150, tint: [1, 1, 1] },
  { key: 'europa', name: 'Europa', radiusKm: 1560.8, orbitRj: 9.4, periodH: 85.23, phase0: -80, tint: [-1, 0, 0] },
  { key: 'ganymede', name: 'Ganymede', radiusKm: 2634.1, orbitRj: 15.0, periodH: 171.7, phase0: 60, tint: [1, 1, 1] },
  { key: 'callisto', name: 'Callisto', radiusKm: 2410.3, orbitRj: 26.3, periodH: 400.5, phase0: -110, tint: [1, 1, 1] },
];

// Great Red Spot location on the Cassini map (measured from PIA07782): u, v.
const GRS_UV = { u: 0.364, v: 0.606 };
export const GRS_RADIUS_RJ = 0.115; // ≈ 16,000 km across

export const FIELD_MIN = 0.05; // smallest field height (Rj): maximum zoom
export const FIELD_MAX = 24;
const PAN_LIMIT = new THREE.Vector2(30, 13);

const SUN_DIR = new THREE.Vector3(-0.16, 0.04, 1).normalize(); // near opposition: almost full phase

const bodyMaterial = (map: THREE.Texture | null, tint: [number, number, number], limbPower: number) =>
  new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      hasMap: { value: map ? 1 : 0 },
      tint: { value: new THREE.Vector3(...tint) },
      sunDir: { value: SUN_DIR },
      limbPower: { value: limbPower },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN;
      void main() {
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float hasMap; uniform vec3 tint; uniform vec3 sunDir; uniform float limbPower;
      varying vec2 vUv; varying vec3 vN;
      void main() {
        vec3 n = normalize(vN);
        vec3 base = hasMap > 0.5 ? texture2D(map, vUv).rgb : vec3(0.75, 0.65, 0.5);
        // tint.x < 0 marks a greyscale map that gets two-tone colouring (Europa: bright ice, red-brown lineae)
        if (tint.x < 0.0) { float l = dot(base, vec3(0.333)); base = mix(vec3(0.30, 0.16, 0.09), vec3(0.92, 0.89, 0.84), smoothstep(0.05, 0.75, l)); }
        else base *= tint; // sRGB textures are decoded to linear by the GPU
        float ndl = max(dot(n, sunDir), 0.0);
        float mu = max(n.z, 0.0);              // towards the observer (camera looks down -z)
        float limb = pow(mu, limbPower);         // limb darkening
        gl_FragColor = vec4(base * (0.02 + 1.15 * ndl) * mix(0.55, 1.0, limb), 1.0);
      }`,
  });

/** Post-process that turns the render into a telescope camera feed. */
const ScopeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    blur: { value: 0 },
    gain: { value: 1 },
    noise: { value: 0.02 },
    time: { value: 0 },
    boot: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 resolution; uniform float blur; uniform float gain;
    uniform float noise; uniform float time; uniform float boot;
    varying vec2 vUv;
    const vec2 DISK[16] = vec2[16](
      vec2(-0.94,-0.40), vec2(0.95,-0.77), vec2(-0.09,-0.93), vec2(0.34,0.29),
      vec2(-0.92,0.46), vec2(-0.82,0.15), vec2(0.97,0.76), vec2(0.44,-0.87),
      vec2(0.54,0.97), vec2(-0.26,-0.42), vec2(-0.27,0.53), vec2(0.79,0.19),
      vec2(-0.38,0.92), vec2(0.14,-0.18), vec2(-0.71,-0.71), vec2(0.0,0.0));
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    void main() {
      vec2 px = blur / resolution;
      vec3 c = vec3(0.0);
      if (blur < 0.4) {
        c = texture2D(tDiffuse, vUv).rgb;
      } else {
        // slight colour fringing grows with defocus, like real optics
        for (int i = 0; i < 16; i++) {
          vec2 o = DISK[i] * px;
          c.r += texture2D(tDiffuse, vUv + o * 1.04).r;
          c.g += texture2D(tDiffuse, vUv + o).g;
          c.b += texture2D(tDiffuse, vUv + o * 0.96).b;
        }
        c /= 16.0;
      }
      c *= gain;
      c = aces(c * 1.6);
      // sensor read noise: stronger when underexposed
      float g = hash(vUv * resolution + fract(time) * 100.0) - 0.5;
      c += g * noise;
      // vignette + faint row banding from the readout
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * 0.55;
      c *= 0.985 + 0.015 * sin(vUv.y * resolution.y * 1.2);
      // boot flicker
      c *= mix(1.0, step(0.5, hash(vec2(floor(time * 30.0), 1.0))) * 0.6 + 0.4, boot);
      c = pow(max(c, 0.0), vec3(1.0 / 2.2));
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export interface BodyInfo {
  key: string;
  name: string;
  pos: THREE.Vector3;
  radius: number;
  visible: boolean; // not hidden behind Jupiter
}

export class JupiterStage implements Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private composer: EffectComposer;
  private scope: ShaderPass;
  private jupiter: THREE.Mesh;
  private moons: { def: MoonDef; mesh: THREE.Mesh; phase: number }[] = [];
  private aspect = 16 / 9;

  /** Pointing (Rj) and zoom (field height in Rj). Smoothed toward targets. */
  readonly center = new THREE.Vector2(5.5, 2.6);
  readonly centerTarget = this.center.clone();
  fieldH = 9;
  fieldTarget = 9;
  /** Optics state, 0..1. */
  focus = 0.18;
  exposure = 0.5;
  timeScale = 1; // extra speed-up multiplier on top of TIMELAPSE
  paused = false;
  private bootT = 1;
  private elapsed = 0;
  private pendingCapture: ((url: string) => void) | null = null;

  constructor(assets: Assets, renderer: THREE.WebGLRenderer) {
    this.scene.background = new THREE.Color(0x000000);
    this.camera.position.set(0, 0, 100);

    this.jupiter = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), bodyMaterial(assets.textures.jupiter ?? null, [1, 1, 1], 0.45));
    this.jupiter.scale.set(1, 0.935, 1); // Jupiter's oblateness (polar radius ≈ 0.935 equatorial)
    this.jupiter.rotation.y = -1.25; // start with the Great Red Spot behind the eastern limb
    this.scene.add(this.jupiter);

    for (const def of MOONS) {
      const r = def.radiusKm / RJ_KM;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), bodyMaterial(assets.textures[def.key] ?? null, def.tint, 0.25));
      this.scene.add(mesh);
      this.moons.push({ def, mesh, phase: THREE.MathUtils.degToRad(def.phase0) });
    }

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.scope = new ShaderPass(ScopeShader);
    this.composer.addPass(this.scope);
    this.update(0);
  }

  /** Best focus shifts with zoom, so players must refocus after zooming. */
  bestFocus(field = this.fieldH) {
    return 0.5 + 0.22 * Math.sin(Math.log(field) * 1.7 + 0.6);
  }
  focusError() {
    return Math.abs(this.focus - this.bestFocus());
  }
  /** Exposure → gain (×0.18 … ×5.6). */
  gain() {
    return Math.pow(2, (this.exposure - 0.5) * 5);
  }
  exposureSeconds() {
    return 0.35 * this.gain();
  }
  /** Arcseconds per Rj at a typical Earth–Jupiter distance (~4.4 AU): Jupiter ≈ 45″ across. */
  fieldArcsec() {
    return this.fieldH * 22.4;
  }

  pan(dxRj: number, dyRj: number) {
    this.centerTarget.x = THREE.MathUtils.clamp(this.centerTarget.x + dxRj, -PAN_LIMIT.x, PAN_LIMIT.x);
    this.centerTarget.y = THREE.MathUtils.clamp(this.centerTarget.y + dyRj, -PAN_LIMIT.y, PAN_LIMIT.y);
  }
  zoomBy(factor: number) {
    this.fieldTarget = THREE.MathUtils.clamp(this.fieldTarget * factor, FIELD_MIN, FIELD_MAX);
  }

  /** Angle of the Great Red Spot from the central meridian: 0 = facing us, + = towards the right limb. */
  grsAngle() {
    return Math.atan2(this.grsNormal().x, this.grsNormal().z);
  }
  private grsNormal() {
    const phi = GRS_UV.u * Math.PI * 2;
    const theta = GRS_UV.v * Math.PI;
    const local = new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
    return local.applyQuaternion(this.jupiter.quaternion).normalize();
  }
  grs(): BodyInfo {
    const n = this.grsNormal();
    const pos = n.clone().multiply(this.jupiter.scale);
    return { key: 'grs', name: 'Great Red Spot', pos, radius: GRS_RADIUS_RJ * Math.max(n.z, 0.2), visible: n.z > 0.25 };
  }
  body(key: string): BodyInfo {
    if (key === 'jupiter') return { key, name: 'Jupiter', pos: new THREE.Vector3(), radius: 1, visible: true };
    const m = this.moons.find((x) => x.def.key === key)!;
    const p = m.mesh.position;
    const hidden = p.z < 0 && Math.hypot(p.x, p.y / 0.935) < 1 + m.def.radiusKm / RJ_KM;
    return { key, name: m.def.name, pos: p.clone(), radius: m.def.radiusKm / RJ_KM, visible: !hidden };
  }
  /** Moons currently in the field of view (for HUD labels). */
  bodiesInView(): BodyInfo[] {
    const halfW = (this.fieldH * this.aspect) / 2, halfH = this.fieldH / 2;
    return ['jupiter', ...MOONS.map((m) => m.key)].map((k) => this.body(k)).filter((b) => b.visible && Math.abs(b.pos.x - this.center.x) < halfW && Math.abs(b.pos.y - this.center.y) < halfH);
  }
  /** World (Rj) → normalised screen coords (0..1, y down). */
  toScreen(p: THREE.Vector3) {
    return { x: 0.5 + (p.x - this.center.x) / (this.fieldH * this.aspect), y: 0.5 - (p.y - this.center.y) / this.fieldH };
  }

  /** Grab the next rendered frame as a JPEG data URL. */
  capture(): Promise<string> {
    return new Promise((resolve) => (this.pendingCapture = resolve));
  }

  update(dt: number) {
    if (!this.paused) {
      const sim = dt * TIMELAPSE * this.timeScale;
      this.jupiter.rotation.y += (sim / (9.925 * 3600)) * Math.PI * 2;
      for (const m of this.moons) {
        m.phase += (sim / (m.def.periodH * 3600)) * Math.PI * 2;
        m.mesh.position.set(Math.sin(m.phase) * m.def.orbitRj, 0, Math.cos(m.phase) * m.def.orbitRj);
        m.mesh.rotation.y = m.phase; // tidally locked
      }
    }
    this.elapsed += dt;
    // Slew + zoom smoothing (Hubble slews smoothly, never snaps).
    const k = 1 - Math.exp(-dt * 7);
    this.center.lerp(this.centerTarget, k);
    this.fieldH += (this.fieldTarget - this.fieldH) * (1 - Math.exp(-dt * 8));
    this.bootT = Math.max(0, this.bootT - dt * 1.4);

    const halfH = this.fieldH / 2, halfW = halfH * this.aspect;
    this.camera.left = this.center.x - halfW;
    this.camera.right = this.center.x + halfW;
    this.camera.top = this.center.y + halfH;
    this.camera.bottom = this.center.y - halfH;
    this.camera.updateProjectionMatrix();

    const u = this.scope.uniforms;
    u.blur.value = Math.min(16, this.focusError() * 110);
    u.gain.value = this.gain();
    u.noise.value = 0.018 + Math.max(0, 0.5 - this.exposure) * 0.12;
    u.time.value = this.elapsed;
    u.boot.value = this.bootT;
  }

  render(renderer: THREE.WebGLRenderer) {
    this.composer.render();
    if (this.pendingCapture) {
      const cb = this.pendingCapture;
      this.pendingCapture = null;
      cb(renderer.domElement.toDataURL('image/jpeg', 0.88));
    }
  }

  resize(w: number, h: number) {
    this.aspect = w / h;
    this.composer.setPixelRatio(this.composer.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.scope.uniforms.resolution.value.set(w, h);
  }

  dispose() {
    this.composer.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }
}
