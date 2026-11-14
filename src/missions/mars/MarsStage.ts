import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { Stage } from '../../core/Engine';
import type { Assets } from '../../core/Assets';
import { Terrain, makeDetailTextures } from './terrain';
import { rng, rockGeometry, createSpecimen, createAres7, TowCable } from './props';

export const MAX_SPEED = 4.2;   // m/s gameplay top speed (real Perseverance ≈ 0.042 m/s)
const REVERSE_SPEED = 1.8;
const TURN_RATE = 0.85;
const MAX_CLIMB_DEG = 28;
// Low afternoon Sun in the north-west: long shadows down the channels, light shafts through gaps.
export const SUN_DIR = new THREE.Vector3(-0.42, 0.34, -0.84).normalize();

const HORIZON = new THREE.Color().setRGB(0.72, 0.44, 0.25);
const STORM_FOG = new THREE.Color().setRGB(0.24, 0.12, 0.06);
const RIM_COLOR = new THREE.Color().setRGB(0.48, 0.28, 0.16);

// Perseverance geometry (model units = metres)
const WHEELS = [[-1.12, -1.18], [-1.12, 0.02], [-1.12, 1.15], [1.12, -1.18], [1.12, 0.02], [1.12, 1.15]] as const; // [x, z] local
const BELLY = [[0, 0], [0, 0.9], [0, -0.9], [-0.6, 0], [0.6, 0]] as const;
const BELLY_CLEAR = 0.62;
const REAR_HITCH = new THREE.Vector3(0, 0.6, -1.7);
const TOW_LENGTH = 2.4;

export type ViewMode = 'chase' | 'fp';
interface CineKey { pos: THREE.Vector3; look: THREE.Vector3 }

/** Screen-space light shafts from the Sun (radial blur of bright sky, Crytek-style). */
const GodRaysShader = {
  uniforms: { tDiffuse: { value: null }, sun: { value: new THREE.Vector2(0.5, 0.5) }, strength: { value: 0 }, threshold: { value: 1.6 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 sun; uniform float strength; uniform float threshold; varying vec2 vUv;
    void main(){
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      if (strength < 0.001) { gl_FragColor = vec4(base, 1.0); return; }
      vec2 delta = (vUv - sun) * (0.92 / 40.0);
      vec2 uv = vUv; float decay = 1.0; vec3 acc = vec3(0.0);
      for (int i = 0; i < 40; i++) {
        uv -= delta;
        vec3 s = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
        // only the Sun disk/aureole (HDR > threshold) casts shafts; terrain occludes them
        float l = min(max(dot(s, vec3(0.3, 0.59, 0.11)) - threshold, 0.0), 4.0);
        acc += vec3(l) * decay;
        decay *= 0.955;
      }
      gl_FragColor = vec4(base + acc * strength * 0.012 * vec3(1.0, 0.82, 0.6), 1.0);
    }`,
};

export class MarsStage implements Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.05, 4000);
  readonly terrain: Terrain;
  private composer: EffectComposer;
  private rays: ShaderPass;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private skyMat: THREE.ShaderMaterial;
  private fog: THREE.FogExp2;
  private rimMat!: THREE.MeshBasicMaterial;

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
  private armDown = 1.2; // radians to bring the hand to the ground (solved at load)
  private pickupLocal = new THREE.Vector3(0.3, 0, 2.1); // where the hand touches ground, rover-local
  private armTime = 0;
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

  // camera
  view: ViewMode = 'chase';
  lookYaw = 0;   // free-look offset from the rover heading
  lookPitch = 0.22;
  camDist = 9;
  private camYaw = 0; // lagged copy of the rover heading (tank-game feel)
  private camPos = new THREE.Vector3();
  private lookCur = new THREE.Vector3();
  private lastLookInput = -10;
  autoRecentre = true;
  private cine: { keys: CineKey[]; t: number; dur: number; resolve: () => void } | null = null;
  private orbit: { center: THREE.Vector3; radius: number; height: number; angle: number; speed: number } | null = null;

  // effects
  storm = 0;
  stormFront = 0;
  rayStrength = 0.7;
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

  constructor(assets: Assets, renderer: THREE.WebGLRenderer, quality: 'low' | 'medium' | 'high') {
    const detail = makeDetailTextures();
    this.terrain = new Terrain(assets, detail);
    this.scene.add(this.terrain.group);

    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: SUN_DIR }, storm: { value: 0 }, horizon: { value: HORIZON.clone() } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 sunDir; uniform float storm; uniform vec3 horizon; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 zenith = vec3(0.24, 0.11, 0.06);
          vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.5));
          float sd = max(dot(d, sunDir), 0.0);
          col += vec3(0.5, 0.62, 0.85) * pow(sd, 40.0) * 0.6;   // bluish aureole around the Sun (seen in rover images)
          col += vec3(1.0, 0.82, 0.6) * pow(sd, 5.0) * 0.25;
          col += vec3(1.0, 0.97, 0.9) * smoothstep(0.99955, 0.9998, sd) * 22.0;
          vec3 stormCol = mix(vec3(0.24, 0.12, 0.06), vec3(0.13, 0.065, 0.035), max(h, 0.0));
          stormCol += vec3(0.5, 0.33, 0.18) * pow(sd, 8.0) * 0.35;
          gl_FragColor = vec4(mix(col, stormCol, storm), 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3500, 48, 24), this.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.scene.add(sky);

    this.fog = new THREE.FogExp2(HORIZON.clone(), 0.0034);
    this.scene.fog = this.fog;
    this.scene.add(this.buildDistantRim(), this.buildOuterGround());

    this.sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1.0, 0.84, 0.66), 3.6);
    this.sun.castShadow = true;
    const sm = quality === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -34; sc.right = sc.top = 34; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(new THREE.Color().setRGB(0.7, 0.5, 0.38), new THREE.Color().setRGB(0.3, 0.15, 0.08), 0.7);
    this.scene.add(this.hemi);

    this.scatterRocks();
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

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.rays = new ShaderPass(GodRaysShader);
    this.composer.addPass(this.rays);
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.6, 0.9));
    this.composer.addPass(new OutputPass());
  }

  // ─────────────────────────────────────────── world building
  private buildDistantRim() {
    const r = rng(77);
    const geo = new THREE.CylinderGeometry(1500, 1500, 1, 256, 4, true);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const ph = Array.from({ length: 6 }, () => r() * Math.PI * 2);
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      let h = 0;
      [3, 7, 13, 29, 53, 97].forEach((f, k) => (h += Math.sin(a * f + ph[k]) / (k + 1.4)));
      pos.setY(i, pos.getY(i) > 0 ? 70 + 90 * (h * 0.5 + 0.5) : -40);
    }
    this.rimMat = new THREE.MeshBasicMaterial({ color: RIM_COLOR.clone(), fog: false, side: THREE.BackSide });
    const mesh = new THREE.Mesh(geo, this.rimMat);
    mesh.position.y = 20;
    return mesh;
  }

  private buildOuterGround() {
    const g = new THREE.RingGeometry(330, 3000, 64, 4);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.3, 0.155, 0.085), roughness: 1 }));
    m.position.y = 18;
    return m;
  }

  /** Rocks in a 4×4 grid of instanced meshes (frustum-culled per cell). */
  private scatterRocks() {
    const r = rng(2026);
    const t = this.terrain;
    const half = t.size / 2 - 4;
    const CELLS = 4, cell = (half * 2) / CELLS;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.02 });
    const geos = [rockGeometry(1, 1), rockGeometry(2, 1, 0.55), rockGeometry(3, 2, 0.75)];
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const classes = [
      { count: 26000, min: 0.05, max: 0.3, shadow: false, geo: 0, collide: false },
      { count: 2600, min: 0.3, max: 0.9, shadow: true, geo: 1, collide: false },
      { count: 260, min: 0.9, max: 2.4, shadow: true, geo: 2, collide: true },
    ];
    for (let cy = 0; cy < CELLS; cy++) for (let cx = 0; cx < CELLS; cx++) {
      for (const c of classes) {
        const n = Math.ceil(c.count / (CELLS * CELLS));
        const inst = new THREE.InstancedMesh(geos[c.geo], mat, n);
        let k = 0, guard = 0;
        while (k < n && guard++ < n * 25) {
          const x = -half + (cx + r()) * cell, z = -half + (cy + r()) * cell;
          const rock = t.rockiness(x, z), slope = t.slopeAt(x, z);
          // Rocks gather on bright bedrock and at the foot of slopes; fewer on ripple sand.
          const p = 0.25 + rock * 0.75 + Math.min(slope, 30) / 60;
          if (r() > p) continue;
          if (c.collide && slope > 24) continue;
          const s = c.min * Math.pow(c.max / c.min, Math.pow(r(), 2.4));
          dummy.position.set(x, t.heightAt(x, z) - s * 0.28, z);
          dummy.rotation.set(r() * 0.6, r() * Math.PI * 2, r() * 0.6);
          dummy.scale.set(s * (0.75 + r() * 0.6), s * (0.8 + r() * 0.4), s * (0.75 + r() * 0.6));
          dummy.updateMatrix();
          inst.setMatrixAt(k, dummy.matrix);
          const sh = 0.55 + r() * 0.5;
          if (r() < 0.3) tint.setRGB(0.15 * sh, 0.13 * sh, 0.12 * sh); else tint.setRGB(0.36 * sh, 0.2 * sh, 0.13 * sh);
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
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
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
  }

  /** Find the shoulder rotation that brings the hand to the ground and where that is (rover-local). */
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
    const N = 3200;
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
          vA = shown * (0.14 + storm * 0.4) * smoothstep(90.0, 3.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(0.6, 0.4, 0.26), vA * smoothstep(0.5, 0.0, d)); }`,
      transparent: true,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  /** Approaching storm front: a wall of billowing dust on the horizon that closes in. */
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
          vec3 col = mix(vec3(0.42, 0.22, 0.11), vec3(0.68, 0.42, 0.24), billow * (1.0 - vUv.y));
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
      uniforms: { pr: { value: 1 }, sunCol: { value: new THREE.Color().setRGB(0.75, 0.52, 0.36) } },
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
      // tread pattern: repeating chevrons across the track width
      fragmentShader: `varying float vA; varying float vV; void main(){ float tread = 0.55 + 0.45 * step(0.5, fract(vV * 3.0)); gl_FragColor = vec4(0.11, 0.05, 0.02, vA * 0.5 * tread); }`,
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
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.roverYaw), 0, Math.cos(this.roverYaw));
  }
  /** World position of the rover's rear tow hitch. */
  rearHitch() {
    return this.rover.localToWorld(REAR_HITCH.clone());
  }
  /** World-space point where the hand meets the ground in front of the rover. */
  pickupPoint(pos = this.roverPos, yaw = this.roverYaw) {
    const l = this.pickupLocal;
    return new THREE.Vector3(pos.x + l.x * Math.cos(yaw) + l.z * Math.sin(yaw), 0, pos.z - l.x * Math.sin(yaw) + l.z * Math.cos(yaw));
  }

  // ─────────────────────────────────────────── control
  drive(throttle: number, steer: number, dt: number, scale = 1) {
    const t = this.terrain;
    // Terrain resistance: dark ripple sand slows the rover (Spirit was trapped in soft sand in 2009).
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
    // climbing costs speed
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

  /** Mouse/stick look (radians). */
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

  /** Keyframed camera move (cutscene). Resolves when finished. */
  playCine(keys: CineKey[], seconds: number) {
    this.orbit = null;
    return new Promise<void>((resolve) => (this.cine = { keys, t: 0, dur: seconds, resolve }));
  }
  /** Slow cinematic orbit around a point until cleared. */
  setOrbit(center: THREE.Vector3 | null, radius = 10, height = 4, speed = 0.22) {
    this.cine = null;
    this.orbit = center ? { center: center.clone(), radius, height, angle: Math.atan2(this.camPos.x - center.x, this.camPos.z - center.z) || 0, speed } : null;
  }
  get inCutscene() {
    return !!this.cine || !!this.orbit;
  }

  /** Normalised screen position of a world point (for HUD markers). */
  toScreen(p: THREE.Vector3) {
    const v = p.clone().project(this.camera);
    const behind = v.z > 1;
    return { x: (v.x * 0.5 + 0.5), y: (-v.y * 0.5 + 0.5), behind };
  }

  // ─────────────────────────────────────────── arm pick-up
  /**
   * Full sample acquisition: auto-approach so the rock lies under the hand, unstow (NASA clip),
   * lower the shoulder to the rock, grab it, lift, stow. Rock ends inside the rover.
   */
  async pickUp(id: string, onStage?: (s: 'approach' | 'reach' | 'grab' | 'stow') => void) {
    const rock = this.specimens.get(id);
    if (!rock) return;
    // 1) approach: final pose puts the pickup point on the rock
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
    await this.animate(1.8, (k) => (this.armTime = 6.2 * k));                         // unstow (NASA clip)
    await this.animate(1.3, (k) => (this.armAngle = this.armDown * (k * k * (3 - 2 * k)))); // reach down to the rock
    onStage?.('grab');
    await this.animate(0.5, () => {});
    this.turret.attach(rock);                                                          // the hand now holds the rock
    await this.animate(1.1, (k) => (this.armAngle = this.armDown * (1 - k * k * (3 - 2 * k))));
    onStage?.('stow');
    await this.animate(1.8, (k) => (this.armTime = THREE.MathUtils.lerp(18, 24.16, k))); // stow (NASA clip)
    await this.animate(0.5, (k) => rock.scale.setScalar(1 - k));                        // into the sample cache
    this.removeSpecimen(id);
    this.armTime = 0;
  }

  private animate(seconds: number, fn: (k: number) => void) {
    return new Promise<void>((resolve) => {
      const job = { t: 0, seconds, fn, resolve };
      this.jobs.push(job);
    });
  }
  private jobs: { t: number; seconds: number; fn: (k: number) => void; resolve: () => void }[] = [];

  // ─────────────────────────────────────────── towing
  /** Cable shoots from the rover's rear hitch and clamps onto ARES-7. */
  async latch() {
    this.cable.extend = 0;
    await this.animate(1.4, (k) => (this.cable.extend = k * k));
    this.towing = true;
    // ARES-7 lurches free of the sand
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
      // trailer kinematics: ARES-7's hitch stays TOW_LENGTH behind the rover's hitch
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
    }
    if (this.cable.extend > 0) {
      const aHitch = g.localToWorld(this.ares.hitchLocal.clone());
      this.cable.update(hitch, aHitch);
    }
  }

  // ─────────────────────────────────────────── frame
  update(dt: number) {
    if (this.paused) { this.composerIdle(); return; }
    this.elapsed += dt;
    for (const j of [...this.jobs]) {
      j.t += dt;
      const k = Math.min(1, j.t / j.seconds);
      j.fn(k);
      if (k >= 1) { this.jobs.splice(this.jobs.indexOf(j), 1); j.resolve(); }
    }

    this.poseRover(dt);
    this.updateArm();
    this.updateTow(dt);
    this.updateCamera(dt);

    this.sun.position.copy(this.roverPos).addScaledVector(SUN_DIR, 120);
    this.sun.target.position.copy(this.roverPos);

    // Storm look
    const s = this.storm;
    this.fog.density = 0.0034 + s * s * 0.034;
    this.fog.color.copy(HORIZON).lerp(STORM_FOG, s);
    this.skyMat.uniforms.storm.value = s;
    this.rimMat.color.copy(RIM_COLOR).lerp(STORM_FOG, Math.min(1, s * 2.2 + this.stormFront * 0.4));
    this.sun.intensity = 3.6 * (1 - s * 0.75);
    this.hemi.intensity = 0.7 * (1 - s * 0.3);
    const dm = this.dust.material as THREE.ShaderMaterial;
    dm.uniforms.time.value = this.elapsed;
    dm.uniforms.storm.value = s;
    dm.uniforms.origin.value.copy(this.camera.position);

    // Storm wall closes in as the front arrives, then is replaced by fog
    const wm = this.wall.material as THREE.ShaderMaterial;
    const front = this.stormFront;
    this.wall.visible = front > 0.01 && s < 0.95;
    this.wall.position.set(this.roverPos.x, this.roverPos.y - 20, this.roverPos.z);
    const R = THREE.MathUtils.lerp(900, 60, front);
    this.wall.scale.set(R, 260, R);
    wm.uniforms.time.value = this.elapsed;
    wm.uniforms.amount.value = Math.min(1, front * 1.4) * (1 - s * 0.8);

    // God rays: only when the Sun is in front of the camera
    const sunPos = this.camera.position.clone().addScaledVector(SUN_DIR, 1000);
    const sp = sunPos.project(this.camera);
    const camDir = this.camera.getWorldDirection(new THREE.Vector3());
    const facing = THREE.MathUtils.smoothstep(camDir.dot(SUN_DIR), 0.1, 0.6);
    this.rays.uniforms.sun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    this.rays.uniforms.strength.value = this.rayStrength * facing * (1 - s * 0.85);

    this.updatePuffs(dt);
    this.updateTracks();
  }

  /** While paused the scene keeps rendering the last frame state. */
  private composerIdle() {}

  /** Rocker-bogie pose: fit pitch/roll to six wheel contacts, never let wheels or belly sink. */
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
    let y = hs.reduce((a, b) => a + b, 0) / 6;
    // raise until no wheel or belly point is below ground (hitbox)
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
    // suspension: rise instantly, settle smoothly; tiny vibration on rough sand
    this.lift = need > this.lift ? need : this.lift + (need - this.lift) * Math.min(1, dt * 4);
    const rumble = Math.abs(this.speed) > 0.3 ? Math.sin(this.elapsed * 23) * 0.006 * (0.4 + this.sandiness) : 0;
    P.y = y + this.lift + rumble;
    this.rover.position.copy(P);
    this.rover.rotation.set(0, 0, 0);
    this.rover.rotateY(this.roverYaw);
    this.rover.rotateX(-this.pitch);
    this.rover.rotateZ(this.roll); // +roll lifts the rover's +x side (was inverted: rover tilted against side slopes)
  }

  private updateArm() {
    if (!this.armMixer || !this.shoulder) return;
    this.armMixer.setTime(this.armTime);
    if (this.armAngle) this.shoulder.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(this.shoulderAxis, this.armAngle));
  }

  private updateCamera(dt: number) {
    const P = this.roverPos;
    // tank-game lag: the camera's heading trails the rover's heading
    const dYaw = Math.atan2(Math.sin(this.roverYaw - this.camYaw), Math.cos(this.roverYaw - this.camYaw));
    this.camYaw += dYaw * (1 - Math.exp(-dt * 2.0));
    if (this.autoRecentre && this.elapsed - this.lastLookInput > 3.5 && this.view === 'chase') this.lookYaw *= Math.exp(-dt * 0.9);

    // mast head turns toward where the operator is looking (Perseverance's mast pans 360°)
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
    // In the mast-camera view, hide the camera head itself so it doesn't fill the lens.
    if (this.head) this.head.visible = !(this.view === 'fp' && !this.cine && !this.orbit);
  }

  private updatePuffs(dt: number) {
    const geo = this.puffs.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const { life, vel, size } = this.puffData;
    const n = life.length;
    const sp = Math.abs(this.speed);
    if (sp > 0.4 && !this.paused) {
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

  render() {
    this.composer.render();
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    const pr = window.devicePixelRatio;
    (this.dust.material as THREE.ShaderMaterial).uniforms.pr.value = pr;
    (this.puffs.material as THREE.ShaderMaterial).uniforms.pr.value = pr;
  }

  dispose() {
    this.composer.dispose();
    if (this.armMixer) { this.armMixer.setTime(0); this.armMixer.stopAllAction(); }
    if (this.shoulder) this.shoulder.updateMatrix();
    if (this.head) this.head.quaternion.copy(this.headBase);
    if (this.model) this.rover.remove(this.model); // keep the shared GLB for replays
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.Points).isPoints) {
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        (Array.isArray(mat) ? mat : [mat]).forEach((x) => x?.dispose());
      }
    });
  }
}

/** Direction `worldAxisInRoot` (expressed in `root` space) converted into `node`'s parent space. */
function axisInParent(node: THREE.Object3D, root: THREE.Object3D, axisInRoot: THREE.Vector3) {
  root.updateMatrixWorld(true);
  const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
  const parentQ = node.parent ? node.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  const world = axisInRoot.clone().applyQuaternion(rootQ);
  return world.applyQuaternion(parentQ.invert()).normalize();
}

function catmull(pts: THREE.Vector3[], i: number, f: number) {
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[Math.min(pts.length - 1, i + 1)], p3 = pts[Math.min(pts.length - 1, i + 2)];
  const f2 = f * f, f3 = f2 * f;
  return new THREE.Vector3(
    0.5 * (2 * p1.x + (-p0.x + p2.x) * f + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f3),
    0.5 * (2 * p1.y + (-p0.y + p2.y) * f + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f3),
    0.5 * (2 * p1.z + (-p0.z + p2.z) * f + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * f2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * f3),
  );
}
