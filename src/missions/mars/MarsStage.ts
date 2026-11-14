import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Stage } from '../../core/Engine';
import type { Assets } from '../../core/Assets';
import { Terrain, makeDetailTextures } from './terrain';
import { rng, rockGeometry, createSpecimen, createAres7, TowCable } from './props';

export const MAX_SPEED = 4.2;   // m/s gameplay top speed (real Perseverance ≈ 0.042 m/s)
const REVERSE_SPEED = 1.8;
const TURN_RATE = 0.85;
const MAX_CLIMB_DEG = 28;
// Afternoon Sun in the north-west, ~28° high: backlit valleys, long shadows toward the player.
export const SUN_DIR = new THREE.Vector3(-0.42, 0.48, -0.84).normalize();

// Linear-space palette (warm, cinematic; output is ACES tone-mapped then graded)
const HORIZON = new THREE.Color().setRGB(0.86, 0.42, 0.13);
const ZENITH = new THREE.Color().setRGB(0.42, 0.15, 0.045);
const FOG = new THREE.Color().setRGB(0.66, 0.31, 0.1);
const STORM_FOG = new THREE.Color().setRGB(0.24, 0.11, 0.05);

// Perseverance geometry (model units = metres)
const WHEELS = [[-1.12, -1.18], [-1.12, 0.02], [-1.12, 1.15], [1.12, -1.18], [1.12, 0.02], [1.12, 1.15]] as const; // [x, z] local
const WHEEL_RADIUS = 0.265;
const BELLY = [[0, 0], [0, 0.9], [0, -0.9], [-0.6, 0], [0.6, 0]] as const;
const BELLY_CLEAR = 0.62;
const REAR_HITCH = new THREE.Vector3(0, 0.6, -1.7);
const TOW_LENGTH = 2.4;

export type ViewMode = 'chase' | 'fp';
export type Quality = 'low' | 'medium' | 'high';
interface CineKey { pos: THREE.Vector3; look: THREE.Vector3 }

/** Per-preset budgets: COD-style scaling of every expensive feature. */
const PRESETS = {
  high: { shadow: 2048, msaa: 4, rays: 36, bloom: true, nearDensity: 28, nearRadius: 52, dust: 3000, medRocks: 2200, grain: 0.035 },
  medium: { shadow: 1536, msaa: 2, rays: 24, bloom: true, nearDensity: 20, nearRadius: 44, dust: 1800, medRocks: 1500, grain: 0.03 },
  low: { shadow: 1024, msaa: 0, rays: 0, bloom: false, nearDensity: 11, nearRadius: 34, dust: 900, medRocks: 800, grain: 0 },
} as const;

/** Screen-space light shafts from the Sun (radial blur of the HDR Sun disk; terrain occludes it). */
const GodRaysShader = {
  uniforms: { tDiffuse: { value: null }, sun: { value: new THREE.Vector2(0.5, 0.5) }, strength: { value: 0 }, threshold: { value: 1.6 }, samples: { value: 40 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 sun; uniform float strength; uniform float threshold; uniform int samples; varying vec2 vUv;
    void main(){
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      if (strength < 0.001 || samples == 0) { gl_FragColor = vec4(base, 1.0); return; }
      vec2 delta = (vUv - sun) * (0.92 / float(samples));
      vec2 uv = vUv; float decay = 1.0; vec3 acc = vec3(0.0);
      for (int i = 0; i < 40; i++) {
        if (i >= samples) break;
        uv -= delta;
        vec3 s = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
        float l = min(max(dot(s, vec3(0.3, 0.59, 0.11)) - threshold, 0.0), 4.0);
        acc += vec3(l) * decay;
        decay *= 0.955;
      }
      gl_FragColor = vec4(base + acc * strength * (0.48 / float(samples)) * vec3(1.0, 0.8, 0.55), 1.0);
    }`,
};

/** Final colour grade (display space): warm split-tone, filmic contrast, vignette, fine grain. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.035 }, storm: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float grain; uniform float storm; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      // split-tone: cool-violet shadows, golden highlights
      c = mix(c * vec3(0.92, 0.93, 1.05), c * vec3(1.06, 0.99, 0.88), smoothstep(0.1, 0.75, l));
      // gentle S-curve + saturation
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.28);
      c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.08 - storm * 0.25);
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * (0.75 + storm * 0.6);
      c += (hash(vUv * 1000.0 + fract(time) * 37.0) - 0.5) * grain;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/** Sun-tinted aerial perspective: fog brightens toward the Sun (forward scattering). Patched once, globally. */
let fogPatched = false;
function patchSunFog() {
  if (fogPatched) return;
  fogPatched = true;
  const s = SUN_DIR;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 fogTint = fogColor;
  #if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
    vec3 sunV = normalize( ( viewMatrix * vec4( ${s.x.toFixed(4)}, ${s.y.toFixed(4)}, ${s.z.toFixed(4)}, 0.0 ) ).xyz );
    float scatter = pow( max( dot( normalize( -vViewPosition ), sunV ), 0.0 ), 5.0 );
    fogTint = mix( fogColor, fogColor * vec3( 1.75, 1.45, 1.05 ), scatter );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );
#endif`;
}

export class MarsStage implements Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.05, 4000);
  readonly terrain: Terrain;
  private composer: EffectComposer;
  private rays: ShaderPass;
  private grade: ShaderPass;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private skyMat: THREE.ShaderMaterial;
  private fog: THREE.FogExp2;
  private mesaMats: { mat: THREE.MeshBasicMaterial; base: THREE.Color }[] = [];
  private preset: (typeof PRESETS)[Quality];

  // rover
  readonly rover = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private armMixer: THREE.AnimationMixer | null = null;
  private shoulder: THREE.Object3D | null = null;
  private turret: THREE.Object3D | null = null;
  private head: THREE.Object3D | null = null;
  private headBase = new THREE.Quaternion();
  private headAxis = new THREE.Vector3(0, 1, 0);
  private shoulderAxis = new THREE.Vector3(1, 0, 0);
  private armAngle = 0;
  private armDown = 1.2;
  private pickupLocal = new THREE.Vector3(0.3, 0, 2.1);
  private armTime = 0;
  private wheels: { pivot: THREE.Object3D; x: number }[] = [];
  private wheelSplit: { group: THREE.Object3D; originals: THREE.Mesh[]; added: THREE.Object3D[] } | null = null;
  private lastPose = { x: 0, z: 0, yaw: 0, set: false };
  private aresLast = new THREE.Vector3();
  readonly roverPos = new THREE.Vector3();
  roverYaw = 0;
  speed = 0;
  blocked = false;
  distance = 0;
  sandiness = 0;
  private pitch = 0;
  private roll = 0;
  private lift = 0;
  readonly boulders: { x: number; z: number; r: number }[] = [];
  private rockMeshes: THREE.InstancedMesh[] = [];
  private rockMat: THREE.MeshStandardMaterial;
  private rockGeos: THREE.BufferGeometry[];
  private near: { pebbles: THREE.InstancedMesh; stones: THREE.InstancedMesh; cx: number; cz: number } | null = null;
  private cleared: { x: number; z: number; r: number }[] = [];

  // camera
  view: ViewMode = 'chase';
  lookYaw = 0;
  lookPitch = 0.22;
  camDist = 9;
  private camYaw = 0;
  private camPos = new THREE.Vector3();
  private lookCur = new THREE.Vector3();
  private lastLookInput = -10;
  autoRecentre = true;
  private cine: { keys: CineKey[]; t: number; dur: number; resolve: () => void } | null = null;
  private orbit: { center: THREE.Vector3; radius: number; height: number; angle: number; speed: number } | null = null;

  // effects
  storm = 0;
  stormFront = 0;
  rayStrength = 0.8;
  exposure = 1.08;
  private dust: THREE.Points;
  private puffs: THREE.Points;
  private puffData: { life: Float32Array; vel: Float32Array; size: Float32Array; next: number };
  private tracks: { mesh: THREE.Mesh; idx: number; last: THREE.Vector3 | null; count: number };
  private wall: THREE.Mesh;
  readonly specimens = new Map<string, THREE.Object3D>();
  readonly ares = createAres7();
  readonly cable = new TowCable();
  towing = false;
  private elapsed = 0;
  paused = false;

  constructor(assets: Assets, renderer: THREE.WebGLRenderer, quality: Quality) {
    patchSunFog();
    this.preset = PRESETS[quality];
    const detail = makeDetailTextures();
    this.terrain = new Terrain(assets, detail);
    this.scene.add(this.terrain.group);

    // ── Sky: warm gradient, big hazy Sun, faint high streak clouds (Mars has thin water-ice clouds)
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: SUN_DIR }, storm: { value: 0 }, horizon: { value: HORIZON.clone() }, zenith: { value: ZENITH.clone() }, time: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 sunDir; uniform float storm; uniform vec3 horizon; uniform vec3 zenith; uniform float time; varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.1; a *= 0.5; } return v; }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.42));
          col = mix(col, horizon * 1.15, smoothstep(0.08, -0.02, h)); // bright haze band at the horizon
          float sd = max(dot(d, sunDir), 0.0);
          col += vec3(1.0, 0.72, 0.38) * pow(sd, 3.0) * 0.55;          // wide warm glow
          col += vec3(1.0, 0.86, 0.6) * pow(sd, 32.0) * 1.6;            // halo
          col += vec3(0.55, 0.68, 0.95) * pow(sd, 220.0) * 1.2;         // bluish inner aureole (seen in rover images)
          col += vec3(1.0, 0.98, 0.94) * smoothstep(0.9993, 0.9997, sd) * 30.0; // Sun disk
          // streak clouds (stretched fbm), lit from the Sun side
          vec2 cp = d.xz / max(d.y + 0.12, 0.05);
          float cl = fbm(vec2(cp.x * 0.35 + time * 0.004, cp.y * 1.6));
          cl = smoothstep(0.55, 0.85, cl) * smoothstep(0.02, 0.25, h) * (1.0 - smoothstep(0.6, 1.0, h));
          col = mix(col, col * 1.18 + vec3(0.08, 0.04, 0.01) * (0.5 + sd), cl * 0.55);
          vec3 stormCol = mix(vec3(0.24, 0.11, 0.05), vec3(0.12, 0.055, 0.03), max(h, 0.0)) + vec3(0.5, 0.32, 0.16) * pow(sd, 8.0) * 0.35;
          gl_FragColor = vec4(mix(col, stormCol, storm), 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3500, 48, 24), this.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.scene.add(sky);

    this.fog = new THREE.FogExp2(FOG.clone(), 0.0042);
    this.scene.fog = this.fog;
    this.buildMesaLayers();
    this.scene.add(this.buildOuterGround());

    this.sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1.0, 0.8, 0.58), 4.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.preset.shadow, this.preset.shadow);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -34; sc.right = sc.top = 34; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(new THREE.Color().setRGB(0.75, 0.45, 0.28), new THREE.Color().setRGB(0.32, 0.13, 0.06), 0.6);
    this.scene.add(this.hemi);

    // Rock material: photographed rock surface (Poly Haven CC0) tinted per instance
    const rd = assets.textures.rockDiff ?? null;
    this.rockMat = new THREE.MeshStandardMaterial({ map: rd, normalMap: assets.textures.rockNor ?? null, roughnessMap: assets.textures.rockArm ?? null, roughness: 1, metalness: 0, color: 0xffffff });
    // LOD by role: boulders get the detailed mesh; near-field pebbles/stones and mid rocks use 80-tri meshes
    this.rockGeos = [rockGeometry(1, 1), rockGeometry(2, 1, 0.55), rockGeometry(3, 2, 0.75), rockGeometry(4, 1, 0.6)];
    this.scatterRocks();
    this.near = this.buildNearField();
    this.setupRover(assets);

    this.scene.add(this.ares.group, this.cable.mesh);
    this.ares.group.visible = false;
    this.ares.setDust(1);
    this.ares.setWings(0);

    this.dust = this.buildDust();
    const p = this.buildPuffs();
    this.puffs = p.points;
    this.puffData = p.data;
    this.tracks = this.buildTracks();
    this.wall = this.buildStormWall();
    this.scene.add(this.dust, this.puffs, this.tracks.mesh, this.wall);

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.preset.msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.rays = new ShaderPass(GodRaysShader);
    this.rays.uniforms.samples.value = this.preset.rays;
    this.rays.enabled = this.preset.rays > 0;
    this.composer.addPass(this.rays);
    if (this.preset.bloom) this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.75, 0.88));
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.grain.value = this.preset.grain;
    this.composer.addPass(this.grade);
  }

  // ─────────────────────────────────────────── world building
  /** Layered mesa silhouettes (flat tops, cliff sides) fading into the haze: depth and scale. */
  private buildMesaLayers() {
    const layers = [
      { r: 760, minH: 30, maxH: 120, seed: 11, color: new THREE.Color().setRGB(0.3, 0.12, 0.05), n: 9 },
      { r: 1350, minH: 50, maxH: 190, seed: 23, color: new THREE.Color().setRGB(0.46, 0.2, 0.08), n: 8 },
      { r: 2300, minH: 70, maxH: 260, seed: 37, color: new THREE.Color().setRGB(0.62, 0.29, 0.1), n: 7 },
    ];
    for (const L of layers) {
      const r = rng(L.seed);
      const mesas = Array.from({ length: L.n }, () => ({ c: r() * Math.PI * 2, w: 0.12 + r() * 0.2, h: L.minH + r() * (L.maxH - L.minH), edge: 0.02 + r() * 0.035 }));
      const seg = 512;
      const geo = new THREE.CylinderGeometry(L.r, L.r, 1, seg, 1, true);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const a = Math.atan2(pos.getZ(i), pos.getX(i));
        let h = L.minH * 0.2 * (0.6 + 0.4 * Math.sin(a * 13 + L.seed));
        for (const m of mesas) {
          const d = Math.abs(Math.atan2(Math.sin(a - m.c), Math.cos(a - m.c)));
          const plateau = THREE.MathUtils.smoothstep(m.w + m.edge, m.w, d); // flat top, steep sides
          const talus = THREE.MathUtils.smoothstep(m.w + m.edge * 5, m.w + m.edge, d) * 0.3; // scree slope at the base
          h = Math.max(h, m.h * Math.max(plateau, talus) * (0.94 + 0.06 * Math.sin(a * 90)));
        }
        pos.setY(i, pos.getY(i) > 0 ? h : -60);
      }
      const mat = new THREE.MeshBasicMaterial({ color: L.color.clone(), fog: false, side: THREE.BackSide });
      this.mesaMats.push({ mat, base: L.color.clone() });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 16;
      mesh.renderOrder = -0.5;
      this.scene.add(mesh);
    }
  }

  private buildOuterGround() {
    const g = new THREE.RingGeometry(330, 3000, 64, 4);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.27, 0.12, 0.06), roughness: 1 }));
    m.position.y = 18;
    return m;
  }

  /** Medium rocks + boulders across the map (4×4 instanced cells, frustum-culled per cell). */
  private scatterRocks() {
    const r = rng(2026);
    const t = this.terrain;
    const half = t.size / 2 - 4;
    const CELLS = 4, cell = (half * 2) / CELLS;
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const classes = [
      { count: this.preset.medRocks, min: 0.35, max: 1.0, shadow: false, geo: 1, collide: false },
      { count: 260, min: 0.9, max: 2.6, shadow: true, geo: 2, collide: true },
    ];
    for (let cy = 0; cy < CELLS; cy++) for (let cx = 0; cx < CELLS; cx++) {
      for (const c of classes) {
        const n = Math.ceil(c.count / (CELLS * CELLS));
        const inst = new THREE.InstancedMesh(this.rockGeos[c.geo], this.rockMat, n);
        let k = 0, guard = 0;
        while (k < n && guard++ < n * 25) {
          const x = -half + (cx + r()) * cell, z = -half + (cy + r()) * cell;
          const rock = t.rockiness(x, z), slope = t.slopeAt(x, z);
          if (r() > 0.3 + rock * 0.7 + Math.min(slope, 30) / 60) continue;
          if (c.collide && slope > 24) continue;
          const s = c.min * Math.pow(c.max / c.min, Math.pow(r(), 2.4));
          dummy.position.set(x, t.heightAt(x, z) - s * 0.3, z);
          dummy.rotation.set(r() * 0.6, r() * Math.PI * 2, r() * 0.6);
          dummy.scale.set(s * (0.75 + r() * 0.6), s * (0.7 + r() * 0.4), s * (0.75 + r() * 0.6));
          dummy.updateMatrix();
          inst.setMatrixAt(k, dummy.matrix);
          rockTint(tint, r);
          inst.setColorAt(k, tint);
          if (c.collide) this.boulders.push({ x, z, r: s * 0.85 });
          inst.userData[k] = { x, z };
          k++;
        }
        inst.count = k;
        inst.castShadow = c.shadow;
        inst.receiveShadow = true;
        inst.computeBoundingSphere();
        this.rockMeshes.push(inst);
        this.scene.add(inst);
      }
    }
  }

  /**
   * Dense near-field rock carpet around the rover (pebbles → cobbles), like a hero shot of a
   * rocky plain. Rocks are generated deterministically per 8 m cell, so they stay put as you
   * drive; the instance buffers are refilled only when the rover crosses a cell boundary.
   */
  private buildNearField() {
    const cap = Math.ceil(Math.PI * (this.preset.nearRadius / 8) ** 2 * this.preset.nearDensity * 1.2);
    const pebbles = new THREE.InstancedMesh(this.rockGeos[3], this.rockMat, cap);
    const stones = new THREE.InstancedMesh(this.rockGeos[0], this.rockMat, Math.ceil(cap / 4));
    pebbles.castShadow = false;
    stones.castShadow = true;
    pebbles.receiveShadow = stones.receiveShadow = true;
    pebbles.count = stones.count = 0;
    this.scene.add(pebbles, stones);
    return { pebbles, stones, cx: NaN, cz: NaN };
  }

  private refreshNearField(force = false) {
    const nf = this.near!;
    const CELL = 8, R = this.preset.nearRadius;
    const cx = Math.floor(this.roverPos.x / CELL), cz = Math.floor(this.roverPos.z / CELL);
    if (!force && cx === nf.cx && cz === nf.cz) return;
    nf.cx = cx; nf.cz = cz;
    const t = this.terrain, dummy = new THREE.Object3D(), tint = new THREE.Color();
    const span = Math.ceil(R / CELL);
    let np = 0, ns = 0;
    const capP = nf.pebbles.instanceMatrix.count, capS = nf.stones.instanceMatrix.count;
    for (let gz = cz - span; gz <= cz + span; gz++) for (let gx = cx - span; gx <= cx + span; gx++) {
      const ccx = (gx + 0.5) * CELL - this.roverPos.x, ccz = (gz + 0.5) * CELL - this.roverPos.z;
      if (ccx * ccx + ccz * ccz > R * R) continue;
      const r = rng(((gx * 73856093) ^ (gz * 19349663)) >>> 0);
      const mx = (gx + 0.5) * CELL, mz = (gz + 0.5) * CELL;
      const rock = t.rockiness(mx, mz);
      const n = Math.round(this.preset.nearDensity * (0.45 + rock * 1.1));
      for (let i = 0; i < n; i++) {
        const x = gx * CELL + r() * CELL, z = gz * CELL + r() * CELL;
        const big = r() < 0.18;
        const s = big ? 0.18 + Math.pow(r(), 2) * 0.42 : 0.04 + Math.pow(r(), 2.5) * 0.16;
        const rot = r() * 6.283, tilt = r() * 0.5, sy = 0.65 + r() * 0.4;
        if (this.cleared.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < c.r * c.r)) continue;
        if (Math.abs(x) > t.size / 2 - 2 || Math.abs(z) > t.size / 2 - 2) continue;
        dummy.position.set(x, t.heightAt(x, z) - s * 0.25, z);
        dummy.rotation.set(tilt, rot, tilt * 0.5);
        dummy.scale.set(s, s * sy, s * (0.8 + r() * 0.4));
        dummy.updateMatrix();
        rockTint(tint, r);
        if (big && ns < capS) { nf.stones.setMatrixAt(ns, dummy.matrix); nf.stones.setColorAt(ns, tint); ns++; }
        else if (!big && np < capP) { nf.pebbles.setMatrixAt(np, dummy.matrix); nf.pebbles.setColorAt(np, tint); np++; }
      }
    }
    nf.pebbles.count = np; nf.stones.count = ns;
    for (const m of [nf.pebbles, nf.stones]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }

  /** Remove rocks around points (spawn, samples, drive lines) so objectives stay clear. */
  clearAround(points: THREE.Vector3[], radius: number) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const inst of this.rockMeshes) {
      let dirty = false;
      for (let i = 0; i < inst.count; i++) {
        const p = inst.userData[i] as { x: number; z: number } | undefined;
        if (!p) continue;
        if (points.some((q) => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 < radius * radius)) { inst.setMatrixAt(i, zero); dirty = true; }
      }
      if (dirty) inst.instanceMatrix.needsUpdate = true;
    }
    for (let i = this.boulders.length - 1; i >= 0; i--) {
      const b = this.boulders[i];
      if (points.some((q) => (q.x - b.x) ** 2 + (q.z - b.z) ** 2 < (radius + b.r) ** 2)) this.boulders.splice(i, 1);
    }
    // keep sample sites readable: no near-field pebbles right on top of objectives
    this.cleared.push(...points.map((p) => ({ x: p.x, z: p.z, r: 1.6 })));
    this.refreshNearField(true);
  }

  private setupRover(assets: Assets) {
    const g = assets.models.rover;
    if (!g) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1, 3), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
      body.position.y = 1;
      this.rover.add(body);
      this.scene.add(this.rover);
      return;
    }
    const model = g.scene;
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.receiveShadow = true;
      // perf: tiny parts (bolts, cables, lenses) don't need to cast shadows
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const ws = m.getWorldScale(new THREE.Vector3());
      m.castShadow = (m.geometry.boundingSphere?.radius ?? 1) * Math.max(ws.x, ws.y, ws.z) > 0.12;
    });
    this.model = model;
    this.rover.add(model);
    this.scene.add(this.rover);

    this.armMixer = new THREE.AnimationMixer(model);
    for (const clip of g.animations) if (/^(arm|turret|hinge)/i.test(clip.name)) this.armMixer.clipAction(clip).play();
    this.armMixer.setTime(0);
    this.shoulder = model.getObjectByName('arm003') ?? null;
    this.turret = model.getObjectByName('turret_obj') ?? null;
    this.head = model.getObjectByName('head') ?? null;
    if (this.head) {
      this.headBase.copy(this.head.quaternion);
      this.headAxis.copy(axisInParent(this.head, model, new THREE.Vector3(0, 1, 0)));
    }
    if (this.shoulder && this.turret) this.solveArm(model);
    this.splitWheels(model);
    this.mergeStatic(model, g.animations);
  }

  private merged: { meshes: THREE.Mesh[]; hidden: THREE.Mesh[] } | null = null;

  /**
   * Perf: NASA's rover is ~250 separate meshes (≈500 draw calls with shadows). Everything that
   * never moves (body, suspension, instruments) is merged per material into a handful of
   * meshes at load; the arm, mast head and wheels stay separate so they can animate.
   */
  private mergeStatic(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    const dynamic = new Set<THREE.Object3D>();
    // only the clips we actually play (arm/turret/hinge) animate nodes; mast/deploy clips are never used
    for (const clip of clips.filter((c) => /^(arm|turret|hinge)/i.test(c.name))) for (const tr of clip.tracks) {
      const node = model.getObjectByName(tr.name.split('.')[0]);
      if (node) dynamic.add(node);
    }
    for (const n of [this.head, this.turret, this.shoulder, ...this.wheels.map((w) => w.pivot)]) if (n) dynamic.add(n);
    const isDynamic = (o: THREE.Object3D) => {
      for (let p: THREE.Object3D | null = o; p && p !== model; p = p.parent) if (dynamic.has(p)) return true;
      return false;
    };
    model.updateMatrixWorld(true);
    const inv = model.matrixWorld.clone().invert();
    const groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; shadow: boolean }>();
    const hidden: THREE.Mesh[] = [];
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || !m.visible || Array.isArray(m.material) || isDynamic(m)) return;
      if (Object.keys(m.geometry.morphAttributes).length) return;
      const attrs = Object.keys(m.geometry.attributes).sort().join(',');
      const key = `${m.material.uuid}|${attrs}|${m.geometry.index ? 'i' : 'n'}`;
      const geo = m.geometry.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld));
      if (!groups.has(key)) groups.set(key, { mat: m.material, geos: [], shadow: false });
      const g = groups.get(key)!;
      g.geos.push(geo);
      g.shadow ||= m.castShadow;
      hidden.push(m);
    });
    const meshes: THREE.Mesh[] = [];
    for (const g of groups.values()) {
      const merged = g.geos.length === 1 ? g.geos[0] : mergeGeometries(g.geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, g.mat);
      mesh.castShadow = g.shadow;
      mesh.receiveShadow = true;
      model.add(mesh);
      meshes.push(mesh);
    }
    hidden.forEach((m) => (m.visible = false));
    this.merged = { meshes, hidden };
  }

  /**
   * NASA's model stores all six wheels as one mesh group. Split it into six wheels at load
   * (k-means on triangle centroids) and give each its own axle pivot so it can spin.
   */
  private splitWheels(model: THREE.Object3D) {
    const grp = model.getObjectByName('Wheels_objs');
    if (!grp) return;
    const meshes = grp.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
    if (!meshes.length) return;
    const centers = [[1.15, -1.17], [1.15, -0.02], [1.15, 1.12], [-1.15, -1.17], [-1.15, -0.02], [-1.15, 1.12]].map(([x, z]) => new THREE.Vector2(x, z));
    const v = new THREE.Vector3();
    // triangle centroids in group-local space
    const tris: { mesh: number; i0: number; x: number; z: number; k: number }[] = [];
    meshes.forEach((m, mi) => {
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      const idx = m.geometry.index;
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i += 3) {
        let x = 0, z = 0;
        for (let k = 0; k < 3; k++) {
          v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(m.matrix);
          x += v.x; z += v.z;
        }
        tris.push({ mesh: mi, i0: i, x: x / 3, z: z / 3, k: 0 });
      }
    });
    for (let it = 0; it < 8; it++) {
      const sum = centers.map(() => ({ x: 0, z: 0, n: 0 }));
      for (const t of tris) {
        let best = 0, bd = Infinity;
        centers.forEach((c, k) => { const d = (c.x - t.x) ** 2 + (c.y - t.z) ** 2; if (d < bd) { bd = d; best = k; } });
        t.k = best;
        sum[best].x += t.x; sum[best].z += t.z; sum[best].n++;
      }
      sum.forEach((s, k) => { if (s.n) centers[k].set(s.x / s.n, s.z / s.n); });
    }
    const added: THREE.Object3D[] = [];
    for (let k = 0; k < 6; k++) {
      // axle height/position from this wheel's vertex bounds
      const box = new THREE.Box3();
      for (const t of tris) if (t.k === k) {
        const m = meshes[t.mesh], pos = m.geometry.attributes.position as THREE.BufferAttribute, idx = m.geometry.index;
        for (let j = 0; j < 3; j++) box.expandByPoint(v.fromBufferAttribute(pos, idx ? idx.getX(t.i0 + j) : t.i0 + j).applyMatrix4(m.matrix));
      }
      const c = box.getCenter(new THREE.Vector3());
      const pivot = new THREE.Group();
      pivot.position.copy(c);
      const holder = new THREE.Group();
      holder.position.copy(c).multiplyScalar(-1);
      pivot.add(holder);
      meshes.forEach((m, mi) => {
        const list: number[] = [];
        const idx = m.geometry.index;
        for (const t of tris) if (t.k === k && t.mesh === mi) for (let j = 0; j < 3; j++) list.push(idx ? idx.getX(t.i0 + j) : t.i0 + j);
        if (!list.length) return;
        const geo = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(m.geometry.attributes)) geo.setAttribute(name, attr); // shared vertex data
        geo.setIndex(list);
        geo.computeBoundingSphere();
        const part = new THREE.Mesh(geo, m.material);
        part.applyMatrix4(m.matrix);
        part.castShadow = true;
        part.receiveShadow = true;
        holder.add(part);
      });
      grp.add(pivot);
      added.push(pivot);
      this.wheels.push({ pivot, x: c.x });
    }
    meshes.forEach((m) => (m.visible = false));
    this.wheelSplit = { group: grp, originals: meshes, added };
  }

  private solveArm(model: THREE.Object3D) {
    const sh = this.shoulder!, tu = this.turret!;
    this.shoulderAxis.copy(axisInParent(sh, model, new THREE.Vector3(1, 0, 0)));
    const handAt = (angle: number) => {
      this.armMixer!.setTime(6.2);
      sh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(this.shoulderAxis, angle));
      model.updateMatrixWorld(true);
      return model.worldToLocal(tu.getWorldPosition(new THREE.Vector3()));
    };
    const sign = handAt(0.3).y < handAt(0).y ? 1 : -1;
    let lo = 0, hi = 2.2;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (handAt(sign * mid).y > 0.32) lo = mid; else hi = mid;
    }
    this.armDown = sign * lo;
    this.pickupLocal.copy(handAt(this.armDown)).setY(0);
    this.armMixer!.setTime(0);
    model.updateMatrixWorld(true);
  }

  private buildDust() {
    const N = this.preset.dust;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    const r = rng(9);
    for (let i = 0; i < N; i++) { pos[i * 3] = (r() - 0.5) * 120; pos[i * 3 + 1] = r() * 40; pos[i * 3 + 2] = (r() - 0.5) * 120; seed[i] = r(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, storm: { value: 0 }, origin: { value: new THREE.Vector3() }, wind: { value: new THREE.Vector3(10, 0, 5) }, pr: { value: 1 } },
      vertexShader: `
        attribute float seed; uniform float time; uniform float storm; uniform vec3 origin; uniform vec3 wind; uniform float pr; varying float vA;
        void main(){
          vec3 p = position + wind * time * (0.12 + storm * 1.3) * (0.6 + seed);
          p = mod(p - origin + vec3(60.0, 0.0, 60.0), vec3(120.0, 40.0, 120.0)) - vec3(60.0, 0.0, 60.0) + origin;
          p.y = origin.y - 8.0 + mod(position.y + seed * 7.0 + time * (0.25 + storm), 40.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float shown = step(seed, 0.1 + storm * 0.9);
          gl_PointSize = (40.0 + storm * 240.0) * pr / -mv.z * shown;
          vA = shown * (0.12 + storm * 0.4) * smoothstep(90.0, 3.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(0.62, 0.38, 0.2), vA * smoothstep(0.5, 0.0, d)); }`,
      transparent: true,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  private buildStormWall() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, amount: { value: 0 }, dir: { value: new THREE.Vector2(0.7, -0.7) } },
      vertexShader: `varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform float time; uniform float amount; uniform vec2 dir; varying vec2 vUv; varying vec3 vP;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
        void main(){
          float ang = atan(vP.z, vP.x);
          float facing = 0.5 + 0.5 * dot(normalize(vP.xz), normalize(dir));
          float billow = fbm(vec2(ang * 6.0 + time * 0.05, vUv.y * 3.0 - time * 0.12));
          float top = 0.55 + 0.35 * billow * facing;
          float a = smoothstep(top, top - 0.25, vUv.y) * smoothstep(0.0, 0.05, vUv.y);
          a *= amount * (0.35 + 0.65 * facing);
          vec3 col = mix(vec3(0.4, 0.19, 0.08), vec3(0.7, 0.4, 0.2), billow * (1.0 - vUv.y));
          gl_FragColor = vec4(col, a);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true), mat);
    wall.frustumCulled = false;
    wall.visible = false;
    return wall;
  }

  private buildPuffs() {
    const N = 500;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('life', new THREE.BufferAttribute(new Float32Array(N), 1));
    geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(N), 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { pr: { value: 1 }, sunCol: { value: new THREE.Color().setRGB(0.78, 0.48, 0.28) } },
      vertexShader: `
        attribute float life; attribute float size; varying float vL; uniform float pr;
        void main(){ vL = life; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * (1.0 + (1.0 - life) * 2.6) * 420.0 * pr / -mv.z * step(0.001, life); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying float vL; uniform vec3 sunCol;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c);
          float shade = 0.75 + 0.25 * (0.5 - c.y);
          gl_FragColor = vec4(sunCol * shade * 0.8, pow(vL, 1.3) * 0.22 * smoothstep(0.5, 0.0, d)); }`,
      transparent: true,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return { points: pts, data: { life: geo.attributes.life.array as Float32Array, vel: new Float32Array(N * 3), size: geo.attributes.size.array as Float32Array, next: 0 } };
  }

  private buildTracks() {
    const MAX = 2200;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 4 * 3), 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(MAX * 4), 1));
    geo.setAttribute('v', new THREE.BufferAttribute(new Float32Array(MAX * 4), 1));
    const idx: number[] = [];
    for (let q = 0; q < MAX; q++) idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 2, q * 4 + 1, q * 4 + 3);
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      vertexShader: `attribute float alpha; attribute float v; varying float vA; varying float vV; void main(){ vA = alpha; vV = v; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; varying float vV; void main(){ float tread = 0.55 + 0.45 * step(0.5, fract(vV * 3.0)); gl_FragColor = vec4(0.1, 0.04, 0.02, vA * 0.5 * tread); }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return { mesh, idx: 0, last: null as THREE.Vector3 | null, count: MAX };
  }

  // ─────────────────────────────────────────── props
  addSpecimen(id: string, kind: 'igneous' | 'hematite' | 'sedimentary', pos: THREE.Vector3) {
    const s = createSpecimen(kind);
    s.position.set(pos.x, this.terrain.heightAt(pos.x, pos.z) - 0.02, pos.z);
    this.scene.add(s);
    this.specimens.set(id, s);
  }
  removeSpecimen(id: string) {
    const s = this.specimens.get(id);
    s?.removeFromParent();
    this.specimens.delete(id);
  }

  findFlat(center: THREE.Vector3, radius: number) {
    let best = center.clone(), bestScore = Infinity;
    for (let i = 0; i < 90; i++) {
      const a = i * 2.39996, d = radius * Math.sqrt(i / 90);
      const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
      const score = this.terrain.slopeAt(x, z) + d * 0.15;
      if (score < bestScore) { bestScore = score; best = new THREE.Vector3(x, 0, z); }
    }
    best.y = this.terrain.heightAt(best.x, best.z);
    return best;
  }

  placeRover(pos: THREE.Vector3, yaw: number) {
    this.roverPos.set(pos.x, this.terrain.heightAt(pos.x, pos.z), pos.z);
    this.roverYaw = yaw;
    this.camYaw = yaw;
    this.speed = 0;
    this.lift = 0;
    this.tracks.last = null;
    this.camPos.set(0, 0, 0);
    this.lookCur.set(0, 0, 0);
    this.lastPose.set = false;
    this.refreshNearField(true);
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.roverYaw), 0, Math.cos(this.roverYaw));
  }
  rearHitch() {
    return this.rover.localToWorld(REAR_HITCH.clone());
  }
  pickupPoint(pos = this.roverPos, yaw = this.roverYaw) {
    const l = this.pickupLocal;
    return new THREE.Vector3(pos.x + l.x * Math.cos(yaw) + l.z * Math.sin(yaw), 0, pos.z - l.x * Math.sin(yaw) + l.z * Math.cos(yaw));
  }

  // ─────────────────────────────────────────── control
  drive(throttle: number, steer: number, dt: number, scale = 1) {
    const t = this.terrain;
    this.sandiness = THREE.MathUtils.smoothstep(0.42 - t.rockiness(this.roverPos.x, this.roverPos.z), 0, 0.25);
    const top = (throttle >= 0 ? MAX_SPEED : REVERSE_SPEED) * scale * (1 - this.sandiness * 0.3) * (this.towing ? 0.72 : 1);
    const target = throttle * top;
    const accel = (Math.abs(target) > Math.abs(this.speed) ? 1.6 : 3.4) * (this.towing ? 0.7 : 1);
    const ds = target - this.speed;
    this.speed += Math.sign(ds) * Math.min(Math.abs(ds), accel * dt);
    this.roverYaw -= steer * TURN_RATE * (1 - Math.min(Math.abs(this.speed) / MAX_SPEED, 1) * 0.3) * dt * (this.speed < -0.2 ? -1 : 1);

    const f = this.forward;
    const step = this.speed * dt;
    const nx = this.roverPos.x + f.x * step, nz = this.roverPos.z + f.z * step;
    const dir = Math.sign(step) || 1;
    const rise = t.heightAt(nx + f.x * dir * 1.8, nz + f.z * dir * 1.8) - t.heightAt(nx, nz);
    const climb = THREE.MathUtils.radToDeg(Math.atan2(rise, 1.8));
    if (climb > 6) this.speed *= 1 - Math.min(0.5, (climb - 6) / 60) * dt * 3;
    // side-slope (tilt) limit: Perseverance is rated for ~30° of tilt
    const rx = f.z, rz = -f.x;
    const tilt = THREE.MathUtils.radToDeg(Math.atan2(Math.abs(t.heightAt(nx + rx * 1.12, nz + rz * 1.12) - t.heightAt(nx - rx * 1.12, nz - rz * 1.12)), 2.24));
    const lim = t.size / 2 - 10;
    let ok = climb < MAX_CLIMB_DEG && tilt < 27 && Math.abs(nx) < lim && Math.abs(nz) < lim;
    if (ok) for (const b of this.boulders) {
      const dx = nx + f.x * dir * 1.2 - b.x, dz = nz + f.z * dir * 1.2 - b.z;
      if (dx * dx + dz * dz < (b.r + 1.2) ** 2) { ok = false; break; }
    }
    this.blocked = false;
    if (ok) {
      this.roverPos.x = nx;
      this.roverPos.z = nz;
      this.distance += Math.abs(step);
    } else if (Math.abs(this.speed) > 0.2) {
      this.speed *= 0.15;
      this.blocked = true;
    }
    return { climb, blocked: this.blocked };
  }

  look(dYaw: number, dPitch: number, zoomSteps = 0) {
    if (dYaw || dPitch) this.lastLookInput = this.elapsed;
    this.lookYaw += dYaw;
    const minP = this.view === 'fp' ? -0.6 : -0.05;
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + dPitch, minP, this.view === 'fp' ? 0.6 : 1.1);
    this.camDist = THREE.MathUtils.clamp(this.camDist * Math.pow(1.12, zoomSteps), 5, 22);
  }

  setView(v: ViewMode) {
    this.view = v;
    this.lookPitch = v === 'fp' ? -0.05 : 0.22;
  }

  playCine(keys: CineKey[], seconds: number) {
    this.orbit = null;
    return new Promise<void>((resolve) => (this.cine = { keys, t: 0, dur: seconds, resolve }));
  }
  setOrbit(center: THREE.Vector3 | null, radius = 10, height = 4, speed = 0.22) {
    this.cine = null;
    this.orbit = center ? { center: center.clone(), radius, height, angle: Math.atan2(this.camPos.x - center.x, this.camPos.z - center.z) || 0, speed } : null;
  }
  get inCutscene() {
    return !!this.cine || !!this.orbit;
  }

  toScreen(p: THREE.Vector3) {
    const v = p.clone().project(this.camera);
    return { x: v.x * 0.5 + 0.5, y: -v.y * 0.5 + 0.5, behind: v.z > 1 };
  }

  // ─────────────────────────────────────────── arm pick-up
  async pickUp(id: string, onStage?: (s: 'approach' | 'reach' | 'grab' | 'stow') => void) {
    const rock = this.specimens.get(id);
    if (!rock) return;
    const rp = rock.position;
    const yaw = Math.atan2(rp.x - this.roverPos.x, rp.z - this.roverPos.z);
    const l = this.pickupLocal;
    const goal = new THREE.Vector3(rp.x - (l.x * Math.cos(yaw) + l.z * Math.sin(yaw)), 0, rp.z - (-l.x * Math.sin(yaw) + l.z * Math.cos(yaw)));
    onStage?.('approach');
    const p0 = this.roverPos.clone(), y0 = this.roverYaw;
    const dy = Math.atan2(Math.sin(yaw - y0), Math.cos(yaw - y0));
    await this.animate(1.6, (k) => {
      const e = k * k * (3 - 2 * k);
      this.roverPos.x = THREE.MathUtils.lerp(p0.x, goal.x, e);
      this.roverPos.z = THREE.MathUtils.lerp(p0.z, goal.z, e);
      this.roverYaw = y0 + dy * e;
      this.speed = 0;
    });
    if (!this.armMixer || !this.turret) return void this.removeSpecimen(id);
    onStage?.('reach');
    await this.animate(1.8, (k) => (this.armTime = 6.2 * k));
    await this.animate(1.3, (k) => (this.armAngle = this.armDown * (k * k * (3 - 2 * k))));
    onStage?.('grab');
    await this.animate(0.5, () => {});
    this.turret.attach(rock);
    await this.animate(1.1, (k) => (this.armAngle = this.armDown * (1 - k * k * (3 - 2 * k))));
    onStage?.('stow');
    await this.animate(1.8, (k) => (this.armTime = THREE.MathUtils.lerp(18, 24.16, k)));
    await this.animate(0.5, (k) => rock.scale.setScalar(1 - k));
    this.removeSpecimen(id);
    this.armTime = 0;
  }

  private jobs: { t: number; seconds: number; fn: (k: number) => void; resolve: () => void }[] = [];
  private animate(seconds: number, fn: (k: number) => void) {
    return new Promise<void>((resolve) => this.jobs.push({ t: 0, seconds, fn, resolve }));
  }

  // ─────────────────────────────────────────── towing
  async latch() {
    this.cable.extend = 0;
    await this.animate(1.4, (k) => (this.cable.extend = k * k));
    this.towing = true;
    const b = this.ares.body;
    const r0 = b.rotation.clone(), p0 = b.position.y;
    await this.animate(1.0, (k) => {
      const e = 1 - Math.pow(1 - k, 3);
      b.rotation.set(r0.x * (1 - e), r0.y, r0.z * (1 - e));
      b.position.y = p0 * (1 - e);
    });
  }
  unlatch() {
    this.towing = false;
    this.cable.extend = 0;
    this.cable.mesh.visible = false;
  }

  private updateTow(dt: number) {
    const g = this.ares.group;
    const hitch = this.rearHitch();
    if (this.towing) {
      const d = new THREE.Vector3(g.position.x - hitch.x, 0, g.position.z - hitch.z);
      if (d.lengthSq() < 1e-6) d.set(-Math.sin(this.roverYaw), 0, -Math.cos(this.roverYaw));
      d.normalize();
      const reach = TOW_LENGTH + this.ares.hitchLocal.z;
      g.position.x = hitch.x + d.x * reach;
      g.position.z = hitch.z + d.z * reach;
      g.rotation.y = Math.atan2(-d.x, -d.z);
      const n = this.terrain.normalAt(g.position.x, g.position.z);
      g.position.y += (this.terrain.heightAt(g.position.x, g.position.z) - g.position.y) * Math.min(1, dt * 10);
      this.ares.body.rotation.x += (Math.atan2(n.z * Math.cos(g.rotation.y) + n.x * Math.sin(g.rotation.y), n.y) - this.ares.body.rotation.x) * Math.min(1, dt * 6);
      // ARES-7's wheels roll with the distance it is towed
      const fwd = new THREE.Vector3(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y));
      const moved = g.position.clone().sub(this.aresLast).dot(fwd);
      if (Math.abs(moved) < 2) for (const w of this.ares.wheels) w.rotation.x += moved / 0.24;
    }
    this.aresLast.copy(g.position);
    if (this.cable.extend > 0) this.cable.update(hitch, g.localToWorld(this.ares.hitchLocal.clone()));
  }

  // ─────────────────────────────────────────── frame
  update(dt: number) {
    if (this.paused) return;
    this.elapsed += dt;
    for (const j of [...this.jobs]) {
      j.t += dt;
      const k = Math.min(1, j.t / j.seconds);
      j.fn(k);
      if (k >= 1) { this.jobs.splice(this.jobs.indexOf(j), 1); j.resolve(); }
    }

    this.poseRover(dt);
    this.spinWheels();
    this.updateArm();
    this.updateTow(dt);
    this.updateCamera(dt);
    this.refreshNearField();

    this.sun.position.copy(this.roverPos).addScaledVector(SUN_DIR, 120);
    this.sun.target.position.copy(this.roverPos);

    // Storm look
    const s = this.storm;
    this.fog.density = 0.0042 + s * s * 0.034;
    this.fog.color.copy(FOG).lerp(STORM_FOG, s);
    this.skyMat.uniforms.storm.value = s;
    this.skyMat.uniforms.time.value = this.elapsed;
    const haze = Math.min(1, s * 2.2 + this.stormFront * 0.4);
    for (const m of this.mesaMats) m.mat.color.copy(m.base).lerp(STORM_FOG, haze);
    this.sun.intensity = 4.2 * (1 - s * 0.75);
    this.hemi.intensity = 0.6 * (1 - s * 0.3);
    this.grade.uniforms.time.value = this.elapsed;
    this.grade.uniforms.storm.value = s;
    const dm = this.dust.material as THREE.ShaderMaterial;
    dm.uniforms.time.value = this.elapsed;
    dm.uniforms.storm.value = s;
    dm.uniforms.origin.value.copy(this.camera.position);

    const wm = this.wall.material as THREE.ShaderMaterial;
    const front = this.stormFront;
    this.wall.visible = front > 0.01 && s < 0.95;
    this.wall.position.set(this.roverPos.x, this.roverPos.y - 20, this.roverPos.z);
    const R = THREE.MathUtils.lerp(900, 60, front);
    this.wall.scale.set(R, 260, R);
    wm.uniforms.time.value = this.elapsed;
    wm.uniforms.amount.value = Math.min(1, front * 1.4) * (1 - s * 0.8);

    if (this.rays.enabled) {
      const sp = this.camera.position.clone().addScaledVector(SUN_DIR, 1000).project(this.camera);
      const camDir = this.camera.getWorldDirection(new THREE.Vector3());
      const facing = THREE.MathUtils.smoothstep(camDir.dot(SUN_DIR), 0.1, 0.6);
      this.rays.uniforms.sun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
      this.rays.uniforms.strength.value = this.rayStrength * facing * (1 - s * 0.85);
    }

    this.updatePuffs(dt);
    this.updateTracks();
  }

  /** Wheels roll by the distance each side travelled (left/right differ when turning). */
  private spinWheels() {
    const P = this.roverPos;
    if (this.lastPose.set && this.wheels.length) {
      const dx = P.x - this.lastPose.x, dz = P.z - this.lastPose.z;
      const fwd = dx * Math.sin(this.roverYaw) + dz * Math.cos(this.roverYaw);
      const dYaw = Math.atan2(Math.sin(this.roverYaw - this.lastPose.yaw), Math.cos(this.roverYaw - this.lastPose.yaw));
      if (Math.abs(fwd) < 3) for (const w of this.wheels) w.pivot.rotation.x += (fwd - dYaw * w.x) / WHEEL_RADIUS;
    }
    this.lastPose = { x: P.x, z: P.z, yaw: this.roverYaw, set: true };
  }

  private poseRover(dt: number) {
    const t = this.terrain, P = this.roverPos;
    const cy = Math.cos(this.roverYaw), sy = Math.sin(this.roverYaw);
    const toW = (lx: number, lz: number) => [P.x + lx * cy + lz * sy, P.z - lx * sy + lz * cy];
    const hs = WHEELS.map(([lx, lz]) => { const [x, z] = toW(lx, lz); return t.heightAt(x, z); });
    const left = (hs[0] + hs[1] + hs[2]) / 3, right = (hs[3] + hs[4] + hs[5]) / 3;
    const front = (hs[2] + hs[5]) / 2, back = (hs[0] + hs[3]) / 2;
    const tPitch = Math.atan2(front - back, 2.33), tRoll = Math.atan2(right - left, 2.24);
    const k = 1 - Math.exp(-dt * 7);
    this.pitch += (tPitch - this.pitch) * k;
    this.roll += (tRoll - this.roll) * k;
    const y = hs.reduce((a, b) => a + b, 0) / 6;
    let need = 0;
    WHEELS.forEach(([lx, lz], i) => {
      const wy = y + lz * Math.sin(this.pitch) + lx * Math.sin(this.roll);
      need = Math.max(need, hs[i] - wy);
    });
    for (const [lx, lz] of BELLY) {
      const [x, z] = toW(lx, lz);
      const by = y + lz * Math.sin(this.pitch) + lx * Math.sin(this.roll) + BELLY_CLEAR;
      need = Math.max(need, t.heightAt(x, z) + 0.08 - by);
    }
    this.lift = need > this.lift ? need : this.lift + (need - this.lift) * Math.min(1, dt * 4);
    const rumble = Math.abs(this.speed) > 0.3 ? Math.sin(this.elapsed * 23) * 0.006 * (0.4 + this.sandiness) : 0;
    P.y = y + this.lift + rumble;
    this.rover.position.copy(P);
    this.rover.rotation.set(0, 0, 0);
    this.rover.rotateY(this.roverYaw);
    this.rover.rotateX(-this.pitch);
    this.rover.rotateZ(this.roll); // +roll lifts the rover's +x side
  }

  private updateArm() {
    if (!this.armMixer || !this.shoulder) return;
    this.armMixer.setTime(this.armTime);
    if (this.armAngle) this.shoulder.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(this.shoulderAxis, this.armAngle));
  }

  private updateCamera(dt: number) {
    const P = this.roverPos;
    const dYaw = Math.atan2(Math.sin(this.roverYaw - this.camYaw), Math.cos(this.roverYaw - this.camYaw));
    this.camYaw += dYaw * (1 - Math.exp(-dt * 2.0));
    if (this.autoRecentre && this.elapsed - this.lastLookInput > 3.5 && this.view === 'chase') this.lookYaw *= Math.exp(-dt * 0.9);

    if (this.head) {
      const rel = this.view === 'fp' ? this.lookYaw : Math.atan2(Math.sin(this.camYaw + this.lookYaw - this.roverYaw), Math.cos(this.camYaw + this.lookYaw - this.roverYaw));
      this.head.quaternion.copy(this.headBase).premultiply(new THREE.Quaternion().setFromAxisAngle(this.headAxis, rel));
    }

    let want: THREE.Vector3, look: THREE.Vector3, rate = 6;
    if (this.cine) {
      const c = this.cine;
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      const e = k * k * (3 - 2 * k);
      const seg = e * (c.keys.length - 1);
      const i = Math.min(c.keys.length - 2, Math.floor(seg)), f = seg - i;
      want = catmull(c.keys.map((x) => x.pos), i, f);
      look = catmull(c.keys.map((x) => x.look), i, f);
      this.camPos.copy(want);
      this.lookCur.copy(look);
      if (k >= 1) { const r = c.resolve; this.cine = null; r(); }
      rate = 0;
    } else if (this.orbit) {
      const o = this.orbit;
      o.angle += dt * o.speed;
      want = new THREE.Vector3(o.center.x + Math.sin(o.angle) * o.radius, 0, o.center.z + Math.cos(o.angle) * o.radius);
      want.y = Math.max(this.terrain.heightAt(want.x, want.z) + 1.5, o.center.y + o.height);
      look = o.center.clone().add(new THREE.Vector3(0, 0.9, 0));
      rate = 1.6;
    } else if (this.view === 'fp') {
      const eye = this.head ? this.head.getWorldPosition(new THREE.Vector3()) : P.clone().add(new THREE.Vector3(0, 2.1, 0));
      const yaw = this.roverYaw + this.lookYaw;
      eye.add(new THREE.Vector3(Math.sin(yaw) * 0.7, 0.4, Math.cos(yaw) * 0.7));
      want = eye;
      look = eye.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(this.lookPitch), Math.sin(this.lookPitch) - this.pitch * 0.5, Math.cos(yaw) * Math.cos(this.lookPitch)));
      this.camPos.copy(want);
      this.lookCur.copy(look);
      rate = 0;
    } else {
      const yaw = this.camYaw + this.lookYaw + Math.PI;
      const horiz = Math.cos(this.lookPitch) * this.camDist;
      want = new THREE.Vector3(P.x + Math.sin(yaw) * horiz, P.y + 1.7 + Math.sin(this.lookPitch) * this.camDist, P.z + Math.cos(yaw) * horiz);
      look = new THREE.Vector3(P.x, P.y + 1.4, P.z);
    }
    want.y = Math.max(want.y, this.terrain.heightAt(want.x, want.z) + (this.view === 'fp' && !this.cine ? 0.3 : 1.2));
    if (rate > 0) {
      if (this.camPos.lengthSq() === 0) this.camPos.copy(want);
      this.camPos.lerp(want, 1 - Math.exp(-dt * rate));
      this.lookCur.lerp(look, this.lookCur.lengthSq() === 0 ? 1 : 1 - Math.exp(-dt * 8));
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.lookCur);
    if (this.head) this.head.visible = !(this.view === 'fp' && !this.cine && !this.orbit);
  }

  private updatePuffs(dt: number) {
    const geo = this.puffs.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const { life, vel, size } = this.puffData;
    const n = life.length;
    const sp = Math.abs(this.speed);
    if (sp > 0.4) {
      const cy = Math.cos(this.roverYaw), sy = Math.sin(this.roverYaw);
      const count = sp > 2 ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const [lx, lz] = WHEELS[Math.floor(Math.random() * 6)];
        const x = this.roverPos.x + lx * cy + lz * sy, z = this.roverPos.z - lx * sy + lz * cy;
        const i = this.puffData.next;
        this.puffData.next = (i + 1) % n;
        pos.setXYZ(i, x, this.terrain.heightAt(x, z) + 0.15, z);
        const back = -Math.sign(this.speed) * (0.6 + sp * 0.15);
        vel[i * 3] = Math.sin(this.roverYaw) * back + (Math.random() - 0.5) * 0.6;
        vel[i * 3 + 1] = 0.25 + Math.random() * 0.35;
        vel[i * 3 + 2] = Math.cos(this.roverYaw) * back + (Math.random() - 0.5) * 0.6;
        life[i] = 1;
        size[i] = (0.5 + Math.random() * 0.5) * (0.6 + this.sandiness * 0.6) * Math.min(1, sp / 2.5 + 0.3);
      }
    }
    for (let i = 0; i < n; i++) {
      if (life[i] <= 0) continue;
      life[i] = Math.max(0, life[i] - dt * 0.42);
      vel[i * 3 + 1] *= 1 - dt * 0.6;
      pos.setXYZ(i, pos.getX(i) + (vel[i * 3] + 0.6) * dt, pos.getY(i) + vel[i * 3 + 1] * dt, pos.getZ(i) + (vel[i * 3 + 2] + 0.3) * dt);
    }
    pos.needsUpdate = true;
    (geo.attributes.life as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateTracks() {
    const tr = this.tracks;
    const P = this.roverPos;
    if (tr.last && tr.last.distanceToSquared(P) < 0.35 * 0.35) return;
    const f = this.forward, rgt = new THREE.Vector3(f.z, 0, -f.x);
    if (tr.last) {
      const pos = tr.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const alpha = tr.mesh.geometry.attributes.alpha as THREE.BufferAttribute;
      const vAttr = tr.mesh.geometry.attributes.v as THREE.BufferAttribute;
      const prev = tr.last;
      const d0 = this.distance - prev.distanceTo(P), d1 = this.distance;
      for (const off of [-1.12, 1.12]) {
        const q = tr.idx;
        tr.idx = (tr.idx + 1) % tr.count;
        const w = 0.21;
        const pts = [
          [prev.x + rgt.x * (off - w), prev.z + rgt.z * (off - w), d0], [prev.x + rgt.x * (off + w), prev.z + rgt.z * (off + w), d0],
          [P.x + rgt.x * (off - w), P.z + rgt.z * (off - w), d1], [P.x + rgt.x * (off + w), P.z + rgt.z * (off + w), d1],
        ];
        pts.forEach(([x, z, v], k) => {
          pos.setXYZ(q * 4 + k, x, this.terrain.heightAt(x, z) + 0.035, z);
          alpha.setX(q * 4 + k, 1);
          vAttr.setX(q * 4 + k, v);
        });
      }
      for (let i = 0; i < alpha.count; i++) alpha.setX(i, alpha.getX(i) * 0.9997);
      pos.needsUpdate = alpha.needsUpdate = vAttr.needsUpdate = true;
    }
    tr.last = P.clone();
  }

  render(renderer: THREE.WebGLRenderer) {
    const prev = renderer.toneMappingExposure;
    renderer.toneMappingExposure = this.exposure;
    this.composer.render();
    renderer.toneMappingExposure = prev;
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setPixelRatio(this.composer.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.composer.renderer.getPixelRatio();
    (this.dust.material as THREE.ShaderMaterial).uniforms.pr.value = pr;
    (this.puffs.material as THREE.ShaderMaterial).uniforms.pr.value = pr;
  }

  dispose() {
    this.composer.dispose();
    if (this.armMixer) { this.armMixer.setTime(0); this.armMixer.stopAllAction(); }
    if (this.head) { this.head.quaternion.copy(this.headBase); this.head.visible = true; }
    // restore the shared NASA model (merge + wheel split are undone so replays start clean)
    if (this.merged) {
      for (const m of this.merged.meshes) { m.removeFromParent(); m.geometry.dispose(); }
      this.merged.hidden.forEach((m) => (m.visible = true));
    }
    if (this.wheelSplit) {
      for (const p of this.wheelSplit.added) this.wheelSplit.group.remove(p);
      this.wheelSplit.originals.forEach((m) => (m.visible = true));
    }
    if (this.model) this.rover.remove(this.model);
    const keep = new Set<THREE.Material>();
    this.model?.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => keep.add(x)); });
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.Points).isPoints) {
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        (Array.isArray(mat) ? mat : [mat]).forEach((x) => { if (x && !keep.has(x)) x.dispose(); });
      }
    });
  }
}

/** Mostly dark basaltic / rusty rock tints with variation. */
function rockTint(c: THREE.Color, r: () => number) {
  const sh = 0.5 + r() * 0.5;
  if (r() < 0.35) c.setRGB(0.42 * sh, 0.36 * sh, 0.33 * sh);
  else c.setRGB(0.78 * sh, 0.46 * sh, 0.32 * sh);
  return c;
}

function axisInParent(node: THREE.Object3D, root: THREE.Object3D, axisInRoot: THREE.Vector3) {
  root.updateMatrixWorld(true);
  const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
  const parentQ = node.parent ? node.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  return axisInRoot.clone().applyQuaternion(rootQ).applyQuaternion(parentQ.invert()).normalize();
}

function catmull(pts: THREE.Vector3[], i: number, f: number) {
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[Math.min(pts.length - 1, i + 1)], p3 = pts[Math.min(pts.length - 1, i + 2)];
  const f2 = f * f, f3 = f2 * f;
  const c = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * f + (2 * a - 5 * b + 4 * cc - d) * f2 + (-a + 3 * b - 3 * cc + d) * f3);
  return new THREE.Vector3(c(p0.x, p1.x, p2.x, p3.x), c(p0.y, p1.y, p2.y, p3.y), c(p0.z, p1.z, p2.z, p3.z));
}
