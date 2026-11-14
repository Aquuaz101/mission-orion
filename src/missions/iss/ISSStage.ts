import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { Stage } from '../../core/Engine';
import type { Assets } from '../../core/Assets';
import type { Quality } from '../../app/App';
import { makeMaterials, handrail, batteryOru, pistolGripTool, type Mats, type Oru } from './parts';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { emuArm, emuArmModel, suitMaterials, setGrip, type EmuHand } from './hands';
import { earthMaterial, atmosphereMaterial, RaysShader, VisorShader, visorDirt, glowTex, R_EARTH, ALT } from './issfx';

/**
 * Mission 03 stage. NASA's high-detail ISS (IGOAL model) at real scale in metres; Earth at true LEO scale in a
 * separate km "sky" pass. Station frame: +Y zenith (Earth below), -X ram (direction of flight), +Z starboard.
 *
 * First person through an EMU helmet: hands anchor to real world points (handrails, hatch handle, bolts,
 * the ORU handle, the arm's handhold) so nothing is ever grabbed in mid-air.
 */
const ORBIT_RATE = (Math.PI * 2) / (92.7 * 60);
/** Ground track under the station at the start: Gulf of Mexico at night, heading ENE over Florida/the Bahamas. */
const START = { lat: 24.5, lon: -88, heading: 58 };
/** Quest crewlock outboard hatch (measured from the NASA model), opening toward +Z (starboard). */
export const HATCH = new THREE.Vector3(4.07, -4.85, 7.65);
/** Worksite: P3 truss forward (ram, -X) face, beside the P4 solar arrays. */
export const SITE = new THREE.Vector3(-1.82, 0.0, -23.0);
/** Station model is in inches × 0.00258 → metres. */
const MODEL_SCALE = 9.8378;

const PRESETS: Record<Quality, { shadow: number; bloom: boolean; msaa: number; seg: number; rays: boolean; occDiv: number }> = {
  high: { shadow: 2048, bloom: true, msaa: 4, seg: 512, rays: true, occDiv: 2 },
  medium: { shadow: 1536, bloom: true, msaa: 2, seg: 384, rays: true, occDiv: 3 },
  low: { shadow: 1024, bloom: false, msaa: 0, seg: 256, rays: false, occDiv: 4 },
};

type Vec = THREE.Vector3;
type Getter = () => Vec;
interface Travel { pts: THREE.CatmullRomCurve3; look: THREE.CatmullRomCurve3; t: number; dur: number; ease: (k: number) => number; resolve: () => void }
interface Streak { p: Vec; v: Vec; len: number; life: number }
interface Spark { p: Vec; v: Vec; life: number }

/** One arm: either posed in camera space (tweened) or anchored to a moving world point. */
class HandCtl {
  mode: 'pose' | 'anchor' = 'pose';
  private from = { p: new THREE.Vector3(), q: new THREE.Quaternion(), g: 0.3 };
  private to = { p: new THREE.Vector3(), q: new THREE.Quaternion(), g: 0.3 };
  private t = 1;
  private dur = 0.5;
  private getter: Getter | null = null;
  private grip = 0.9;
  private onReached: (() => void) | null = null;
  readonly shoulder: Vec;
  constructor(public h: EmuHand, private cam: THREE.Camera, private side: number) {
    this.shoulder = new THREE.Vector3(0.22 * side, -0.32, 0.08);
  }
  /** World point this hand holds (anchor mode), for the third-person astronaut to mirror. */
  target(): Vec | null { return this.mode === 'anchor' && this.getter ? this.getter() : null; }
  private snapshot() { this.from.p.copy(this.h.root.position); this.from.q.copy(this.h.root.quaternion); this.from.g = this.h.grip; this.t = 0; }
  /** True while an idle gesture owns this hand; any scripted pose/anchor/rest takes over immediately. */
  idling = false;
  get settled() { return this.t >= 1; }
  pose(p: [number, number, number], r: [number, number, number], g: number, dur = 0.5, idle = false) {
    this.idling = idle;
    this.snapshot();
    this.mode = 'pose';
    this.getter = null;
    this.to.p.set(...p);
    this.to.q.setFromEuler(new THREE.Euler(...r));
    this.to.g = g;
    this.dur = dur;
    return new Promise<void>((res) => (this.onReached = res));
  }
  rest(dur = 0.6) { return this.pose([0.25 * this.side, -0.4, -0.5], [0.3, 0.22 * this.side, 0.35 * this.side], 0.3, dur); }
  anchor(get: Getter, grip = 0.9, dur = 0.45, contact: 'wrap' | 'tip' = 'wrap') {
    this.idling = false;
    this.snapshot();
    this.logged = false;
    this.gripLocal = contact === 'tip' ? HandCtl.TIP_LOCAL : HandCtl.GRIP_LOCAL;
    this.mode = 'anchor';
    this.getter = get;
    this.grip = grip;
    this.dur = dur;
    return new Promise<void>((res) => (this.onReached = res));
  }
  private tmpQ = new THREE.Quaternion();
  /** Where the rail sits inside the closed glove (hand-root space): under the proximal finger segments. */
  static readonly GRIP_LOCAL = new THREE.Vector3(0, -0.028, -0.1);
  static readonly MAX_REACH = 0.82;
  /** Fingertip / tool-tip contact point (hand-root space) for flat targets: bolts, connector ports. */
  static readonly TIP_LOCAL = new THREE.Vector3(0, -0.025, -0.175);
  private gripLocal = HandCtl.GRIP_LOCAL;
  /** Sleeve axis in hand-root space (wrist → elbow; the model's built-in 35° wrist bend) and the hand's lateral axis. */
  static readonly SLEEVE = new THREE.Vector3(0, -0.58, 0.81).normalize();
  static readonly RIGHT = new THREE.Vector3(1, 0, 0);
  /** Grabs that could not reach their target (metres short), for QA. */
  static misses: { side: number; short: number; at: number }[] = [];
  private logged = false;
  update(dt: number) {
    this.t = Math.min(1, this.t + dt / this.dur);
    const e = this.t * this.t * (3 - 2 * this.t);
    const root = this.h.root;
    if (this.mode === 'anchor' && this.getter) {
      const local = this.cam.worldToLocal(this.getter().clone());
      // aim the forearm from the shoulder at the grip point, then place the wrist so the rail lands inside the curled fingers
      // Solve the forearm: the sleeve (hand-space axis SLEEVE) runs from the wrist back to this arm's shoulder, the hand's
      // +X stays toward camera-right, and the wrist sits where the grip point lands on the target (two passes converge).
      let want = local.clone().addScaledVector(local.clone().sub(this.shoulder).normalize(), -0.14);
      for (let k = 0; k < 3; k++) {
        const toShoulder = this.shoulder.clone().sub(want).normalize();
        this.tmpQ.copy(pairRotation(HandCtl.SLEEVE, HandCtl.RIGHT, toShoulder, HandCtl.RIGHT));
        want = local.clone().sub(this.gripLocal.clone().applyQuaternion(this.tmpQ));
      }
      const fromShoulder = want.clone().sub(this.shoulder);
      const need = fromShoulder.length();
      if (need > HandCtl.MAX_REACH) {
        fromShoulder.setLength(HandCtl.MAX_REACH);
        if (this.t >= 1 && !this.logged && this.cam.parent?.type !== 'Scene' && need - HandCtl.MAX_REACH > 0.02) { this.logged = true; HandCtl.misses.push({ side: this.side, short: +(need - HandCtl.MAX_REACH).toFixed(3), at: performance.now() }); }
      }
      const target = this.shoulder.clone().add(fromShoulder);
      root.position.lerpVectors(this.from.p, target, e);
      root.quaternion.slerpQuaternions(this.from.q, this.tmpQ, e);
      setGrip(this.h, THREE.MathUtils.lerp(this.from.g, this.grip, THREE.MathUtils.smoothstep(this.t, 0.55, 1)));
    } else {
      root.position.lerpVectors(this.from.p, this.to.p, e);
      root.quaternion.slerpQuaternions(this.from.q, this.to.q, e);
      // breathing sway: the arms rise and settle with each breath, never quite still
      const bt = performance.now() / 1000;
      root.position.y += Math.sin(bt * 1.6 + this.side) * 0.006;
      root.position.x += Math.sin(bt * 0.45 + this.side * 2) * 0.004;
      setGrip(this.h, THREE.MathUtils.lerp(this.from.g, this.to.g, e));
    }
    if (this.t >= 1 && this.onReached) { const r = this.onReached; this.onReached = null; r(); }
  }
}

/** Fine micro-scratch / smudge roughness map for the gold visor. */
function visorScratches() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(18,18,18)'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 220; i++) { const x = Math.random() * 512, y = Math.random() * 512, a = Math.random() * Math.PI, l = 8 + Math.random() * 60; g.strokeStyle = `rgba(120,120,120,${0.15 + Math.random() * 0.35})`; g.lineWidth = Math.random() < 0.8 ? 0.6 : 1.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  for (let i = 0; i < 14; i++) { const r = 20 + Math.random() * 70, x = Math.random() * 512, y = Math.random() * 512; const grd = g.createRadialGradient(x, y, 0, x, y, r); grd.addColorStop(0, 'rgba(90,90,90,0.35)'); grd.addColorStop(1, 'rgba(90,90,90,0)'); g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2); }
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Rotation taking the pair (a1 primary, b1 secondary) onto (a2, b2): a1 → a2 exactly, b1 → b2 as closely as possible. */
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _pq = new THREE.Quaternion();
function basisOf(m: THREE.Matrix4, a: THREE.Vector3, b: THREE.Vector3) {
  const u = a.clone().normalize();
  const v = b.clone().addScaledVector(u, -u.dot(b)).normalize();
  return m.makeBasis(u, v, u.clone().cross(v));
}
function pairRotation(a1: THREE.Vector3, b1: THREE.Vector3, a2: THREE.Vector3, b2: THREE.Vector3) {
  basisOf(_m1, a1, b1); basisOf(_m2, a2, b2);
  return _pq.setFromRotationMatrix(_m2.multiply(_m1.transpose()));
}

/** QA hook: grabs that fell short of their rail. */
export const grabMisses = () => HandCtl.misses;

export class ISSStage implements Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.03, 3000);
  private sky = new THREE.Scene();
  private skyCam = new THREE.PerspectiveCamera(72, 16 / 9, 20, 40000);
  private composer: EffectComposer;
  private raysPass: ShaderPass;
  private visor: ShaderPass;
  private preset: (typeof PRESETS)['high'];
  readonly m: Mats;

  // sky
  private earth: THREE.Mesh;
  private earthMat: THREE.ShaderMaterial;
  private atmo: THREE.ShaderMaterial;
  private earthQ0 = new THREE.Quaternion();
  private orbitAngle = 0;
  private sunSprite: THREE.Sprite;
  /** Sun elevation above the station's local horizontal (deg). The Earth's limb sits at about -20.2°. */
  sunElev = -24;
  private sunTween: { from: number; to: number; t: number; dur: number } | null = null;
  readonly sunDir = new THREE.Vector3();

  // lights
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private lamps: THREE.SpotLight[] = [];
  private airlockLight: THREE.PointLight;

  // body + camera
  readonly body = new THREE.Object3D();
  private bodyLook = new THREE.Vector3();
  private travel: Travel | null = null;
  lookYaw = 0;
  lookPitch = 0;
  shake = 0;
  private kickT = 9;
  private kickAmp = 0;
  private elapsed = 0;
  paused = false;

  // arms + tools
  readonly L: HandCtl;
  readonly R: HandCtl;
  readonly pgt: ReturnType<typeof pistolGripTool>;
  readonly rig = new THREE.Group();
  readonly rigRail = new THREE.Vector3(-0.34, -0.5, -0.5); // handhold on the arm's foot restraint (body space)

  // station + job
  station: THREE.Object3D | null = null;
  readonly dock = new THREE.Group();
  readonly site = new THREE.Group();
  hatch!: THREE.Group;
  readonly oldOru: Oru;
  readonly newOru: Oru;
  readonly siteRails: Vec[] = [];
  private tether: THREE.Line;
  tetherAnchor: Vec | null = null;
  private meshes: THREE.Mesh[] = [];
  private shadowTick = 0;

  // effects
  private occRT: THREE.WebGLRenderTarget;
  private occScene = new THREE.Scene();
  private occSun: THREE.Sprite;
  private black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  private raysOn = false;
  debris = 0;
  private streaks: Streak[] = [];
  private streakGeo: THREE.BufferGeometry;
  private sparks: Spark[] = [];
  private sparkGeo: THREE.BufferGeometry;
  private dust: THREE.Points;
  exposure = 1.2;
  fog = 0.2;
  alert = 0;
  dark = 0;
  private flashT = 0;
  private tickers = new Set<(dt: number) => void>();
  /** Debris stream source direction (the cloud arrives from behind the station, the wake side). */
  readonly debrisFrom = new THREE.Vector3(1, 0, 0);
  /** Third-person EMU astronaut for cutscenes (head = the helmet camera position). */
  private suit: THREE.Object3D | null = null;
  private suitJ: Record<string, THREE.Object3D> = {};
  private suitRest = new Map<THREE.Object3D, THREE.Quaternion>();
  private suitPrev = new Map<THREE.Object3D, THREE.Quaternion>();
  private suitDt = 0.016;
  // live visor reflections for the close-up: a cube camera at the helmet, the real station + debris + Sun + an Earth proxy
  private visorRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  private visorCam = new THREE.CubeCamera(0.05, 3000, this.visorRT);
  private visorLive = false;
  private visorTick = 0;
  readonly visorMat = new THREE.MeshPhysicalMaterial({ color: 0xe6ad45, metalness: 1, roughness: 0.035, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6 });
  private earthProxy: THREE.Mesh;
  private sunProxy: THREE.Mesh;
  private idleT = 7;
  private cineLight: THREE.PointLight;
  /** Playback rate for slow motion inside cutscenes. */
  timeScale = 1;
  private cineState: { skip: boolean } | null = null;
  get inCine() { return !!this.cineState; }
  /** External (third-person) camera for the mission-exit pull-out. */
  private ext: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private glint: THREE.Sprite;

  constructor(assets: Assets, renderer: THREE.WebGLRenderer, quality: Quality, stationGltf: GLTF | null) {
    this.preset = PRESETS[quality];
    this.m = makeMaterials();
    const T = assets.textures;
    this.keepTextures(T);

    // ── sky (km): Earth, atmosphere, stars, Sun
    this.earthMat = earthMaterial(T.earthHd ?? T.earthDay ?? null, T.earthDetail ?? null, T.earthNight ?? null, T.earthClouds ?? null, T.earthNightDetail ?? null);
    for (const t of [T.earthHd, T.earthDetail, T.earthNight, T.earthClouds, T.earthNightDetail]) if (t) { t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.needsUpdate = true; }
    if (T.earthClouds) T.earthClouds.wrapS = THREE.RepeatWrapping;
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH, this.preset.seg, this.preset.seg / 2), this.earthMat);
    this.earth.position.set(0, -(R_EARTH + ALT), 0);
    this.sky.add(this.earth);
    this.atmo = atmosphereMaterial();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH + 90, 256, 128), this.atmo);
    shell.position.copy(this.earth.position);
    this.atmo.uniforms.center.value.copy(this.earth.position);
    this.sky.add(shell);
    if (T.stars) this.sky.add(new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 24), new THREE.MeshBasicMaterial({ map: T.stars, side: THREE.BackSide, color: 0x3a3a3a, depthWrite: false })));
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex([[0, 'rgba(255,255,255,1)'], [0.07, 'rgba(255,252,240,1)'], [0.18, 'rgba(255,230,190,0.3)'], [1, 'rgba(255,200,150,0)']]), color: new THREE.Color(30, 28, 25), blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sunSprite.scale.setScalar(2400);
    this.sky.add(this.sunSprite);
    this.orientEarth();

    // ── station lights: Sun (with shadows near the helmet), Earthshine, helmet lamps, airlock
    this.sun = new THREE.DirectionalLight(0xfff4e6, 0);
    this.sun.castShadow = quality !== 'low';
    this.sun.shadow.mapSize.set(this.preset.shadow, this.preset.shadow);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -14; sc.right = sc.top = 14; sc.near = 1; sc.far = 90;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    this.hemi = new THREE.HemisphereLight(0x020306, 0x020306, 1.2);
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.scene.environment = spaceEnvironment(renderer);

    // ── the NASA station
    if (stationGltf) {
      const st = stationGltf.scene;
      st.scale.setScalar(MODEL_SCALE);
      const arm = st.getObjectByName('SSRMS_Base'); // we ride Canadarm2: our rig stands in for its end
      if (arm) arm.visible = false;
      st.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        this.meshes.push(mesh);
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mt of mats as THREE.MeshStandardMaterial[]) if ('envMapIntensity' in mt) mt.envMapIntensity = 1.0;
      });
      st.updateMatrixWorld(true);
      // Quest's own outboard hatch sits exactly where our animated hatch is: cut that disc out of the model
      const air = st.getObjectByName('Airlock');
      if (air && !air.userData.hatchCut) {
        air.userData.hatchCut = true;
        air.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) cutHatch(mesh); });
      }
      for (const mesh of this.meshes) mesh.geometry.computeBoundingSphere();
      this.scene.add(st);
      this.station = st;
    }

    // ── airlock interior + hatch at Quest's outboard end (local +X = outward = world +Z)
    this.buildAirlock();
    this.dock.position.copy(HATCH);
    this.dock.rotation.y = -Math.PI / 2;
    this.scene.add(this.dock);
    this.airlockLight = new THREE.PointLight(0xffe6c0, 0.9, 5, 2);
    this.dock.add(this.airlockLight);
    this.airlockLight.position.set(-2.2, 0.4, 0);

    // ── worksite on the P3 forward face (local +Z = outward = world -X; local +X = world +Z)
    this.site.position.copy(SITE);
    this.site.rotation.y = -Math.PI / 2;
    this.scene.add(this.site);
    this.oldOru = batteryOru(this.m, ['LI-ION BATT ORU', 'P3-3B  S/N 0021', 'FAULT · ISOLATE'], false);
    this.oldOru.group.position.set(0, 0, 0.27);
    this.newOru = batteryOru(this.m, ['LI-ION BATT ORU', 'P3-3B  S/N 0034', 'FLIGHT SPARE'], true);
    this.newOru.group.position.set(-1.25, -0.9, 0.95);
    this.newOru.group.rotation.set(0.15, 0.35, 0);
    this.site.add(this.oldOru.group, this.newOru.group);
    for (const dx of [1.25, -2.5]) {
      const o = batteryOru(this.m, ['LI-ION BATT ORU', dx > 0 ? 'P3-4A' : 'P3-2B', 'NOMINAL'], true);
      o.status.emissiveIntensity = 2.5;
      o.group.position.set(dx, 0, 0.27);
      this.site.add(o.group);
    }
    // handrail line along the face: the climb to the worksite grabs these
    for (let x = 3.2; x >= -0.2; x -= 0.8) {
      const hr = handrail(this.m, 0.5);
      hr.rotation.x = Math.PI / 2;
      hr.position.set(x, -0.72, 0.02);
      this.site.add(hr);
      this.siteRails.push(new THREE.Vector3(x, -0.72, 0.1));
    }
    const apfr = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.2), this.m.aluDark);
    post.position.z = 0.6;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.3), this.m.alu);
    plate.position.set(0, -0.05, 1.2);
    apfr.add(post, plate);
    apfr.position.set(0, -1.55, 0);
    this.site.add(apfr);
    this.site.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    // ── first person: camera on the body; gloves on the camera; the arm-ride rig on the body
    this.scene.add(this.body);
    this.body.add(this.camera);
    const armModel = assets.models.emuArm ?? null;
    const hl = armModel ? emuArmModel(-1, armModel) : emuArm(-1), hr = armModel ? emuArmModel(1, armModel) : emuArm(1);
    this.camera.add(hl.root, hr.root);
    (window as unknown as { orionGrabMisses?: unknown }).orionGrabMisses = HandCtl.misses; // QA hook
    this.L = new HandCtl(hl, this.camera, -1);
    this.R = new HandCtl(hr, this.camera, 1);
    void this.L.rest(0); void this.R.rest(0);
    this.pgt = pistolGripTool();
    this.pgt.group.visible = false;
    hr.root.add(this.pgt.group);
    this.pgt.group.position.set(0, -0.045, -0.08);
    this.buildRig();
    this.body.add(this.rig);
    this.rig.visible = false;
    // third-person astronaut (cutscenes): the Blender EMU suit, posed every frame from the first-person choreography
    const suitGltf = assets.models.emuSuit;
    if (suitGltf) {
      const sm = suitMaterials();
      const suit = cloneSkinned(suitGltf.scene);
      suit.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const name = (mesh.material as THREE.Material).name;
          mesh.material = name === 'visor' ? this.visorMat : sm[name] ?? sm.suit;
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.frustumCulled = false;
        }
        if (/^j[A-Z]/.test(o.name)) { this.suitJ[o.name] = o; this.suitRest.set(o, o.quaternion.clone()); this.suitPrev.set(o, o.quaternion.clone()); }
      });
      suit.visible = false;
      this.scene.add(suit);
      this.suit = suit;
    }
    this.visorMat.roughnessMap = visorScratches();
    this.earthProxy = new THREE.Mesh(new THREE.SphereGeometry(2600, 48, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.32, 0.5, 1.0) }));
    this.sunProxy = new THREE.Mesh(new THREE.SphereGeometry(40, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(40, 36, 30) }));
    for (const o of [this.earthProxy, this.sunProxy]) { o.layers.set(1); this.scene.add(o); }
    this.visorCam.layers.enable(1);
    this.cineLight = new THREE.PointLight(0xdfe8ff, 0, 14, 1.6);
    this.scene.add(this.cineLight);
    for (const sx of [-0.14, 0.14]) {
      const lamp = new THREE.SpotLight(0xe8f0ff, 0, 22, 0.42, 0.7, 2);
      lamp.position.set(sx, 0.16, 0.05);
      lamp.target.position.set(sx * 0.6, -0.2, -5);
      this.camera.add(lamp, lamp.target);
      this.lamps.push(lamp);
    }

    // tether: white braided line from the suit to the anchor, floating in loose arcs
    this.tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 28 }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0xdcd9cf }));
    this.tether.frustumCulled = false;
    this.tether.visible = false;
    this.scene.add(this.tether);

    // debris streaks + impact sparks
    this.streakGeo = new THREE.BufferGeometry();
    this.streakGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(160 * 6), 3));
    const streaks = new THREE.LineSegments(this.streakGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(6, 4.2, 2.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    streaks.frustumCulled = false;
    this.scene.add(streaks);
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(400 * 3), 3));
    const sparks = new THREE.Points(this.sparkGeo, new THREE.PointsMaterial({ color: new THREE.Color(8, 5, 2.5), size: 0.05, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sparks.frustumCulled = false;
    this.scene.add(sparks);

    // sunlit motes drifting around the helmet (they only show when looking toward the Sun)
    this.dust = this.buildDust();
    this.scene.add(this.dust);
    // a sunlit glint that keeps the station visible as a point of light when the camera is kilometres away
    this.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex([[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,250,235,0.85)'], [0.4, 'rgba(255,235,200,0.12)'], [1, 'rgba(255,220,180,0)']]), color: new THREE.Color(4, 3.8, 3.4), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0 }));
    this.glint.position.set(0, -2, 0);
    this.glint.visible = false;
    this.scene.add(this.glint);

    // ── occlusion buffer for sun shafts: bright Sun disc, the station drawn black over it
    this.occRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.occSun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.9)'], [0.6, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']]), depthWrite: false, depthTest: false }));
    this.occScene.add(this.occSun);

    // ── post: sky → station → bloom → shafts/flare → output → visor
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.preset.msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(this.sky, this.skyCam));
    const stationPass = new RenderPass(this.scene, this.camera);
    stationPass.clear = false;
    stationPass.clearDepth = true;
    this.composer.addPass(stationPass);
    if (this.preset.bloom) this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.28, 0.5, 1.2));
    this.raysPass = new ShaderPass(RaysShader);
    this.raysPass.uniforms.tOcc.value = this.occRT.texture;
    this.composer.addPass(this.raysPass);
    this.composer.addPass(new OutputPass());
    this.visor = new ShaderPass(VisorShader);
    this.visor.uniforms.tDirt.value = visorDirt();
    this.composer.addPass(this.visor);

    // start outside, floating just off Quest's closed hatch, looking down at the night side of Earth
    this.body.position.copy(this.air(0.62, 0.05, 0.12));
    this.bodyLook.copy(this.air(8, -3.4, 1.4));
    this.updateSun(0);
  }

  /** Airlock-local → world (local +X points out of the hatch). */
  air(x: number, y: number, z: number) { return this.dock.localToWorld(new THREE.Vector3(x, y, z)); }
  /** Worksite-local → world (local +Z out from the truss face, local +X toward starboard). */
  at(x: number, y: number, z: number) { this.site.updateMatrixWorld(true); return this.site.localToWorld(new THREE.Vector3(x, y, z)); }

  private orientEarth() {
    const P = (lat: number, lon: number) => {
      const phi = ((lon + 180) / 360) * Math.PI * 2, th = ((90 - lat) / 180) * Math.PI;
      return new THREE.Vector3(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
    };
    const u = P(START.lat, START.lon);
    const east = P(START.lat, START.lon + 0.01).sub(u).normalize();
    const north = P(START.lat + 0.01, START.lon).sub(u).normalize();
    const hd = THREE.MathUtils.degToRad(START.heading);
    const fwd = east.multiplyScalar(Math.sin(hd)).addScaledVector(north, Math.cos(hd)).normalize();
    const q1 = new THREE.Quaternion().setFromUnitVectors(u, new THREE.Vector3(0, 1, 0));
    const f1 = fwd.applyQuaternion(q1).setY(0).normalize();
    const q2 = new THREE.Quaternion().setFromUnitVectors(f1, new THREE.Vector3(-1, 0, 0)); // flight direction = ram = -X
    this.earthQ0.copy(q2.multiply(q1));
  }

  private buildAirlock() {
    const m = this.m, air = this.dock;
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 0.98, 3.4, 40, 1, true), m.interior.clone());
    (inner.material as THREE.MeshStandardMaterial).side = THREE.BackSide;
    inner.rotation.z = Math.PI / 2;
    inner.position.x = -1.75;
    const back = new THREE.Mesh(new THREE.CircleGeometry(0.98, 32), m.interior);
    back.position.x = -3.45; back.rotation.y = Math.PI / 2;
    air.add(inner, back);
    for (const x of [-2.9, -2.1, -1.3, -0.5]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.96, 0.025, 8, 40), m.aluDark);
      rib.rotation.y = Math.PI / 2; rib.position.x = x;
      air.add(rib);
    }
    for (const a of [0.8, Math.PI - 0.8]) {
      const hr = handrail(m, 1.6);
      hr.rotation.x = Math.PI / 2 + a;
      hr.position.set(-1.7, -Math.cos(a) * 0.95, Math.sin(a) * 0.95);
      air.add(hr);
    }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d8, emissiveIntensity: 2.5 }));
    lamp.position.set(-2.1, 0.95, 0);
    air.add(lamp);
    // hatch frame + door hinged at the top (opens outward)
    const frame = new THREE.Mesh(new THREE.RingGeometry(0.52, 1.02, 48), m.alu);
    frame.rotation.y = Math.PI / 2;
    const seal = new THREE.Mesh(new THREE.TorusGeometry(0.53, 0.035, 10, 48), m.aluDark);
    seal.rotation.y = Math.PI / 2; seal.position.x = 0.01;
    air.add(frame, seal);
    const hatch = new THREE.Group();
    hatch.position.set(0.05, 0.53, 0);
    const door = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.07, 40), m.alu);
    door.rotation.z = Math.PI / 2; door.position.y = -0.53;
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 8, 24), m.aluDark);
    wheel.rotation.y = Math.PI / 2; wheel.position.set(-0.06, -0.53, 0);
    hatch.add(door, wheel);
    air.add(hatch);
    // tether ring on the outside of the hatch frame
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 8, 16), m.handrail);
    ring.position.set(0.08, 0.75, 0.55);
    air.add(ring);
    air.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.hatch = hatch;
  }

  /** Canadarm2 ride rig in body space: latching end effector + foot restraint under the boots, a handhold, and the boom. */
  private buildRig() {
    const m = this.m, g = this.rig;
    const white = new THREE.MeshStandardMaterial({ color: 0xeceae4, roughness: 0.6 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.36), m.alu);
    plate.position.set(0, -1.6, 0.05);
    const lee = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 24), white);
    lee.position.set(0, -2.0, 0.05);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 7, 20), white);
    boom.position.set(0.9, -4.6, 1.6);
    boom.rotation.set(0.5, 0, -0.35);
    const stanchion = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 10), m.handrail);
    stanchion.position.set(-0.34, -1.05, -0.5);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 10), m.handrail);
    bar.rotation.z = Math.PI / 2; bar.position.set(-0.34, -0.5, -0.5);
    const boots = new THREE.Group();
    for (const x of [-0.12, 0.12]) {
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.3), white);
      boot.position.set(x, -1.52, -0.02);
      boots.add(boot);
    }
    g.add(plate, lee, boom, stanchion, bar, boots);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  private buildDust() {
    const N = 420, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 12; pos[i * 3 + 1] = (Math.random() - 0.5) * 8; pos[i * 3 + 2] = (Math.random() - 0.5) * 12; seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { origin: { value: new THREE.Vector3() }, sun: { value: new THREE.Vector3() }, vis: { value: 0 }, time: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float seed; uniform vec3 origin, sun; uniform float vis, time; varying float vA;
        void main(){
          vec3 p = position + vec3(sin(time * 0.05 + seed * 40.0), cos(time * 0.04 + seed * 23.0), sin(time * 0.03 + seed * 11.0)) * 0.6;
          p = origin + mod(p - origin + 6.0, 12.0) - 6.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vec3 v = normalize(p - cameraPosition);
          float fwd = pow(max(dot(v, sun), 0.0), 7.0);
          vA = vis * (0.015 + fwd * 0.6) * (0.4 + seed * 0.6) * smoothstep(0.6, 2.0, -mv.z);
          gl_PointSize = clamp((1.0 + seed * 1.5) * 14.0 / -mv.z, 1.0, 4.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; gl_FragColor = vec4(vec3(1.0, 0.92, 0.8) * 3.0, vA * smoothstep(0.5, 0.0, length(d))); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    return pts;
  }

  // ───────────────────────────────────────────── API for the mission
  /** Glide the body along a path. */
  move(pts: Vec[], look: Vec[], dur: number, ease: 'inout' | 'linear' | 'out' = 'inout'): Promise<void> {
    const E = { inout: (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2), linear: (k: number) => k, out: (k: number) => 1 - Math.pow(1 - k, 3) }[ease];
    return new Promise((resolve) => {
      this.travel = { pts: new THREE.CatmullRomCurve3([this.body.position.clone(), ...pts], false, 'centripetal'), look: new THREE.CatmullRomCurve3([this.bodyLook.clone(), ...look], false, 'centripetal'), t: 0, dur, ease: E, resolve };
    });
  }
  /** Ease the Sun's elevation (deg) over `dur` seconds. */
  sunTo(elev: number, dur: number) { this.sunTween = { from: this.sunElev, to: elev, t: 0, dur }; }
  showRig(on: boolean) { this.rig.visible = on; }
  rigHandhold(): Vec { return this.rig.localToWorld(this.rigRail.clone()); }
  showTool(on: boolean) { this.pgt.group.visible = on; }
  setOruStatus(o: Oru, ok: boolean) { o.status.emissive.set(ok ? 0x00ff66 : 0xff2200); o.status.emissiveIntensity = ok ? 4 : 5; }
  hatchHandle(): Vec { return this.hatch.localToWorld(new THREE.Vector3(-0.08, -0.53 + 0.15, 0)); }
  worldOf(o: THREE.Object3D, local = new THREE.Vector3()) { o.updateMatrixWorld(true); return o.localToWorld(local.clone()); }
  kick(a = 1, flash = 0) { this.kickAmp = Math.max(this.kickAmp * Math.exp(-this.kickT * 4), a); this.kickT = 0; this.flashT = Math.max(this.flashT, flash); }
  burst(at: Vec, n = 40, speed = 3) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      if (this.sparks.length < 400) this.sparks.push({ p: at.clone(), v, life: 0.6 + Math.random() * 0.8 });
    }
  }
  tweenObject(o: THREE.Object3D, pos: Vec | null, rot: THREE.Euler | null, dur: number): Promise<void> {
    const p0 = o.position.clone(), q0 = o.quaternion.clone();
    const q1 = rot ? new THREE.Quaternion().setFromEuler(rot) : q0.clone();
    return new Promise((resolve) => {
      let t = 0;
      const step = (dt: number) => {
        t = Math.min(1, t + dt / dur);
        const e = t * t * (3 - 2 * t);
        if (pos) o.position.lerpVectors(p0, pos, e);
        o.quaternion.slerpQuaternions(q0, q1, e);
        if (t >= 1) { this.tickers.delete(step); resolve(); }
      };
      this.tickers.add(step);
    });
  }
  /** Run a per-frame function for `dur` seconds (pause-aware: driven by update). */
  animate(dur: number, f: (k: number) => void): Promise<void> {
    return new Promise((resolve) => {
      let t = 0;
      const step = (dt: number) => {
        t = Math.min(1, t + dt / dur);
        f(t);
        if (t >= 1) { this.tickers.delete(step); resolve(); }
      };
      this.tickers.add(step);
    });
  }
  /**
   * Cutscene: leave the helmet, show the astronaut and play camera shots. Each shot gives camera position and look
   * target as functions of eased progress k (so shots can track the moving astronaut). The first-person choreography
   * keeps running underneath, and the suit mirrors it (body pose, hands on whatever the gloves hold).
   * Resolves when the shots end or the player skips; the helmet view comes back.
   */
  async cine(shots: { dur: number; cam: (k: number) => Vec; look: (k: number) => Vec; fov?: number; slow?: number; at?: () => void; live?: boolean }[], o: { hold?: number; beforeExit?: () => Promise<void> } = {}) {
    if (!this.suit) return;
    const state = (this.cineState = { skip: false });
    this.L.h.root.visible = this.R.h.root.visible = false;
    this.visor.enabled = false;
    this.dust.visible = false;
    this.scene.attach(this.camera);
    this.suit.visible = true;
    this.ext = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    for (const sh of shots) {
      if (state.skip) break;
      this.camera.fov = sh.fov ?? 50;
      this.camera.near = 0.02;
      this.camera.updateProjectionMatrix();
      this.timeScale = sh.slow ?? 1;
      sh.at?.();
      this.visorLive = !!sh.live;
      if (sh === shots[0] && o.hold) { this.ext!.pos.copy(sh.cam(0)); this.ext!.look.copy(sh.look(0)); await this.animate(o.hold, () => {}); }
      await this.animate(sh.dur * (sh.slow ?? 1), (k) => {
        if (state.skip) return;
        const e = k * k * (3 - 2 * k);
        this.ext!.pos.copy(sh.cam(e));
        this.ext!.look.copy(sh.look(e));
      });
    }
    this.timeScale = 1;
    this.visorLive = false;
    if (o.beforeExit) await o.beforeExit();
    this.ext = null;
    this.cineState = null;
    this.suit.visible = false;
    this.cineLight.intensity = 0;
    this.body.add(this.camera);
    this.camera.fov = 72; this.camera.near = 0.03;
    this.camera.updateProjectionMatrix();
    this.L.h.root.visible = this.R.h.root.visible = true;
    this.visor.enabled = true;
    this.dust.visible = true;
  }
  skipCine() { if (this.cineState) this.cineState.skip = true; }

  /**
   * First-person idles: when both hands are free and settled, every 6-14 s one natural gesture plays: turning a glove
   * to check the palm, reading the cuff checklist, flexing the fingers, adjusting the opposite wrist ring.
   * Any scripted grab or pose cancels it on the spot.
   */
  private updateIdle(dt: number) {
    const L = this.L, R = this.R;
    const free = L.mode === 'pose' && R.mode === 'pose' && !this.ext && !this.cineState;
    if (!free) { this.idleT = Math.max(this.idleT, 4); return; }
    if (L.idling || R.idling) return;
    if (!L.settled || !R.settled) return;
    this.idleT -= dt;
    if (this.idleT > 0) return;
    this.idleT = 6 + Math.random() * 8;
    const pick = Math.floor(Math.random() * 4);
    const back = (h: HandCtl, delay: number) => setTimeout(() => { if (h.idling) { h.idling = false; void h.rest(0.9); } }, delay);
    if (pick === 0) {          // check the right palm: raise it, turn it toward the visor, look it over
      void R.pose([0.1, -0.17, -0.55], [-1.25, 0.25, 2.6], 0.15, 0.9, true).then(() => { if (R.idling) void R.pose([0.08, -0.16, -0.54], [-1.35, 0.1, 2.9], 0.35, 1.1, true); });
      back(R, 3200);
    } else if (pick === 1) {   // read the cuff checklist on the left forearm
      void L.pose([-0.12, -0.21, -0.46], [0.85, -0.55, -0.4], 0.35, 1.0, true);
      back(L, 3400);
    } else if (pick === 2) {   // flex the fingers (pressurised gloves fight you)
      void R.pose([0.19, -0.27, -0.46], [0.2, 0.15, 0.3], 0.95, 0.6, true).then(() => { if (R.idling) void R.pose([0.2, -0.28, -0.47], [0.25, 0.2, 0.32], 0.1, 0.7, true); });
      void L.pose([-0.2, -0.27, -0.46], [0.25, -0.18, -0.3], 0.9, 0.7, true).then(() => { if (L.idling) void L.pose([-0.21, -0.28, -0.47], [0.25, -0.2, -0.32], 0.15, 0.8, true); });
      back(R, 2200); back(L, 2400);
    } else {                   // adjust the left wrist ring with the right glove
      void L.pose([-0.06, -0.24, -0.45], [0.5, -0.4, -0.6], 0.3, 0.9, true);
      void R.pose([0.03, -0.21, -0.44], [0.4, 0.9, 0.9], 0.8, 1.0, true);
      back(L, 2900); back(R, 2700);
    }
  }
  /** Helmet (eye) position and the astronaut's facing, for framing shots. */
  get head() { return this.body.position.clone(); }
  get facing() { return new THREE.Vector3(0, 0, -1).applyQuaternion(this.body.quaternion); }
  get sideways() { return new THREE.Vector3(1, 0, 0).applyQuaternion(this.body.quaternion); }

  /** Place and pose the suit from the body + the gloves' targets. */
  private poseSuit() {
    const suit = this.suit!;
    // the body quaternion carries the head pitch; keep the suit upright-ish (half the pitch) so it reads as a person
    const q = this.body.quaternion.clone();
    const tt = this.elapsed;
    // weightless drift: a slow sway and roll around the helmet
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(tt * 0.31) * 0.035, Math.sin(tt * 0.23) * 0.03, Math.sin(tt * 0.27) * 0.04)));
    suit.quaternion.copy(q);
    suit.position.copy(this.body.position).sub(new THREE.Vector3(0, 1.66, -0.03).applyQuaternion(q));
    for (const [j, r] of this.suitRest) j.quaternion.copy(r);
    suit.updateMatrixWorld(true);
    const J = this.suitJ;
    const aim = (joint: THREE.Object3D | undefined, target: Vec) => {
      if (!joint) return;
      const p = joint.getWorldPosition(new THREE.Vector3());
      const inv = joint.getWorldQuaternion(new THREE.Quaternion()).invert();
      const dir = target.clone().sub(p).applyQuaternion(inv).normalize();
      joint.quaternion.multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      joint.updateMatrixWorld(true);
    };
    const t = this.elapsed;
    for (const [hand, nm] of [[this.L, 'L'], [this.R, 'R']] as const) {
      const tgt = hand.target();
      if (tgt) {
        aim(J['jShoulder' + nm], tgt);
        J['jElbow' + nm]?.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.25));
      } else {
        // relaxed float: arms a little forward and out, slow drift
        const s = nm === 'L' ? -1 : 1;
        // relaxed neutral-buoyancy posture: arms float forward and out, elbows soft, a slow asymmetric drift
        const sh = J['jShoulder' + nm], el = J['jElbow' + nm];
        if (sh) aim(sh, sh.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.35 * s, -0.75, -0.45 + Math.sin(t * 0.5 + s) * 0.08).applyQuaternion(q)));
        el?.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55 + Math.sin(t * 0.6 + s * 2) * 0.08, 0, 0)));
      }
    }
    // legs: a relaxed weightless bend (knees forward), tighter crouch under alert
    // legs: the weightless "neutral body posture" (hips and knees softly flexed), tighter under alert
    const crouch = this.alert ? 0.8 : 0.35;
    for (const [nm, s] of [['L', -1], ['R', 1]] as const) {
      const hip = J['jHip' + nm], knee = J['jKnee' + nm];
      if (hip) aim(hip, hip.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.08 * s, -1, -0.55 * crouch + Math.sin(t * 0.4 + s) * 0.05).applyQuaternion(q)));
      if (knee) aim(knee, knee.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.02 * s, -1, 0.5 * crouch).applyQuaternion(q)));
    }
    // breathing: the chest rises a touch
    J['jTorso']?.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(t * 1.6) * 0.012, 0, 0)));
    // follow-through: every joint eases toward its new pose (no snapping), heavier for the legs
    const k = 1 - Math.exp(-this.suitDt * 7);
    for (const [j, prev] of this.suitPrev) {
      const kk = /Hip|Knee/.test(j.name) ? k * 0.6 : k;
      prev.slerp(j.quaternion, kk);
      j.quaternion.copy(prev);
    }
    // a key light near the camera so night shots still read (the helmet lamps light the work, not the suit)
    this.cineLight.position.copy(this.camera.position).add(new THREE.Vector3(0, 0.6, 0));
    this.cineLight.intensity = 2.5 * (1 - this.sunUp * 0.7);
  }

  /** Screen position (0..1, y down) of a world point. */
  toScreen(p: Vec) {
    const v = p.clone().project(this.camera);
    return { x: v.x * 0.5 + 0.5, y: -v.y * 0.5 + 0.5, behind: v.z > 1 };
  }
  /** Where the label tracks: the worksite while close, the station itself once far away. */
  get stationCentre() { return new THREE.Vector3(0, -2, 0); }
  get worksite() { return SITE.clone().add(new THREE.Vector3(-1.7, 0, 0)); }

  /**
   * Mission-exit pull-out (like a character switch): the helmet view cuts to a camera outside the station,
   * then jumps back in stepped cuts until the ISS is a point of light above the curve of the Earth.
   * The astronaut is never shown: the first cut is already far enough that a person would be a speck.
   */
  async orbitExit(onStep?: (level: number, distance: number) => void) {
    const dir = new THREE.Vector3(-0.25, 0.3, 0.92).normalize(); // starboard, a little sunward: the station side-lit over the day-side limb
    const side = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    // [distance (m), target blend worksite → station centre, sideways framing offset (fraction of distance)]
    const levels: [number, number, number][] = [[42, 0, 0.1], [230, 0.7, 0.14], [1500, 1, 0.12], [26000, 1, 0.1]];
    const target = (b: number) => this.worksite.lerp(this.stationCentre, b);
    const place = (d: number, b: number, s: number) => {
      const t = target(b);
      return { pos: t.clone().addScaledVector(dir, d).addScaledVector(side, -s * d * 0.3), look: t.clone().addScaledVector(side, s * d * 0.25) };
    };
    // leave the helmet: hands, rig, tether, visor and lamps go; the camera now lives in world space
    this.travel = null;
    this.L.h.root.visible = this.R.h.root.visible = false;
    this.rig.visible = false;
    this.tetherAnchor = null;
    this.dust.visible = false;
    this.visor.enabled = false;
    this.scene.attach(this.camera);
    this.debris = 0;
    this.shake = 0;
    let prev = levels[0][0] * 0.55;
    for (let i = 0; i < levels.length; i++) {
      const [d, b, s] = levels[i];
      onStep?.(i, d);
      this.camera.near = Math.max(0.05, d * 0.004);
      this.camera.far = d * 2.2 + 900;
      this.camera.updateProjectionMatrix();
      this.glint.visible = d > 900;
      const from = prev + (d - prev) * 0.8; // jump-cut most of the way, then settle
      const p0 = place(from, b, s);
      this.ext = { pos: p0.pos.clone(), look: p0.look.clone() };
      const p1 = place(d, b, s);
      await this.animate(0.75, (k) => {
        const e = 1 - Math.pow(1 - k, 3);
        this.ext!.pos.lerpVectors(p0.pos, p1.pos, e);
        this.ext!.look.lerpVectors(p0.look, p1.look, e);
      });
      await this.animate(i === levels.length - 1 ? 1.0 : i === 0 ? 1.6 : 0.6, (k) => {
        const p = place(d * (1 + 0.012 * k), b, s);
        this.ext!.pos.copy(p.pos);
        this.ext!.look.copy(p.look);
      });
      prev = d * 1.012;
    }
    // slow drift while the closing lines play
    const [d, b, s] = levels[levels.length - 1];
    void this.animate(600, (k) => {
      const p = place(d * 1.012 * (1 + 0.6 * k), b, s);
      this.ext!.pos.copy(p.pos);
      this.ext!.look.copy(p.look);
    });
  }

  get earthSpeedKmh() { return ORBIT_RATE * (R_EARTH + ALT) * 3600; }
  groundPoint() {
    const p = new THREE.Vector3(0, 1, 0).applyQuaternion(this.earth.quaternion.clone().invert());
    const lat = THREE.MathUtils.radToDeg(Math.asin(p.y));
    const lon = THREE.MathUtils.radToDeg(Math.atan2(p.z, -p.x)) - 180;
    return { lat, lon: ((lon + 540) % 360) - 180 };
  }
  /** 0 before sunrise … 1 in full daylight. */
  get dayFactor() { return THREE.MathUtils.smoothstep(this.sunElev, -21, 6); }
  get sunUp() { return THREE.MathUtils.smoothstep(this.sunElev, -20.7, -19.0); }

  // ───────────────────────────────────────────── per frame
  update(dt: number) {
    if (this.paused) return;
    dt *= this.timeScale;
    this.elapsed += dt;
    for (const f of [...this.tickers]) f(dt);
    if (this.sunTween) {
      const s = this.sunTween;
      s.t = Math.min(1, s.t + dt / s.dur);
      const e = s.t * s.t * (3 - 2 * s.t);
      this.sunElev = THREE.MathUtils.lerp(s.from, s.to, e);
      if (s.t >= 1) this.sunTween = null;
    }
    this.orbitAngle += ORBIT_RATE * dt;
    this.earth.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -this.orbitAngle).multiply(this.earthQ0);
    this.updateSun(dt);

    if (this.travel) {
      const tr = this.travel;
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      const e = tr.ease(tr.t);
      this.body.position.copy(tr.pts.getPoint(e));
      this.bodyLook.copy(tr.look.getPoint(e));
      if (tr.t >= 1) { this.travel = null; tr.resolve(); }
    }
    this.updateCamera(dt);
    this.L.update(dt);
    this.R.update(dt);
    this.suitDt = dt;
    if (this.suit?.visible) this.poseSuit();
    this.updateIdle(dt);
    this.updateTether();
    this.updateDebris(dt);
    this.updateShadowCasters(dt);

    this.sun.target.position.copy(this.body.position);
    this.sun.position.copy(this.body.position).addScaledVector(this.sunDir, 45);
    this.skyCam.quaternion.copy(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    this.skyCam.position.copy(this.camera.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.001);
    this.earthMat.uniforms.camPos.value.copy(this.skyCam.position);
    this.atmo.uniforms.camPos.value.copy(this.skyCam.position);

    // effects driven by where the Sun sits on screen
    const sp = this.camera.position.clone();
    this.camera.getWorldPosition(sp);
    const sunScreen = sp.addScaledVector(this.sunDir, 1000).project(this.camera);
    const onScreen = sunScreen.z < 1 ? 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(sunScreen.x), Math.abs(sunScreen.y)), 0.9, 1.5) : 0;
    const sunUv = new THREE.Vector2(sunScreen.x * 0.5 + 0.5, sunScreen.y * 0.5 + 0.5);
    const shafts = this.sunUp * onScreen;
    this.raysOn = this.preset.rays && shafts > 0.01;
    const ru = this.raysPass.uniforms;
    ru.sun.value.copy(sunUv);
    const fresh = 1 - THREE.MathUtils.smoothstep(this.sunElev, -16, 4); // low Sun: longest, richest shafts
    ru.rays.value = this.raysOn ? shafts * (0.85 + 0.45 * fresh) : 0;
    ru.flare.value = this.raysOn ? shafts : 0;
    (ru.tint.value as THREE.Color).copy(this.sunColor());
    const dm = this.dust.material as THREE.ShaderMaterial;
    dm.uniforms.origin.value.copy(this.body.position);
    dm.uniforms.sun.value.copy(this.sunDir);
    dm.uniforms.vis.value = this.sunUp;
    dm.uniforms.time.value = this.elapsed;

    // auto-exposure: open up at night (helmet lamps), stop down when the Sun is in frame
    const want = THREE.MathUtils.lerp(1.2, 0.86, this.dayFactor) - 0.28 * shafts;
    this.exposure += (want - this.exposure) * Math.min(1, dt * 1.2);

    this.flashT = Math.max(0, this.flashT - dt * 2.2);
    const u = this.visor.uniforms;
    u.time.value = this.elapsed;
    u.fog.value = this.fog * (0.55 + 0.45 * Math.max(0, Math.sin(this.elapsed * (Math.PI * 2) / 4.2)));
    u.alert.value += (this.alert - u.alert.value) * Math.min(1, dt * 3);
    u.flash.value = this.flashT * this.flashT * 0.7;
    u.dark.value = this.dark;
    u.sun.value.copy(sunUv);
    u.sunGlare.value = shafts;
  }

  private sunColor() {
    const k = THREE.MathUtils.smoothstep(this.sunElev, -19.5, -8);
    return new THREE.Color(1.0, 0.48, 0.2).lerp(new THREE.Color(1.0, 0.96, 0.9), k);
  }

  private updateSun(_dt: number) {
    const e = THREE.MathUtils.degToRad(this.sunElev);
    this.sunDir.set(-Math.cos(e), Math.sin(e), 0.16).normalize();
    this.earthMat.uniforms.sunDir.value.copy(this.sunDir);
    this.earthMat.uniforms.sunLocal.value.copy(this.sunDir).applyQuaternion(this.earth.quaternion.clone().invert());
    this.atmo.uniforms.sunDir.value.copy(this.sunDir);
    this.sunSprite.position.copy(this.sunDir).multiplyScalar(20000);
    const col = this.sunColor();
    (this.sunSprite.material as THREE.SpriteMaterial).color.setRGB(30 * col.r, 28 * col.g, 25 * col.b);
    this.earthMat.uniforms.sunColor.value.copy(col);
    // refraction through the limb squashes the rising Sun into a wide, deep-orange ellipse
    const limb = 1 - THREE.MathUtils.smoothstep(this.sunElev, -20.4, -16.5);
    this.sunSprite.scale.set(2400 * (1 + 0.55 * limb), 2400 * (1 - 0.35 * limb), 1);
    const up = this.sunUp, day = this.dayFactor;
    this.sun.intensity = 3.0 * up;
    this.sun.color.copy(col);
    // Earthshine: black beneath us at night, ocean-blue once the ground below is lit
    this.hemi.groundColor.setRGB(0.012 + 0.21 * day, 0.016 + 0.35 * day, 0.03 + 0.58 * day);
    this.hemi.color.setRGB(0.012, 0.014, 0.022);
    this.scene.environmentIntensity = 0.12 + 0.88 * day;
    for (const l of this.lamps) l.intensity = this.ext ? 0 : 4.5 * (1 - up);
    this.airlockLight.intensity = 0; // hatch is shut behind us: no interior light spill
  }

  private updateCamera(dt: number) {
    if (this.ext) {
      const cam = this.camera;
      cam.position.copy(this.ext.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.ext.look);
      cam.updateMatrixWorld(true);
      // glint: grows with distance so it stays a few pixels wide, fades in as the station shrinks to a point
      const d = cam.position.distanceTo(this.glint.position);
      this.glint.scale.setScalar(d * 0.016);
      (this.glint.material as THREE.SpriteMaterial).opacity = THREE.MathUtils.smoothstep(d, 900, 9000) * (0.4 + 0.6 * this.sunUp);
      return;
    }
    const b = this.body, t = this.elapsed;
    b.lookAt(this.bodyLook);
    b.rotateY(Math.PI); // Object3D.lookAt points +Z at the target; the camera looks down -Z
    const cam = this.camera;
    cam.position.set(Math.sin(t * 0.37) * 0.01, Math.sin(t * 1.5) * 0.005 + Math.sin(t * 0.23) * 0.008, 0);
    cam.rotation.set(0, 0, 0);
    cam.rotateY(this.lookYaw);
    cam.rotateX(this.lookPitch);
    cam.rotateZ(Math.sin(t * 0.21) * 0.01);
    this.kickT += dt;
    const k = this.kickAmp * Math.exp(-this.kickT * 4);
    const a = this.shake * 0.004 + k * 0.035;
    if (a > 1e-5) {
      cam.rotateX((Math.sin(t * 31) * 0.6 + Math.sin(t * 17.3) * 0.4) * a);
      cam.rotateY((Math.sin(t * 27.1 + 1) * 0.6 + Math.sin(t * 13.7) * 0.4) * a);
      cam.rotateZ(Math.sin(t * 9.3) * a * 0.5);
    }
    b.updateMatrixWorld(true);
  }

  /** Only station parts near the helmet cast shadows (re-evaluated twice a second). */
  private updateShadowCasters(dt: number) {
    this.shadowTick -= dt;
    if (this.shadowTick > 0 || !this.sun.castShadow) return;
    this.shadowTick = 0.5;
    const c = this.body.position, s = new THREE.Sphere();
    for (const mesh of this.meshes) {
      if (!mesh.geometry.boundingSphere) continue;
      s.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
      mesh.castShadow = s.center.distanceTo(c) - s.radius < 16;
    }
  }

  private updateTether() {
    if (!this.tetherAnchor) { this.tether.visible = false; return; }
    this.tether.visible = true;
    const hip = this.body.localToWorld(new THREE.Vector3(-0.15, -0.8, 0.05));
    const a = this.tetherAnchor;
    const pos = this.tether.geometry.attributes.position as THREE.BufferAttribute;
    const n = pos.count, d = hip.distanceTo(a);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const p = hip.clone().lerp(a, k);
      const sag = Math.sin(k * Math.PI) * Math.min(1.4, d * 0.1);
      p.x += Math.sin(k * 5 + this.elapsed * 0.6) * sag * 0.25;
      p.y += Math.sin(k * Math.PI) * sag * 0.4 - sag * 0.2;
      p.z += Math.cos(k * 4 + this.elapsed * 0.5) * sag * 0.25;
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
  }

  private updateDebris(dt: number) {
    if (this.debris > 0) {
      const want = Math.floor(this.debris * 2.2 * dt * 60);
      const fwd = this.debrisFrom;
      for (let i = 0; i < want && this.streaks.length < 160; i++) {
        const off = new THREE.Vector3(0, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 90);
        if (Math.abs(off.y) < 5) off.y += Math.sign(off.y || 1) * 5; // nothing comes straight through the truss
        const p = this.body.position.clone().addScaledVector(fwd, 80 + Math.random() * 80).add(off);
        const v = fwd.clone().negate().add(new THREE.Vector3(0, (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.5)).normalize().multiplyScalar(140 + Math.random() * 160);
        this.streaks.push({ p, v, len: 3 + Math.random() * 8, life: 2 });
      }
    }
    const arr = this.streakGeo.attributes.position as THREE.BufferAttribute;
    let j = 0;
    this.streaks = this.streaks.filter((s) => (s.life -= dt) > 0);
    for (const s of this.streaks) {
      s.p.addScaledVector(s.v, dt);
      const tail = s.p.clone().addScaledVector(s.v.clone().normalize(), -s.len);
      arr.setXYZ(j++, s.p.x, s.p.y, s.p.z);
      arr.setXYZ(j++, tail.x, tail.y, tail.z);
    }
    arr.needsUpdate = true;
    this.streakGeo.setDrawRange(0, j);
    const sp = this.sparkGeo.attributes.position as THREE.BufferAttribute;
    this.sparks = this.sparks.filter((s) => (s.life -= dt) > 0);
    this.sparks.forEach((s, i) => { s.p.addScaledVector(s.v, dt); sp.setXYZ(i, s.p.x, s.p.y, s.p.z); });
    sp.needsUpdate = true;
    this.sparkGeo.setDrawRange(0, this.sparks.length);
  }

  render(renderer: THREE.WebGLRenderer) {
    if (this.visorLive && this.suit?.visible && (this.visorTick++ & 1) === 0) {
      // real reflections: station, debris streaks, sparks, the Sun and Earth around the helmet
      const head = this.body.position;
      this.visorCam.position.copy(head);
      this.earthProxy.position.copy(head).add(new THREE.Vector3(0, -3000, 0));
      this.sunProxy.position.copy(head).addScaledVector(this.sunDir, 900);
      this.suit.visible = false;
      this.visorCam.update(renderer, this.scene);
      this.suit.visible = true;
      if (this.visorMat.envMap !== this.visorRT.texture) { this.visorMat.envMap = this.visorRT.texture; this.visorMat.needsUpdate = true; }
    } else if (!this.visorLive && this.visorMat.envMap === this.visorRT.texture) {
      this.visorMat.envMap = null;
      this.visorMat.needsUpdate = true;
    }
    if (this.raysOn) {
      // occlusion buffer: the Sun disc, with everything in the station scene drawn black in front of it
      const cam = this.camera;
      const cw = cam.getWorldPosition(new THREE.Vector3());
      this.occSun.position.copy(cw).addScaledVector(this.sunDir, 1500);
      this.occSun.scale.setScalar(150);
      this.occSun.material.opacity = this.sunUp;
      const prevTarget = renderer.getRenderTarget();
      const prevClear = renderer.getClearColor(new THREE.Color());
      const prevAlpha = renderer.getClearAlpha();
      renderer.setRenderTarget(this.occRT);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(this.occScene, cam);
      renderer.clearDepth();
      const gv = this.glint.visible;
      this.glint.visible = false;
      this.scene.overrideMaterial = this.black;
      const env = this.scene.environment;
      this.scene.environment = null;
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(this.scene, cam);
      renderer.autoClear = auto;
      this.scene.overrideMaterial = null;
      this.scene.environment = env;
      this.glint.visible = gv;
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(prevClear, prevAlpha);
    }
    const prev = renderer.toneMappingExposure;
    renderer.toneMappingExposure = this.exposure;
    this.composer.render();
    renderer.toneMappingExposure = prev;
  }

  resize(w: number, h: number) {
    this.camera.aspect = this.skyCam.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.skyCam.updateProjectionMatrix();
    const pr = this.composer.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.occRT.setSize(Math.max(1, Math.floor((w * pr) / this.preset.occDiv)), Math.max(1, Math.floor((h * pr) / this.preset.occDiv)));
    this.visor.uniforms.res.value.set(w, h);
    this.raysPass.uniforms.aspect.value = w / h;
  }

  dispose() {
    this.composer.dispose();
    this.occRT.dispose();
    const keep = new Set(Object.values(this.sharedTextures));
    for (const s of [this.sky, this.occScene]) s.traverse((o) => disposeObj(o, keep));
    // procedural pieces only: the NASA station model is cached by Assets and reused next time
    for (const g of [this.dock, this.site, this.rig, this.body]) g.traverse((o) => disposeObj(o, keep));
    if (this.station) this.scene.remove(this.station);
  }
  private sharedTextures: Record<string, THREE.Texture> = {};
  keepTextures(t: Record<string, THREE.Texture | null | undefined>) { for (const [k, v] of Object.entries(t)) if (v) this.sharedTextures[k] = v; }
}

/** Remove triangles of the model's hatch: centroid within 0.62 m of the hatch axis and past z = 7.25 m. */
function cutHatch(mesh: THREE.Mesh) {
  const g = mesh.geometry, pos = g.attributes.position as THREE.BufferAttribute, idx = g.index;
  if (!idx) return;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const keep: number[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i)).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, idx.getX(i + 1)).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, idx.getX(i + 2)).applyMatrix4(mesh.matrixWorld);
    const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;
    if (Math.hypot(cx - HATCH.x, cy - HATCH.y) < 0.62 && cz > 7.25) continue;
    keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  }
  if (keep.length !== idx.count) g.setIndex(keep);
}

function disposeObj(o: THREE.Object3D, keep: Set<THREE.Texture>) {
  const m = o as THREE.Mesh;
  m.geometry?.dispose();
  const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
  for (const mt of mats) {
    for (const v of Object.values(mt)) if (v instanceof THREE.Texture && !keep.has(v)) v.dispose();
    mt.dispose();
  }
}

/** Reflection environment: black sky, ocean-blue Earth below, bright Sun ahead. */
function spaceEnvironment(renderer: THREE.WebGLRenderer) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0);
  const earth = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.3, 0.58) }));
  earth.position.set(0, -13, 0);
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(25, 24, 22) }));
  sun.position.set(-18, 4, 3);
  s.add(earth, sun);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  return env;
}
