import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Stage } from '../../core/Engine';
import type { Assets } from '../../core/Assets';
import { Terrain, makeDetailTextures } from './terrain';
import { rng, rockGeometry, createBeacon, createSpecimen, createAres7 } from './props';

export const MAX_SPEED = 7; // m/s (gameplay). Real Perseverance: 0.042 m/s (0.152 km/h).
const TURN_RATE = 1.05;
const MAX_CLIMB_DEG = 27;
const SUN_DIR = new THREE.Vector3(-0.55, 0.62, -0.56).normalize();

// Linear-space colours (output is tone-mapped + sRGB encoded by OutputPass).
const HORIZON = new THREE.Color().setRGB(0.72, 0.44, 0.25);
const STORM_FOG = new THREE.Color().setRGB(0.26, 0.13, 0.065);
const RIM_COLOR = new THREE.Color().setRGB(0.5, 0.29, 0.17);

export type Beacon = ReturnType<typeof createBeacon> & { pos: THREE.Vector3 };

export interface Boulder { x: number; z: number; r: number }

/**
 * Jezero crater, Mars. Real HiRISE terrain + Perseverance model.
 * The mission drives it; this class owns rendering, rover motion and effects.
 */
export class MarsStage implements Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 9000);
  readonly terrain: Terrain;
  private composer: EffectComposer;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private skyMat: THREE.ShaderMaterial;
  private fog: THREE.FogExp2;
  private rimMat!: THREE.MeshBasicMaterial;

  // rover
  readonly rover = new THREE.Group();
  private roverModel: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private armActions: THREE.AnimationAction[] = [];
  readonly roverPos = new THREE.Vector3();
  roverYaw = 0;
  speed = 0;
  blocked = false; // last frame was blocked by slope / obstacle
  distance = 0; // odometer (m)
  readonly boulders: Boulder[] = [];

  // camera rig
  camYaw = 0;
  camPitch = 0.3;
  camDist = 10;
  private camIdle = 0;
  private camPos = new THREE.Vector3();
  private lookCur = new THREE.Vector3();
  /** When set, the camera orbits this point (cutscenes). */
  focus: THREE.Vector3 | null = null;
  private focusAngle = 0;

  // effects
  storm = 0;
  private dust: THREE.Points;
  private puffs: THREE.Points;
  private puffData: { life: Float32Array; vel: Float32Array; next: number };
  private tracks: { mesh: THREE.Mesh; idx: number; last: THREE.Vector3 | null; count: number };
  readonly beacons = new Map<string, Beacon>();
  readonly specimens = new Map<string, THREE.Object3D>();
  readonly ares = createAres7();
  aresVisible = false;
  private elapsed = 0;
  paused = false;

  constructor(assets: Assets, renderer: THREE.WebGLRenderer, quality: 'low' | 'medium' | 'high') {
    const detail = makeDetailTextures();
    this.terrain = new Terrain(assets, detail);
    this.scene.add(this.terrain.mesh);

    // Sky dome: butterscotch daytime sky with the bluish glow around the Sun seen in rover images.
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: SUN_DIR }, storm: { value: 0 }, horizon: { value: HORIZON.clone() } },
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 sunDir; uniform float storm; uniform vec3 horizon; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 zenith = vec3(0.26, 0.12, 0.065);
          vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.5));
          float sd = max(dot(d, sunDir), 0.0);
          col += vec3(0.5, 0.62, 0.85) * pow(sd, 40.0) * 0.55;   // bluish aureole
          col += vec3(1.0, 0.85, 0.65) * pow(sd, 6.0) * 0.18;    // broad forward-scatter glow
          col += vec3(1.0, 0.97, 0.9) * smoothstep(0.99955, 0.9998, sd) * 18.0; // small Sun disk
          vec3 stormCol = mix(vec3(0.26, 0.13, 0.065), vec3(0.16, 0.08, 0.04), max(h, 0.0));
          stormCol += vec3(0.5, 0.35, 0.2) * pow(sd, 8.0) * 0.35;
          col = mix(col, stormCol, storm);
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), this.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.scene.add(sky);

    this.fog = new THREE.FogExp2(HORIZON.clone(), 0.0019);
    this.scene.fog = this.fog;
    this.scene.add(this.buildDistantRim());
    this.scene.add(this.buildOuterGround());

    // Lighting: low warm Sun + sky/ground bounce.
    this.sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1.0, 0.86, 0.7), 3.2);
    this.sun.castShadow = true;
    const sm = quality === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -38; sc.right = sc.top = 38; sc.near = 1; sc.far = 300;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(new THREE.Color().setRGB(0.75, 0.55, 0.42), new THREE.Color().setRGB(0.35, 0.18, 0.1), 0.85);
    this.scene.add(this.hemi);

    this.scatterRocks();
    this.setupRover(assets);

    this.scene.add(this.ares.group);
    this.ares.group.visible = false;
    this.ares.setDust(1);

    this.dust = this.buildDust();
    this.scene.add(this.dust);
    const p = this.buildPuffs();
    this.puffs = p.points;
    this.puffData = p.data;
    this.scene.add(this.puffs);
    this.tracks = this.buildTracks();
    this.scene.add(this.tracks.mesh);

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.6, 0.92));
    this.composer.addPass(new OutputPass());
  }

  // ─────────────────────────────────────────── world building
  /** Silhouetted crater-rim hills in the far distance (procedural, fogged, purely scenic). */
  private buildDistantRim() {
    const r = rng(77);
    const seg = 256;
    const geo = new THREE.CylinderGeometry(3600, 3600, 1, seg, 6, true);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const phases = Array.from({ length: 6 }, () => r() * Math.PI * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      const a = Math.atan2(z, x);
      let h = 0;
      [3, 7, 13, 29, 53, 97].forEach((f, k) => (h += Math.sin(a * f + phases[k]) / (k + 1.4)));
      const top = 120 + 140 * (h * 0.5 + 0.5);
      pos.setY(i, y > 0 ? top : -60);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: RIM_COLOR.clone(), fog: false, side: THREE.BackSide });
    this.rimMat = mat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 10;
    mesh.userData.isRim = true;
    return mesh;
  }

  /** Flat ground beyond the DTM so the horizon never shows an edge. */
  private buildOuterGround() {
    const g = new THREE.RingGeometry(700, 4000, 64, 4);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.33, 0.17, 0.09), roughness: 1 }));
    m.position.y = 8;
    m.receiveShadow = false;
    return m;
  }

  private scatterRocks() {
    const r = rng(2026);
    const t = this.terrain;
    const half = t.size / 2 - 20;
    const dummy = new THREE.Object3D();
    const variants = [rockGeometry(1, 1), rockGeometry(2, 1, 0.5), rockGeometry(3, 1, 0.8)];
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.02 });
    const tint = new THREE.Color();
    const place = (count: number, minS: number, maxS: number, shadows: boolean, boulder: boolean, radius: number) => {
      for (const [vi, geo] of variants.entries()) {
        const inst = new THREE.InstancedMesh(geo, mat, Math.ceil(count / variants.length));
        let n = 0;
        let guard = 0;
        while (n < inst.count && guard++ < inst.count * 20) {
          const x = (r() * 2 - 1) * Math.min(half, radius), z = (r() * 2 - 1) * Math.min(half, radius);
          const rock = t.rockiness(x, z);
          if (r() > 0.45 + rock * 0.8) continue; // more rocks on bright (rocky) terrain
          if (boulder && t.slopeAt(x, z) > 20) continue;
          const s = minS * Math.pow(maxS / minS, Math.pow(r(), 2.2)); // many small, few large
          dummy.position.set(x, t.heightAt(x, z) - s * 0.25, z);
          dummy.rotation.set(r() * 0.5, r() * Math.PI * 2, r() * 0.5);
          dummy.scale.set(s * (0.8 + r() * 0.5), s, s * (0.8 + r() * 0.5));
          dummy.updateMatrix();
          inst.setMatrixAt(n, dummy.matrix);
          const shade = 0.55 + r() * 0.5;
          tint.setRGB(0.36 * shade, 0.2 * shade, 0.13 * shade);
          if (r() < 0.25) tint.setRGB(0.16 * shade, 0.14 * shade, 0.13 * shade); // dark basaltic blocks
          inst.setColorAt(n, tint);
          if (boulder && s > 0.9) this.boulders.push({ x, z, r: s * 0.9 });
          n++;
        }
        inst.count = n;
        inst.castShadow = shadows;
        inst.receiveShadow = true;
        inst.userData.variant = vi;
        this.scene.add(inst);
      }
    };
    place(18000, 0.06, 0.35, false, false, 380); // gravel and cobbles near the play area
    place(1800, 0.3, 1.1, true, false, 600);
    place(140, 0.9, 2.6, true, true, 600); // boulders (collidable)
  }

  private setupRover(assets: Assets) {
    const g = assets.models.rover;
    if (g) {
      const model = g.scene;
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
      });
      this.roverModel = model;
      this.rover.add(model);
      this.mixer = new THREE.AnimationMixer(model);
      // Arm/turret clips: played for sample collection.
      for (const clip of g.animations) {
        if (/^(arm|turret|hinge)/i.test(clip.name)) {
          const a = this.mixer.clipAction(clip);
          a.setLoop(THREE.LoopOnce, 1);
          a.clampWhenFinished = true;
          this.armActions.push(a);
        }
      }
    } else {
      // Fallback if the model failed to load: simple stand-in so the mission still works.
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1, 3), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
      body.position.y = 1;
      this.rover.add(body);
    }
    this.scene.add(this.rover);
  }

  /** Plays Perseverance's own arm/turret animation (from the NASA model) for sample collection. */
  async playArm(seconds = 5.5) {
    if (!this.armActions.length) return new Promise<void>((r) => setTimeout(r, seconds * 1000));
    for (const a of this.armActions) {
      a.reset();
      a.timeScale = a.getClip().duration / (seconds * 2);
      a.play();
    }
    await new Promise((r) => setTimeout(r, seconds * 1000));
    // stow: play back to the start
    for (const a of this.armActions) {
      a.timeScale = -a.timeScale * 1.6;
      a.paused = false;
    }
    await new Promise((r) => setTimeout(r, (seconds / 1.6) * 1000 + 200));
    for (const a of this.armActions) a.stop();
  }

  private buildDust() {
    const N = 2600;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const r = rng(9);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (r() - 0.5) * 120; pos[i * 3 + 1] = r() * 40; pos[i * 3 + 2] = (r() - 0.5) * 120;
      seed[i] = r();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, storm: { value: 0 }, origin: { value: new THREE.Vector3() }, wind: { value: new THREE.Vector3(9, 0, 4) }, pr: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float seed; uniform float time; uniform float storm; uniform vec3 origin; uniform vec3 wind; uniform float pr;
        varying float vA;
        void main(){
          vec3 p = position + wind * time * (0.15 + storm) * (0.6 + seed);
          p = mod(p - origin + vec3(60.0, 0.0, 60.0), vec3(120.0, 40.0, 120.0)) - vec3(60.0, 0.0, 60.0) + origin;
          p.y = origin.y - 6.0 + mod(position.y + seed * 7.0 + time * (0.3 + storm), 40.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float shown = step(seed, 0.12 + storm * 0.88);
          gl_PointSize = (40.0 + storm * 220.0) * pr / -mv.z * shown;
          vA = shown * (0.16 + storm * 0.42) * smoothstep(90.0, 4.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(0.62, 0.42, 0.28), vA * smoothstep(0.5, 0.0, d)); }`,
      transparent: true,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  private buildPuffs() {
    const N = 360;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('life', new THREE.BufferAttribute(new Float32Array(N), 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { pr: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float life; varying float vL; uniform float pr;
        void main(){ vL = life; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = (60.0 + (1.0 - life) * 180.0) * pr / -mv.z * step(0.001, life); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        varying float vL;
        void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(0.66, 0.46, 0.32), vL * 0.32 * smoothstep(0.5, 0.05, d)); }`,
      transparent: true,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return { points: pts, data: { life: geo.attributes.life.array as Float32Array, vel: new Float32Array(N * 3), next: 0 } };
  }

  private buildTracks() {
    const MAX = 1400; // quads (alternating left/right)
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 4 * 3), 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(MAX * 4), 1));
    const idx: number[] = [];
    for (let q = 0; q < MAX; q++) idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 2, q * 4 + 1, q * 4 + 3);
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `varying float vA; void main(){ gl_FragColor = vec4(0.12, 0.05, 0.02, vA * 0.42); }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return { mesh, idx: 0, last: null as THREE.Vector3 | null, count: MAX };
  }

  // ─────────────────────────────────────────── beacons & props
  addBeacon(id: string, pos: THREE.Vector3, color: number, radius = 2.6) {
    this.removeBeacon(id);
    const b = createBeacon(color) as Beacon;
    b.pos = pos.clone();
    b.group.position.copy(pos);
    b.setRadius(radius);
    this.scene.add(b.group);
    this.beacons.set(id, b);
    return b;
  }
  removeBeacon(id: string) {
    const b = this.beacons.get(id);
    if (!b) return;
    this.scene.remove(b.group);
    b.dispose();
    this.beacons.delete(id);
  }
  addSpecimen(id: string, kind: 'igneous' | 'hematite' | 'sedimentary', pos: THREE.Vector3) {
    const s = createSpecimen(kind);
    s.position.copy(pos);
    s.position.y = this.terrain.heightAt(pos.x, pos.z) - 0.05;
    this.scene.add(s);
    this.specimens.set(id, s);
  }
  removeSpecimen(id: string) {
    const s = this.specimens.get(id);
    if (s) this.scene.remove(s);
    this.specimens.delete(id);
  }

  /** Find the flattest point within radius (m) of a world position. */
  findFlat(center: THREE.Vector3, radius: number) {
    let best = center.clone(), bestSlope = Infinity;
    for (let i = 0; i < 80; i++) {
      const a = (i / 80) * Math.PI * 2 * 7.3, d = radius * Math.sqrt(i / 80);
      const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
      const s = this.terrain.slopeAt(x, z);
      if (s < bestSlope) { bestSlope = s; best = new THREE.Vector3(x, 0, z); }
    }
    best.y = this.terrain.heightAt(best.x, best.z);
    return best;
  }

  placeRover(pos: THREE.Vector3, yaw: number) {
    this.roverPos.set(pos.x, this.terrain.heightAt(pos.x, pos.z), pos.z);
    this.roverYaw = yaw;
    this.speed = 0;
    this.tracks.last = null;
    this.camPos.set(0, 0, 0);
    this.lookCur.set(0, 0, 0);
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.roverYaw), 0, Math.cos(this.roverYaw));
  }

  // ─────────────────────────────────────────── per-frame control
  /** throttle/steer in -1..1. Returns warnings. */
  drive(throttle: number, steer: number, dt: number, maxSpeed = MAX_SPEED) {
    const target = throttle * maxSpeed;
    const accel = Math.sign(target - this.speed) === Math.sign(this.speed) || this.speed === 0 ? 3.2 : 7;
    const ds = target - this.speed;
    this.speed += Math.sign(ds) * Math.min(Math.abs(ds), accel * dt);
    // Rocker-bogie rovers can turn on the spot; steering is slower at speed.
    const turnScale = 1 - Math.min(Math.abs(this.speed) / maxSpeed, 1) * 0.35;
    this.roverYaw -= steer * TURN_RATE * turnScale * dt * (this.speed < -0.2 ? -1 : 1);

    const t = this.terrain;
    const f = this.forward;
    const step = this.speed * dt;
    const nx = this.roverPos.x + f.x * step, nz = this.roverPos.z + f.z * step;
    this.blocked = false;
    // Uphill slope limit.
    const rise = t.heightAt(nx + f.x * Math.sign(step) * 1.5, nz + f.z * Math.sign(step) * 1.5) - t.heightAt(nx, nz);
    const climb = THREE.MathUtils.radToDeg(Math.atan2(rise, 1.5));
    const lim = t.size / 2 - 40;
    let ok = climb < MAX_CLIMB_DEG && Math.abs(nx) < lim && Math.abs(nz) < lim;
    for (const b of this.boulders) {
      const dx = nx - b.x, dz = nz - b.z;
      if (dx * dx + dz * dz < (b.r + 1.4) ** 2) { ok = false; break; }
    }
    if (ok) {
      this.roverPos.x = nx;
      this.roverPos.z = nz;
      this.distance += Math.abs(step);
    } else if (Math.abs(this.speed) > 0.3) {
      this.speed *= 0.2;
      this.blocked = true;
    }
    return { climb, blocked: this.blocked };
  }

  /** Orbit the chase camera (radians) and zoom (steps). */
  orbit(dYaw: number, dPitch: number, zoomSteps = 0) {
    if (dYaw || dPitch || zoomSteps) this.camIdle = 0;
    this.camYaw += dYaw;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + dPitch, 0.05, 1.2);
    this.camDist = THREE.MathUtils.clamp(this.camDist * Math.pow(1.12, zoomSteps), 5, 28);
  }

  /** Move ARES-7 toward a world point (follow mode). */
  moveAres(target: THREE.Vector3, dt: number, maxSpeed: number) {
    const g = this.ares.group;
    const to = target.clone().sub(g.position);
    to.y = 0;
    const d = to.length();
    if (d > 0.3) {
      const step = Math.min(d, maxSpeed * dt);
      to.normalize();
      g.position.x += to.x * step;
      g.position.z += to.z * step;
      const yaw = Math.atan2(to.x, to.z);
      g.rotation.y += Math.atan2(Math.sin(yaw - g.rotation.y), Math.cos(yaw - g.rotation.y)) * Math.min(1, dt * 4);
    }
    g.position.y = this.terrain.heightAt(g.position.x, g.position.z);
  }

  update(dt: number) {
    this.elapsed += dt;
    const t = this.terrain;
    if (this.mixer) this.mixer.update(dt);

    // Rover pose on the terrain: average of four contact points → pitch & roll.
    const f = this.forward, rgt = new THREE.Vector3(f.z, 0, -f.x);
    const P = this.roverPos;
    const hF = t.heightAt(P.x + f.x * 1.3, P.z + f.z * 1.3), hB = t.heightAt(P.x - f.x * 1.3, P.z - f.z * 1.3);
    const hR = t.heightAt(P.x + rgt.x * 1.2, P.z + rgt.z * 1.2), hL = t.heightAt(P.x - rgt.x * 1.2, P.z - rgt.z * 1.2);
    P.y = (hF + hB + hR + hL) / 4;
    const pitch = Math.atan2(hF - hB, 2.6), roll = Math.atan2(hR - hL, 2.4);
    this.rover.position.copy(P);
    this.rover.rotation.set(0, 0, 0);
    this.rover.rotateY(this.roverYaw);
    this.rover.rotateX(-pitch);
    this.rover.rotateZ(-roll);

    // Chase camera with gentle auto-recentre, or a slow cinematic orbit around a focus point.
    this.camIdle += dt;
    if (this.camIdle > 2.5) this.camYaw *= Math.exp(-dt * 1.2);
    let want: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.focus) {
      this.focusAngle += dt * 0.22;
      const F = this.focus;
      want = new THREE.Vector3(F.x + Math.sin(this.focusAngle) * 10, 0, F.z + Math.cos(this.focusAngle) * 10);
      want.y = t.heightAt(want.x, want.z) + 4.2;
      look = F.clone().add(new THREE.Vector3(0, 1.1, 0));
    } else {
      const yaw = this.roverYaw + Math.PI + this.camYaw;
      const horiz = Math.cos(this.camPitch) * this.camDist;
      want = new THREE.Vector3(P.x + Math.sin(yaw) * horiz, P.y + 1.6 + Math.sin(this.camPitch) * this.camDist, P.z + Math.cos(yaw) * horiz);
      look = new THREE.Vector3(P.x, P.y + 1.3, P.z);
    }
    want.y = Math.max(want.y, t.heightAt(want.x, want.z) + 1.4);
    if (this.camPos.lengthSq() === 0) this.camPos.copy(want);
    this.camPos.lerp(want, 1 - Math.exp(-dt * (this.focus ? 1.6 : 5)));
    this.lookCur.lerp(look, this.lookCur.lengthSq() === 0 ? 1 : 1 - Math.exp(-dt * 6));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.lookCur);

    // Shadow frustum follows the rover.
    this.sun.position.copy(P).addScaledVector(SUN_DIR, 120);
    this.sun.target.position.copy(P);

    // Storm look.
    const s = this.storm;
    this.fog.density = 0.0019 + s * s * 0.034;
    this.fog.color.copy(HORIZON).lerp(STORM_FOG, s);
    this.skyMat.uniforms.storm.value = s;
    this.rimMat.color.copy(RIM_COLOR).lerp(STORM_FOG, Math.min(1, s * 2.2)); // distant hills vanish into the storm
    this.sun.intensity = 3.2 * (1 - s * 0.72);
    this.hemi.intensity = 0.85 * (1 - s * 0.35);
    const dm = this.dust.material as THREE.ShaderMaterial;
    dm.uniforms.time.value = this.elapsed;
    dm.uniforms.storm.value = s;
    dm.uniforms.origin.value.copy(this.camera.position);

    for (const b of this.beacons.values()) b.update(this.elapsed);
    this.updatePuffs(dt);
    this.updateTracks();
  }

  private updatePuffs(dt: number) {
    const geo = this.puffs.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const { life, vel } = this.puffData;
    const n = life.length;
    // spawn behind the rear wheels when moving
    const sp = Math.abs(this.speed);
    if (sp > 0.8 && !this.paused) {
      const f = this.forward, rgt = new THREE.Vector3(f.z, 0, -f.x);
      const count = Math.min(3, Math.ceil(sp / 3));
      for (let k = 0; k < count; k++) {
        const i = this.puffData.next;
        this.puffData.next = (i + 1) % n;
        const side = k % 2 ? 1 : -1;
        const x = this.roverPos.x - f.x * 1.4 * Math.sign(this.speed) + rgt.x * side * 1.1;
        const z = this.roverPos.z - f.z * 1.4 * Math.sign(this.speed) + rgt.z * side * 1.1;
        pos.setXYZ(i, x, this.terrain.heightAt(x, z) + 0.2, z);
        vel[i * 3] = (Math.random() - 0.5) * 0.8; vel[i * 3 + 1] = 0.3 + Math.random() * 0.4; vel[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
        life[i] = 0.6 + Math.min(sp / MAX_SPEED, 1) * 0.4;
      }
    }
    for (let i = 0; i < n; i++) {
      if (life[i] <= 0) continue;
      life[i] = Math.max(0, life[i] - dt * 0.55);
      pos.setXYZ(i, pos.getX(i) + vel[i * 3] * dt, pos.getY(i) + vel[i * 3 + 1] * dt, pos.getZ(i) + vel[i * 3 + 2] * dt);
    }
    pos.needsUpdate = true;
    (geo.attributes.life as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateTracks() {
    const tr = this.tracks;
    const P = this.roverPos;
    if (tr.last && tr.last.distanceToSquared(P) < 0.45 * 0.45) return;
    const f = this.forward, rgt = new THREE.Vector3(f.z, 0, -f.x);
    if (tr.last) {
      const pos = tr.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const alpha = tr.mesh.geometry.attributes.alpha as THREE.BufferAttribute;
      const prev = tr.last;
      for (const side of [-1, 1]) {
        const q = tr.idx;
        tr.idx = (tr.idx + 1) % tr.count;
        const w = 0.22, off = 1.05 * side;
        const pts = [
          [prev.x + rgt.x * (off - w), prev.z + rgt.z * (off - w)], [prev.x + rgt.x * (off + w), prev.z + rgt.z * (off + w)],
          [P.x + rgt.x * (off - w), P.z + rgt.z * (off - w)], [P.x + rgt.x * (off + w), P.z + rgt.z * (off + w)],
        ];
        pts.forEach(([x, z], k) => {
          pos.setXYZ(q * 4 + k, x, this.terrain.heightAt(x, z) + 0.04, z);
          alpha.setX(q * 4 + k, 1);
        });
      }
      // fade older tracks
      for (let i = 0; i < alpha.count; i++) alpha.setX(i, alpha.getX(i) * 0.9995);
      pos.needsUpdate = true;
      alpha.needsUpdate = true;
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
    this.mixer?.stopAllAction();
    if (this.roverModel) this.rover.remove(this.roverModel); // keep the shared GLB intact for replays
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
