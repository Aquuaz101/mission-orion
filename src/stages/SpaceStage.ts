import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Stage } from '../core/Engine';
import type { Assets } from '../core/Assets';
import { createStarSphere, glowTexture, ORION, ORION_LINES, raDecToDir } from './sky';

export type SpaceShot = 'loading' | 'menu' | 'select' | 'depart';

interface Shot { pos: THREE.Vector3; look: THREE.Vector3; fov: number }

const SHOTS: Record<SpaceShot, Shot> = {
  loading: { pos: new THREE.Vector3(0, 9, 46), look: new THREE.Vector3(0, 16, 0), fov: 42 },
  menu: { pos: new THREE.Vector3(0, 1.2, 25), look: new THREE.Vector3(0, 1.4, 0), fov: 45 },
  select: { pos: new THREE.Vector3(-3, 0.2, 21), look: new THREE.Vector3(2, 1.8, 0), fov: 48 },
  depart: { pos: new THREE.Vector3(0, 6, 4), look: new THREE.Vector3(0, 9, -40), fov: 60 },
};

const EARTH_R = 11;
const EARTH_POS = new THREE.Vector3(0, -13.2, 0);
// Sun just past Earth's right limb from the menu camera: an orbital sunrise.
const SUN_DIR = new THREE.Vector3(0.39, -0.185, -1).normalize();

/**
 * The "home" scene behind loading, menus and mission select: the real sky
 * (NASA Tycho star map) with Orion highlighted, Earth from orbit (NASA Blue
 * Marble day side, Black Marble city lights at night) and the rising Sun.
 */
export class SpaceStage implements Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 3000);
  private composer: EffectComposer;
  private sky: THREE.Mesh;
  private skyGroup = new THREE.Group();
  private earth: THREE.Mesh;
  private atmosphere: THREE.Mesh;
  private orionLines: THREE.LineSegments;
  private orionStars: THREE.Points;
  private dust: THREE.Points;
  private sun: THREE.Group;

  private shot: Shot = { pos: SHOTS.loading.pos.clone(), look: SHOTS.loading.look.clone(), fov: SHOTS.loading.fov };
  private target: Shot = SHOTS.loading;
  private lookCur = SHOTS.loading.look.clone();
  private lerpSpeed = 0.6;
  private orionHighlight = 1;
  private orionTarget = 1;

  constructor(assets: Assets, renderer: THREE.WebGLRenderer) {
    this.camera.position.copy(this.shot.pos);

    // ── Real sky, rotated so Orion sits above Earth's limb in the menu view.
    this.sky = createStarSphere(assets.textures.stars!, 1000, 1.9);
    this.skyGroup.add(this.sky);
    const orionCenter = raDecToDir(5.6, -0.5);
    const want = new THREE.Vector3(0.36, 0.2, -1).normalize();
    this.skyGroup.quaternion.setFromUnitVectors(orionCenter, want);
    this.scene.add(this.skyGroup);

    // ── Orion overlay: brighter halos on the real star positions + faint stick figure.
    const starPos: number[] = [], starCol: number[] = [], starSize: number[] = [];
    const c = new THREE.Color();
    for (const s of ORION) {
      const d = raDecToDir(s.ra, s.dec).multiplyScalar(990);
      starPos.push(d.x, d.y, d.z);
      c.setHex(s.color);
      starCol.push(c.r, c.g, c.b);
      starSize.push(THREE.MathUtils.clamp(26 - s.mag * 5.5, 8, 26));
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute(starCol, 3));
    sg.setAttribute('size', new THREE.Float32BufferAttribute(starSize, 1));
    this.orionStars = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: { map: { value: glowTexture(128, [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,255,255,0.85)'], [0.35, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']]) }, opacity: { value: 1 }, time: { value: 0 }, pr: { value: renderer.getPixelRatio() } },
      vertexShader: /* glsl */ `
        attribute float size; varying vec3 vCol; uniform float time; uniform float pr;
        void main() {
          vCol = color;
          float tw = 0.88 + 0.12 * sin(time * 2.3 + position.x * 0.05);
          gl_PointSize = size * pr * tw;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform float opacity; varying vec3 vCol;
        void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vCol * t.rgb * 1.6, t.a * opacity); }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }));
    this.orionStars.frustumCulled = false;
    this.skyGroup.add(this.orionStars);

    const linePos: number[] = [];
    for (const [a, b] of ORION_LINES) {
      const pa = raDecToDir(ORION[a].ra, ORION[a].dec).multiplyScalar(985);
      const pb = raDecToDir(ORION[b].ra, ORION[b].dec).multiplyScalar(985);
      // shorten each segment so lines don't touch the stars
      const da = pa.clone().lerp(pb, 0.08), db = pb.clone().lerp(pa, 0.08);
      linePos.push(da.x, da.y, da.z, db.x, db.y, db.z);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    this.orionLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }));
    this.orionLines.frustumCulled = false;
    this.skyGroup.add(this.orionLines);

    // ── Earth (day/night shader).
    const sunUniform = { value: SUN_DIR.clone() };
    const earthMat = new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: assets.textures.earthDay ?? null },
        nightMap: { value: assets.textures.earthNight ?? null },
        hasDay: { value: assets.textures.earthDay ? 1 : 0 },
        hasNight: { value: assets.textures.earthNight ? 1 : 0 },
        sunDir: sunUniform,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vView;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vView = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D dayMap; uniform sampler2D nightMap; uniform float hasDay; uniform float hasNight; uniform vec3 sunDir;
        varying vec2 vUv; varying vec3 vN; varying vec3 vView;
        void main() {
          vec3 n = normalize(vN);
          float ndl = dot(n, sunDir);
          float dayMix = smoothstep(-0.12, 0.22, ndl);
          vec3 day = hasDay > 0.5 ? texture2D(dayMap, vUv).rgb : vec3(0.08, 0.2, 0.45);
          vec3 night = hasNight > 0.5 ? texture2D(nightMap, vUv).rgb : vec3(0.0);
          // ocean glint: blue-dominant pixels get a sun specular
          float ocean = smoothstep(0.05, 0.25, day.b - day.r);
          vec3 h = normalize(sunDir + vView);
          float spec = pow(max(dot(n, h), 0.0), 60.0) * ocean * 0.9;
          vec3 lit = day * (0.06 + 1.25 * max(ndl, 0.0)) + vec3(1.0, 0.9, 0.75) * spec;
          vec3 lights = pow(night, vec3(1.6)) * vec3(1.0, 0.78, 0.45) * 2.4 * (1.0 - dayMix);
          // warm band along the terminator, blue haze toward the limb
          float term = exp(-pow(ndl * 7.0, 2.0)) * 0.35;
          float rim = pow(1.0 - max(dot(n, vView), 0.0), 3.0);
          vec3 col = mix(lights, lit, dayMix) + vec3(1.0, 0.45, 0.15) * term * dayMix;
          col += vec3(0.25, 0.5, 1.0) * rim * (0.15 + 0.85 * smoothstep(-0.2, 0.4, ndl));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 128, 64), earthMat);
    this.earth.position.copy(EARTH_POS);
    this.earth.rotation.set(0.35, -1.9, 0.1); // Europe/Africa near the terminator
    this.scene.add(this.earth);

    // Atmosphere halo: analytic, from each view ray's closest approach to Earth's centre,
    // so it fades smoothly from the limb outward (no visible shell edge).
    const ATMO_R = EARTH_R * 1.06;
    const atmoMat = new THREE.ShaderMaterial({
      uniforms: { sunDir: sunUniform, center: { value: EARTH_POS }, rIn: { value: EARTH_R }, rOut: { value: ATMO_R } },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 sunDir; uniform vec3 center; uniform float rIn; uniform float rOut;
        varying vec3 vWorld;
        void main() {
          vec3 rd = normalize(vWorld - cameraPosition);
          vec3 oc = center - cameraPosition;
          float tca = dot(oc, rd);
          vec3 closest = cameraPosition + rd * tca;
          float d = length(closest - center);
          float t = clamp((rOut - d) / (rOut - rIn), 0.0, 1.0);
          float glow = pow(t, 2.2) * step(rIn * 0.995, d);
          vec3 n = normalize(closest - center);
          float sl = dot(n, sunDir);
          float lit = smoothstep(-0.45, 0.35, sl);
          vec3 col = mix(vec3(1.0, 0.42, 0.16), vec3(0.32, 0.62, 1.0), smoothstep(-0.1, 0.45, sl));
          // forward scattering: much brighter where the Sun is behind the limb
          float fwd = pow(max(dot(rd, sunDir), 0.0), 8.0) * 2.5;
          gl_FragColor = vec4(col * glow * lit * (0.9 + fwd), 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(ATMO_R, 128, 64), atmoMat);
    this.atmosphere.position.copy(EARTH_POS);
    this.scene.add(this.atmosphere);

    // ── Sun: core + wide halo (bloom does the rest).
    this.sun = new THREE.Group();
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(256, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,250,235,1)'], [0.45, 'rgba(255,220,170,0.35)'], [1, 'rgba(255,200,140,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    core.scale.setScalar(38);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(256, [[0, 'rgba(255,248,236,0.55)'], [0.22, 'rgba(255,240,220,0.09)'], [1, 'rgba(255,235,210,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    halo.scale.setScalar(300);
    this.sun.add(halo, core);
    this.scene.add(this.sun);

    // ── Drifting dust motes near the camera (depth + motion).
    const N = 500;
    const dp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      dp[i * 3] = (Math.random() - 0.5) * 60;
      dp[i * 3 + 1] = (Math.random() - 0.5) * 40 + 4;
      dp[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.05, map: glowTexture(64), color: 0x9fb8d8, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.dust);

    // ── Post-processing: subtle bloom for the Sun, atmosphere and Orion.
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.7, 0.78));
    this.composer.addPass(new OutputPass());
  }

  setShot(name: SpaceShot, speed = 0.6) {
    this.target = SHOTS[name];
    this.lerpSpeed = speed;
  }

  /** 1 = Orion stick-figure visible, 0 = hidden (stars stay). */
  setOrionHighlight(v: number) {
    this.orionTarget = v;
  }

  update(dt: number, t: number) {
    // Critically-damped style easing toward the target shot.
    const k = 1 - Math.exp(-dt * this.lerpSpeed * 2.2);
    this.shot.pos.lerp(this.target.pos, k);
    this.lookCur.lerp(this.target.look, k);
    this.shot.fov += (this.target.fov - this.shot.fov) * k;

    // gentle handheld drift
    const drift = new THREE.Vector3(Math.sin(t * 0.13) * 0.25, Math.sin(t * 0.17) * 0.15, 0);
    this.camera.position.copy(this.shot.pos).add(drift);
    this.camera.lookAt(this.lookCur);
    if (Math.abs(this.camera.fov - this.shot.fov) > 0.01) {
      this.camera.fov = this.shot.fov;
      this.camera.updateProjectionMatrix();
    }

    this.skyGroup.position.copy(this.camera.position);
    this.sun.position.copy(this.camera.position).addScaledVector(SUN_DIR, 900);

    this.earth.rotation.y += dt * 0.006;
    this.orionHighlight += (this.orionTarget - this.orionHighlight) * (1 - Math.exp(-dt * 1.5));
    (this.orionLines.material as THREE.LineBasicMaterial).opacity = 0.32 * this.orionHighlight;
    const om = this.orionStars.material as THREE.ShaderMaterial;
    om.uniforms.time.value = t;
    om.uniforms.opacity.value = 0.55 + 0.45 * this.orionHighlight;

    const p = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      let z = p.getZ(i) + dt * 0.8;
      if (z > 30) z -= 60;
      p.setZ(i, z);
    }
    p.needsUpdate = true;
    this.dust.position.set(this.camera.position.x, 0, this.camera.position.z - 20);
  }

  render() {
    this.composer.render();
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
  }

  dispose() {
    this.composer.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
  }
}
