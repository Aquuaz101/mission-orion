import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { Stage } from '../../core/Engine';
import type { Assets } from '../../core/Assets';
import type { Quality } from '../../app/App';
import { makeMaterials, truss, module, solarWing, radiator, handrail, batteryOru, glove, setGrip, pistolGripTool, rng, type Mats, type Oru, type Hand } from './parts';

/** Real numbers (NASA): mean Earth radius 6371 km, ISS altitude ≈ 420 km, orbital period ≈ 92 min. */
const R_EARTH = 6371;
const ALT = 420;
const ORBIT_RATE = (Math.PI * 2) / (92.7 * 60); // rad/s → ground speed ≈ 7.66 km/s
/** High-resolution NASA Blue Marble patch (Caribbean): lon -90..-62, lat 14..34. */
const DETAIL = { lon0: -90, lon1: -62, lat1: 14, lat0: 34 };
/** Start the pass west of the Bahamas, heading east-north-east like an ascending ISS pass. */
const START = { lat: 23.2, lon: -86.5, heading: 62 };
export const SUN_DIR = new THREE.Vector3(0.62, 0.52, 0.58).normalize();

// ───────────────────────────────────────────── shaders
const earthMaterial = (day: THREE.Texture | null, detail: THREE.Texture | null, night: THREE.Texture | null, cloudTex: THREE.Texture | null) =>
  new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: day }, detailMap: { value: detail }, nightMap: { value: night }, cloudMap: { value: cloudTex },
      bounds: { value: new THREE.Vector4(DETAIL.lon0, DETAIL.lon1, DETAIL.lat1, DETAIL.lat0) },
      sunDir: { value: SUN_DIR.clone() }, sunLocal: { value: SUN_DIR.clone() }, camPos: { value: new THREE.Vector3() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vL;
      void main(){ vUv = uv; vL = normalize(position); vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D dayMap, detailMap, nightMap, cloudMap; uniform vec4 bounds; uniform vec3 sunDir, sunLocal, camPos;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vL;
      vec2 uvOf(vec3 n){ float phi = atan(n.z, -n.x); if (phi < 0.0) phi += 6.2831853; return vec2(phi / 6.2831853, 1.0 - acos(clamp(n.y, -1.0, 1.0)) / 3.1415927); }
      void main(){
        float lon = vUv.x * 360.0 - 180.0, lat = vUv.y * 180.0 - 90.0;
        vec3 day = texture2D(dayMap, vUv).rgb;
        vec2 duv = vec2((lon - bounds.x) / (bounds.y - bounds.x), (lat - bounds.z) / (bounds.w - bounds.z));
        float edge = smoothstep(0.0, 0.05, duv.x) * smoothstep(1.0, 0.95, duv.x) * smoothstep(0.0, 0.07, duv.y) * smoothstep(1.0, 0.93, duv.y);
        day = mix(day, texture2D(detailMap, clamp(duv, 0.0, 1.0)).rgb, edge);
        vec3 N = normalize(vN), L = normalize(sunDir), V = normalize(camPos - vW);
        float ndl = dot(N, L);
        float water = clamp((day.b - max(day.r, day.g * 0.85)) * 30.0, 0.0, 1.0) * (1.0 - smoothstep(0.08, 0.2, day.g));
        // shallow seas (Bahamas banks) glow turquoise; deep ocean stays near-black blue
        vec3 col = day * 1.35 * max(ndl, 0.0);
        vec3 H = normalize(L + V);
        float nh = max(dot(N, H), 0.0);
        col += vec3(1.0, 0.92, 0.8) * (pow(nh, 260.0) * 3.5 + pow(nh, 40.0) * 0.12) * water * smoothstep(0.0, 0.15, ndl);
        // clouds + their shadows (sun direction in the Earth's own frame)
        float c = texture2D(cloudMap, vUv).r;
        float sh = texture2D(cloudMap, uvOf(normalize(vL + normalize(sunLocal) * 0.0025))).r;
        col *= 1.0 - sh * 0.55;
        vec3 cloudCol = vec3(1.0) * (0.06 + 1.2 * max(ndl, 0.0));
        col = mix(col, cloudCol, c * 0.95);
        // city lights on the night side
        col += texture2D(nightMap, vUv).rgb * vec3(1.0, 0.75, 0.45) * smoothstep(0.08, -0.12, ndl) * (1.0 - c) * 1.6;
        // aerial perspective: blue scattering that thickens toward the limb
        float mu = max(dot(N, V), 0.0);
        float haze = pow(1.0 - mu, 3.5);
        vec3 sky = vec3(0.22, 0.45, 1.0) * (0.12 + 0.9 * max(ndl + 0.15, 0.0));
        col = mix(col, sky, clamp(haze * 0.9 + 0.06, 0.0, 0.92));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

/** Thin atmosphere shell: glow from the ray's closest approach height (the "thin blue line" + twilight band). */
const atmosphereMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: SUN_DIR.clone() }, camPos: { value: new THREE.Vector3() }, center: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir, camPos, center; varying vec3 vW;
      void main(){
        vec3 V = normalize(vW - camPos);
        vec3 oc = camPos - center;
        float t = -dot(oc, V);
        vec3 cp = oc + V * max(t, 0.0);
        float h = length(cp) - ${R_EARTH.toFixed(1)};
        float dens = exp(-max(h, 0.0) / 9.0) * smoothstep(-2.0, 1.0, h);
        float s = dot(normalize(cp), sunDir);
        float lit = smoothstep(-0.25, 0.2, s);
        vec3 blue = vec3(0.25, 0.55, 1.0) * 2.4;
        vec3 dusk = vec3(1.0, 0.45, 0.18) * 2.0;
        vec3 col = mix(dusk, blue, smoothstep(0.0, 0.3, s)) * lit;
        col += vec3(0.05, 0.25, 0.12) * 0.2 * (1.0 - lit); // faint green airglow on the night side
        gl_FragColor = vec4(col * dens, dens);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
  });

/** Helmet visor: curvature, edge fringing, breath fog, visor reflections, helmet rim, alert tint. */
const VisorShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    res: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 },
    fog: { value: 0.2 },
    alert: { value: 0 },
    flash: { value: 0 },
    dark: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 res; uniform float time, fog, alert, flash, dark; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 q = uv - 0.5;
      float asp = res.x / res.y;
      vec2 qa = vec2(q.x * asp, q.y);
      // visor curvature: gentle barrel distortion
      vec2 duv = 0.5 + q * (1.0 - 0.06 * dot(qa, qa));
      float r = length(qa * vec2(0.62, 1.0));
      float ca = smoothstep(0.25, 0.75, r) * 0.006;
      vec3 c = vec3(texture2D(tDiffuse, duv + q * ca).r, texture2D(tDiffuse, duv).g, texture2D(tDiffuse, duv - q * ca).b);
      // breath condensation: low centre of the visor, softly blurred and brightened
      float fm = fog * smoothstep(0.42, 0.0, length((uv - vec2(0.5, -0.04)) * vec2(1.1, 1.9)));
      vec3 b = vec3(0.0);
      for (int i = 0; i < 6; i++) { float a = float(i) * 1.047; b += texture2D(tDiffuse, duv + vec2(cos(a), sin(a)) * 0.012).rgb; }
      c = mix(c, b / 6.0 * 0.8 + vec3(0.16, 0.17, 0.18), clamp(fm, 0.0, 0.75));
      // visor reflections: a curved highlight and a broad sheen from the helmet lights
      float arc = 0.86 - 0.32 * pow(uv.x - 0.42, 2.0);
      c += vec3(0.7, 0.78, 0.9) * smoothstep(0.006, 0.0, abs(uv.y - arc)) * smoothstep(0.08, 0.35, uv.x) * smoothstep(0.92, 0.62, uv.x) * 0.06;
      c += vec3(0.6, 0.7, 0.85) * smoothstep(0.7, 0.0, length((uv - vec2(0.12, 0.92)) * vec2(1.3, 2.0))) * 0.035;
      // helmet rim: the opening of the visor, darker and slightly blue at the edges
      float rim = smoothstep(0.52, 0.8, r) + smoothstep(0.9, 1.0, uv.y) * 0.85;
      c = mix(c, vec3(0.004, 0.006, 0.01), clamp(rim, 0.0, 1.0));
      c += vec3(0.6, 0.04, 0.0) * alert * smoothstep(0.38, 0.75, r) * (0.55 + 0.45 * sin(time * 6.0));
      c += vec3(0.85, 0.9, 1.0) * flash;
      c *= 1.0 - dark;
      c += (hash(uv * res + fract(time) * 91.0) - 0.5) * 0.025;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/** Sun lens flare in linear HDR: starburst, anamorphic streak and ghosts mirrored through the centre. */
const FlareShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, sun: { value: new THREE.Vector2(0.5, 0.5) }, strength: { value: 0 }, aspect: { value: 16 / 9 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 sun; uniform float strength, aspect; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (strength > 0.001) {
        vec2 d = vUv - sun; d.x *= aspect;
        float r = length(d), a = atan(d.y, d.x);
        float burst = pow(abs(sin(a * 4.0 + 0.4)), 30.0) * exp(-r * 5.0) * 0.5 + pow(abs(sin(a * 7.0)), 60.0) * exp(-r * 9.0) * 0.4;
        float glow = exp(-r * 14.0) * 1.2 + exp(-r * 3.5) * 0.12;
        float streak = exp(-abs(d.y) * 160.0) * exp(-abs(d.x) * 1.8) * 0.35;
        vec3 col = vec3(1.0, 0.94, 0.84) * (burst + glow) + vec3(0.6, 0.75, 1.0) * streak;
        vec2 axis = vec2(0.5) - sun;
        for (int i = 0; i < 5; i++) {
          float k = 0.45 + float(i) * 0.38;
          vec2 g = sun + axis * k * 2.0;
          vec2 gd = (vUv - g); gd.x *= aspect;
          float sz = 0.02 + 0.025 * float(i - (i / 2) * 2) + 0.01 * float(i);
          float ring = smoothstep(sz, sz * 0.7, length(gd)) * (0.6 + 0.4 * smoothstep(sz * 0.4, sz, length(gd)));
          col += mix(vec3(0.25, 0.5, 1.0), vec3(1.0, 0.6, 0.3), float(i) / 4.0) * ring * 0.07;
        }
        c += col * strength;
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// ───────────────────────────────────────────── stage
type Vec = THREE.Vector3;
interface Travel { pts: THREE.CatmullRomCurve3; look: THREE.CatmullRomCurve3; t: number; dur: number; climb: boolean; resolve: () => void }
interface HandTween { from: { p: Vec; r: THREE.Euler; g: number }; to: { p: Vec; r: THREE.Euler; g: number }; t: number; dur: number; resolve: () => void }
interface Streak { p: Vec; v: Vec; len: number; life: number }
interface Spark { p: Vec; v: Vec; life: number }

const PRESETS: Record<Quality, { shadow: number; bloom: boolean; msaa: number; seg: number }> = {
  high: { shadow: 2048, bloom: true, msaa: 4, seg: 512 },
  medium: { shadow: 1536, bloom: true, msaa: 2, seg: 384 },
  low: { shadow: 1024, bloom: false, msaa: 0, seg: 256 },
};

export class ISSStage implements Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.03, 4000);
  private sky = new THREE.Scene();
  private skyCam = new THREE.PerspectiveCamera(70, 16 / 9, 20, 40000);
  private composer: EffectComposer;
  private visor: ShaderPass;
  private flare: ShaderPass;
  private sunVis = 0;
  private occluders: THREE.Object3D[] = [];
  private ray = new THREE.Raycaster();
  private frame = 0;
  private earth: THREE.Mesh;
  private earthMat: THREE.ShaderMaterial;
  private atmo: THREE.ShaderMaterial;
  private earthQ0 = new THREE.Quaternion();
  private orbitAngle = 0;
  private sun: THREE.DirectionalLight;
  private preset: (typeof PRESETS)['high'];
  readonly m: Mats;

  // camera rig
  readonly camBase = new THREE.Vector3(-1.75, 0, 0);
  readonly lookBase = new THREE.Vector3(10, 0, 0);
  lookYaw = 0;
  lookPitch = 0;
  private travel: Travel | null = null;
  private climbPhase = 0;
  shake = 0;
  private kickT = 9;
  private kickAmp = 0;
  private elapsed = 0;
  paused = false;

  // hands + tools
  readonly hands: { L: Hand; R: Hand };
  private handTw: Partial<Record<'L' | 'R', HandTween>> = {};
  private climbing = false;
  readonly pgt: ReturnType<typeof pistolGripTool>;

  // station + job
  readonly hatch: THREE.Group;
  readonly oldOru: Oru;
  readonly newOru: Oru;
  readonly worksite = new THREE.Vector3(24, 4.5, 1.8 + 0.27);
  private tether: THREE.Line;
  tetherAnchor: Vec | null = null;
  private airlockLight: THREE.PointLight;

  // debris
  debris = 0;
  private streaks: Streak[] = [];
  private streakGeo: THREE.BufferGeometry;
  private sparks: Spark[] = [];
  private sparkGeo: THREE.BufferGeometry;
  private sparkMat: THREE.PointsMaterial;
  exposure = 1.0;
  fog = 0.2;
  alert = 0;
  dark = 0;
  private flashT = 0;

  constructor(assets: Assets, renderer: THREE.WebGLRenderer, quality: Quality) {
    this.preset = PRESETS[quality];
    this.m = makeMaterials();

    // ── sky: Earth, atmosphere, stars, Sun (km)
    const t = assets.textures;
    this.keepTextures(t);
    this.earthMat = earthMaterial(t.earthHd ?? t.earthDay ?? null, t.earthDetail ?? null, t.earthNight ?? null, t.earthClouds ?? null);
    for (const tex of [t.earthHd, t.earthDetail, t.earthNight, t.earthClouds]) if (tex) { tex.anisotropy = 16; tex.needsUpdate = true; }
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH, this.preset.seg, this.preset.seg / 2), this.earthMat);
    this.earth.position.set(0, -(R_EARTH + ALT), 0);
    this.sky.add(this.earth);
    this.atmo = atmosphereMaterial();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH + 90, 256, 128), this.atmo);
    shell.position.copy(this.earth.position);
    this.atmo.uniforms.center.value.copy(this.earth.position);
    this.sky.add(shell);
    if (t.stars) {
      const stars = new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 24), new THREE.MeshBasicMaterial({ map: t.stars, side: THREE.BackSide, color: 0x2a2a2a, depthWrite: false }));
      this.sky.add(stars);
    }
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex([[0, 'rgba(255,255,255,1)'], [0.08, 'rgba(255,250,235,1)'], [0.2, 'rgba(255,230,190,0.35)'], [1, 'rgba(255,200,150,0)']]), color: new THREE.Color(30, 28, 25), blending: THREE.AdditiveBlending, depthWrite: false }));
    sunSprite.position.copy(SUN_DIR).multiplyScalar(20000);
    sunSprite.scale.setScalar(2600);
    this.sky.add(sunSprite);
    this.orientEarth();

    // ── station (metres)
    this.scene.add(new THREE.HemisphereLight(0x0a0d14, 0x3c5c88, 1.25)); // black sky above, blue Earthshine from below
    this.sun = new THREE.DirectionalLight(0xfff6ea, 3.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.preset.shadow, this.preset.shadow);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -14; sc.right = sc.top = 14; sc.near = 1; sc.far = 80;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.hatch = this.buildStation();
    this.occluders = this.scene.children.filter((o) => !(o instanceof THREE.Light));
    this.oldOru = batteryOru(this.m, ['LI-ION BATT ORU', 'P4-3B  S/N 0021', 'FAULT · ISOLATE'], false);
    this.oldOru.group.position.copy(this.worksite);
    this.newOru = batteryOru(this.m, ['LI-ION BATT ORU', 'P4-3B  S/N 0034', 'FLIGHT SPARE'], true);
    this.newOru.group.position.set(this.worksite.x + 1.9, this.worksite.y - 0.1, this.worksite.z + 0.9);
    this.newOru.group.rotation.y = -0.5;
    this.scene.add(this.oldOru.group, this.newOru.group);

    this.airlockLight = new THREE.PointLight(0xffe6c0, 1.8, 5, 1.6);
    this.airlockLight.position.set(-2.6, 0.4, 0);
    const fill = new THREE.PointLight(0xcfe0ff, 0.9, 4, 2);
    fill.position.set(-1.0, -0.5, 0.4);
    this.scene.add(this.airlockLight, fill);

    // ── first person: camera carries the gloves + tool
    this.scene.add(this.camera);
    this.hands = { L: glove(-1), R: glove(1) };
    this.camera.add(this.hands.L.root, this.hands.R.root);
    this.pgt = pistolGripTool();
    this.pgt.group.visible = false;
    this.hands.R.root.add(this.pgt.group);
    this.pgt.group.position.set(0, -0.04, -0.07);
    this.restHands(0);

    // safety tether (white braided line from the suit to the anchor)
    this.tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 24 }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0xdedbd2 }));
    this.tether.frustumCulled = false;
    this.tether.visible = false;
    this.scene.add(this.tether);

    // debris streaks + impact sparks (HDR colours so bloom catches them)
    this.streakGeo = new THREE.BufferGeometry();
    this.streakGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(160 * 6), 3));
    const streaks = new THREE.LineSegments(this.streakGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(6, 4.2, 2.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true }));
    streaks.frustumCulled = false;
    this.scene.add(streaks);
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(400 * 3), 3));
    this.sparkMat = new THREE.PointsMaterial({ color: new THREE.Color(8, 5, 2.5), size: 0.05, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const sparks = new THREE.Points(this.sparkGeo, this.sparkMat);
    sparks.frustumCulled = false;
    this.scene.add(sparks);


    // ── post: sky → station (depth cleared) → bloom → output → visor
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.preset.msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(this.sky, this.skyCam));
    const stationPass = new RenderPass(this.scene, this.camera);
    stationPass.clear = false;
    stationPass.clearDepth = true;
    this.composer.addPass(stationPass);
    if (this.preset.bloom) this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.24, 0.45, 1.35));
    this.flare = new ShaderPass(FlareShader);
    this.composer.addPass(this.flare);
    this.composer.addPass(new OutputPass());
    this.visor = new ShaderPass(VisorShader);
    this.composer.addPass(this.visor);
  }

  /** Put START under the station with east along +X (direction of flight). */
  private orientEarth() {
    const P = (lat: number, lon: number) => {
      const phi = ((lon + 180) / 360) * Math.PI * 2, th = ((90 - lat) / 180) * Math.PI;
      return new THREE.Vector3(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
    };
    const u = P(START.lat, START.lon);
    const east = P(START.lat, START.lon + 0.01).sub(u).normalize();
    const north = P(START.lat + 0.01, START.lon).sub(u).normalize();
    const hd = THREE.MathUtils.degToRad(START.heading);
    const fwd = east.clone().multiplyScalar(Math.sin(hd)).addScaledVector(north, Math.cos(hd)).normalize(); // direction of flight
    const side = fwd.clone().cross(u).normalize(); // (fwd, up, side) right-handed like (x, y, z)
    const local = new THREE.Matrix4().makeBasis(fwd, u, side);
    this.earthQ0.setFromRotationMatrix(local.transpose());
  }

  private buildStation() {
    const m = this.m, s = this.scene;
    const add = (o: THREE.Object3D, x: number, y: number, z: number) => { o.position.set(x, y, z); s.add(o); return o; };
    const shadows = (o: THREE.Object3D) => o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });

    // Quest airlock (crewlock): we start inside, looking out of the open hatch along +X
    const air = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 3.6, 48, 1, true), m.mliSmall);
    hull.rotation.z = Math.PI / 2;
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 3.5, 32, 1, true), m.interior);
    inner.material = m.interior.clone();
    (inner.material as THREE.MeshStandardMaterial).side = THREE.BackSide;
    inner.rotation.z = Math.PI / 2;
    const back = new THREE.Mesh(new THREE.CircleGeometry(1.05, 32), m.interior);
    back.position.x = -1.75; back.rotation.y = Math.PI / 2;
    air.add(hull, inner, back);
    // interior racks, lights, handholds
    for (const x of [-1.2, -0.4, 0.4, 1.2]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.03, 8, 40), m.aluDark);
      rib.rotation.y = Math.PI / 2;
      rib.position.x = x;
      air.add(rib);
    }
    for (const a of [0.9, Math.PI - 0.9]) {
      const hr = handrail(m, 1.6);
      hr.rotation.x = Math.PI / 2 + a;
      hr.position.set(-0.4, Math.cos(a) * 0.98 * -1 + 0.0, Math.sin(a) * 0.98);
      air.add(hr);
    }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d8, emissiveIntensity: 2.5 }));
    lamp.position.set(-0.8, 0.96, 0);
    air.add(lamp);
    // hatch ring + door (hinged at the top)
    const ringGeo = new THREE.RingGeometry(0.52, 1.12, 48);
    const ringFace = new THREE.Mesh(ringGeo, m.alu);
    ringFace.rotation.y = Math.PI / 2;
    ringFace.position.x = 1.8;
    const seal = new THREE.Mesh(new THREE.TorusGeometry(0.53, 0.035, 10, 48), m.aluDark);
    seal.rotation.y = Math.PI / 2;
    seal.position.x = 1.81;
    air.add(ringFace, seal);
    const hatch = new THREE.Group();
    hatch.position.set(1.85, 0.53, 0);
    const door = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.08, 40), m.alu);
    door.rotation.z = Math.PI / 2;
    door.position.y = -0.53;
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 8, 24), m.aluDark);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(-0.06, -0.53, 0);
    hatch.add(door, wheel);
    air.add(hatch);
    shadows(air);
    add(air, -2.2 + 0.4, 0, 0); // hatch plane at x ≈ 0
    air.position.x = -1.8;

    // Unity node + Destiny lab behind, under the truss
    const node = module(m, 5.5, 2.2); node.rotation.y = Math.PI / 2; shadows(node); add(node, -6.6, 0.2, 0);
    const lab = module(m, 8.5, 2.2); shadows(lab); add(lab, -13.8, 0.2, 0);
    const pma = module(m, 2.2, 1.4); shadows(pma); add(pma, -6.6, 0.2, 4.2).rotation.y = Math.PI / 2;

    // climbing frame from the airlock up to the truss, with handrails
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.2, 0.2), m.alu);
    add(post, 1.05, 1.9, 0.65);
    for (let y = 0.8; y < 3.4; y += 0.55) {
      const hr = handrail(m, 0.42);
      hr.rotation.z = Math.PI / 2;
      add(hr, 1.15, y, 0.65);
    }

    // integrated truss S0 → P4 above everything
    const tr = truss(m, -14, 60);
    shadows(tr);
    add(tr, 0, 4.6, 0);
    // handrail line along the outboard face (the translation path)
    for (let x = 2.4; x < 23.5; x += 1.35) {
      const hr = handrail(m, 0.62);
      hr.rotation.x = Math.PI / 2;
      add(hr, x, 3.55, 1.8);
    }
    // battery bank on P4: the neighbouring ORUs
    for (const dx of [-2.4, -1.2, 1.2, 2.4]) {
      const o = batteryOru(m, ['LI-ION BATT ORU', `P4-${dx < 0 ? '2' : '4'}${dx === -1.2 || dx === 1.2 ? 'A' : 'B'}`, 'NOMINAL'], true);
      o.status.emissiveIntensity = 2.5;
      shadows(o.group);
      add(o.group, this.worksite.x + dx, this.worksite.y, this.worksite.z);
    }
    // articulating portable foot restraint at the worksite
    const apfr = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.3), m.aluDark);
    arm.position.z = 0.65;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.32), m.alu);
    plate.position.set(0, -0.05, 1.3);
    apfr.add(arm, plate);
    shadows(apfr);
    add(apfr, this.worksite.x, 2.95, 1.8);

    // radiators + solar array wings (beta gimbal tilted)
    const rad = radiator(m, 5, 3.3, 2.4); add(rad, 33, 2.8, 0);
    const rad2 = radiator(m, 4, 3.0, 2.2); add(rad2, -9, 2.8, 0);
    for (const [x, beta] of [[57, 0.55], [-17, -0.4]] as const) {
      const sarj = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 1.2, 32), m.mliSmall);
      sarj.rotation.z = Math.PI / 2;
      add(sarj, x, 4.6, 0);
      for (const dir of [1, -1]) {
        const wing = solarWing(m);
        wing.rotation.set(beta, dir > 0 ? 0 : Math.PI, 0);
        shadows(wing);
        add(wing, x + 1.2 * Math.sign(x), 4.6, dir * 2.2);
      }
    }
    // a few antennas / cameras for silhouette detail
    const r = rng(5);
    for (let i = 0; i < 6; i++) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8), m.aluDark);
      const x = -10 + r() * 60;
      add(mast, x, 6.9, (r() - 0.5) * 2.6);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 8, 0, Math.PI * 2, 0, 1.0), m.white);
      add(dish, x, 7.5, mast.position.z).rotation.x = Math.PI;
    }
    return hatch;
  }

  // ───────────────────────────────────────────── camera + hands API
  /** Glide the helmet along a path (world points), looking at `look` points. climb = hand-over-hand. */
  move(pts: Vec[], look: Vec[], dur: number, climb = true): Promise<void> {
    return new Promise((resolve) => {
      this.travel = { pts: new THREE.CatmullRomCurve3([this.camBase.clone(), ...pts]), look: new THREE.CatmullRomCurve3([this.lookBase.clone(), ...look]), t: 0, dur, climb, resolve };
      this.climbing = climb;
    });
  }

  /** Tween one hand to a camera-space pose. */
  hand(side: 'L' | 'R', p: [number, number, number], r: [number, number, number], grip: number, dur = 0.6): Promise<void> {
    const h = this.hands[side];
    return new Promise((resolve) => {
      this.handTw[side]?.resolve();
      this.handTw[side] = {
        from: { p: h.root.position.clone(), r: h.root.rotation.clone(), g: h.grip },
        to: { p: new THREE.Vector3(...p), r: new THREE.Euler(...r), g: grip },
        t: 0, dur, resolve,
      };
    });
  }
  restHands(dur = 0.8) {
    return Promise.all([this.hand('L', [-0.26, -0.37, -0.52], [0.3, 0.25, 0.35], 0.3, dur), this.hand('R', [0.26, -0.37, -0.52], [0.3, -0.25, -0.35], 0.3, dur)]);
  }
  /** Reach toward a world point with one hand (hand stops a little short of it). */
  reach(side: 'L' | 'R', world: Vec, grip = 0.8, dur = 0.7) {
    const local = this.camera.worldToLocal(world.clone());
    local.multiplyScalar(Math.min(1, 0.56 / Math.max(0.3, local.length())));
    return this.hand(side, [local.x, local.y - 0.08, local.z + 0.06], [0.1, side === 'L' ? 0.2 : -0.2, side === 'L' ? 0.5 : -0.5], grip, dur);
  }
  showTool(on: boolean) { this.pgt.group.visible = on; }
  setOruStatus(o: Oru, ok: boolean) { o.status.emissive.set(ok ? 0x00ff66 : 0xff2200); o.status.emissiveIntensity = ok ? 4 : 5; }
  /** Impact jolt + flash. */
  kick(a = 1, flash = 0) { this.kickAmp = Math.max(this.kickAmp * Math.exp(-this.kickT * 4), a); this.kickT = 0; this.flashT = Math.max(this.flashT, flash); }
  burst(at: Vec, n = 40, speed = 3) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      if (this.sparks.length < 400) this.sparks.push({ p: at.clone(), v, life: 0.6 + Math.random() * 0.8 });
    }
  }
  /** Animate an object from its pose to a target over `dur` (used for ORU swap, hatch). */
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
  private tickers = new Set<(dt: number) => void>();
  /** World → normalised screen coords for HUD markers. */
  toScreen(p: Vec) {
    const v = p.clone().project(this.camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, behind: v.z > 1 };
  }
  get earthSpeedKmh() { return ORBIT_RATE * (R_EARTH + ALT) * 3600; }
  /** Sub-satellite point (lat, lon), for the HUD. */
  groundPoint() {
    const inv = this.earth.quaternion.clone().invert();
    const p = new THREE.Vector3(0, 1, 0).applyQuaternion(inv);
    const lat = THREE.MathUtils.radToDeg(Math.asin(p.y));
    const lon = THREE.MathUtils.radToDeg(Math.atan2(p.z, -p.x)) - 180;
    return { lat, lon: ((lon + 540) % 360) - 180 };
  }

  // ───────────────────────────────────────────── per frame
  update(dt: number) {
    if (this.paused) return;
    this.elapsed += dt;
    // orbital motion: the Earth turns beneath us at the real rate
    this.orbitAngle += ORBIT_RATE * dt;
    this.earth.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.orbitAngle).multiply(this.earthQ0);
    this.earthMat.uniforms.sunLocal.value.copy(SUN_DIR).applyQuaternion(this.earth.quaternion.clone().invert());

    for (const f of [...this.tickers]) f(dt);

    // helmet path
    if (this.travel) {
      const tr = this.travel;
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      const e = tr.t < 0.5 ? 2 * tr.t * tr.t : 1 - Math.pow(-2 * tr.t + 2, 2) / 2;
      // hand-over-hand moves in pulses: speed swells each time a hand pulls
      const pulse = tr.climb ? e + Math.sin(e * Math.PI * 2 * Math.max(2, tr.dur / 1.1)) * 0.012 : e;
      this.camBase.copy(tr.pts.getPoint(THREE.MathUtils.clamp(pulse, 0, 1)));
      this.lookBase.copy(tr.look.getPoint(e));
      if (tr.climb) this.climbPhase += dt * (1 / 1.1);
      if (tr.t >= 1) { this.travel = null; this.climbing = false; tr.resolve(); void this.restHands(0.6); }
    }
    this.updateCamera(dt);
    this.updateHands(dt);
    this.updateTether();
    this.updateDebris(dt);

    // sun shadow box follows the helmet
    this.sun.target.position.copy(this.camera.position);
    this.sun.position.copy(this.camera.position).addScaledVector(SUN_DIR, 40);

    // sky camera mirrors the helmet orientation (the station is a point at the sky's scale)
    this.skyCam.quaternion.copy(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    this.earthMat.uniforms.camPos.value.set(0, 0, 0);
    this.atmo.uniforms.camPos.value.set(0, 0, 0);

    this.updateFlare(dt);
    this.flashT = Math.max(0, this.flashT - dt * 2.2);
    const u = this.visor.uniforms;
    u.time.value = this.elapsed;
    u.fog.value = this.fog * (0.55 + 0.45 * Math.max(0, Math.sin(this.elapsed * (Math.PI * 2) / 4.2)));
    u.alert.value += (this.alert - u.alert.value) * Math.min(1, dt * 3);
    u.flash.value = this.flashT * this.flashT * 0.7;
    u.dark.value = this.dark;
  }

  private updateCamera(dt: number) {
    const cam = this.camera;
    // floating drift + breathing bob, free-look offsets, shake
    const t = this.elapsed;
    const bob = new THREE.Vector3(Math.sin(t * 0.37) * 0.012, Math.sin(t * 1.5) * 0.006 + Math.sin(t * 0.23) * 0.01, Math.cos(t * 0.29) * 0.01);
    cam.position.copy(this.camBase).add(bob);
    cam.lookAt(this.lookBase);
    cam.rotateY(this.lookYaw);
    cam.rotateX(this.lookPitch);
    cam.rotateZ(Math.sin(t * 0.21) * 0.012);
    this.kickT += dt;
    const k = this.kickAmp * Math.exp(-this.kickT * 4);
    const a = this.shake * 0.004 + k * 0.035;
    if (a > 1e-5) {
      cam.rotateX((Math.sin(t * 31) * 0.6 + Math.sin(t * 17.3) * 0.4) * a);
      cam.rotateY((Math.sin(t * 27.1 + 1) * 0.6 + Math.sin(t * 13.7) * 0.4) * a);
      cam.rotateZ(Math.sin(t * 9.3) * a * 0.5);
    }
  }

  private updateHands(dt: number) {
    for (const side of ['L', 'R'] as const) {
      const h = this.hands[side];
      if (this.climbing) {
        // hand-over-hand: reach forward open, grab, pull back closed; the hands alternate
        const ph = (this.climbPhase + (side === 'L' ? 0 : 0.5)) % 1;
        const sx = side === 'L' ? -1 : 1;
        let p: THREE.Vector3, g: number;
        if (ph < 0.5) { const k = ph / 0.5; p = new THREE.Vector3(sx * 0.16, -0.15 - k * 0.2, -0.76 + k * 0.24); g = 0.9; }
        else { const k = (ph - 0.5) / 0.5; p = new THREE.Vector3(sx * (0.2 + Math.sin(k * Math.PI) * 0.06), -0.35 + k * 0.2 + Math.sin(k * Math.PI) * 0.05, -0.52 - k * 0.24); g = k < 0.75 ? 0.2 : 0.2 + (k - 0.75) * 2.8; }
        h.root.position.lerp(p, Math.min(1, dt * 14));
        h.root.rotation.set(0.15, -sx * 0.15, -sx * 0.45);
        setGrip(h, THREE.MathUtils.lerp(h.grip, g, Math.min(1, dt * 12)));
        continue;
      }
      const tw = this.handTw[side];
      if (!tw) continue;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const e = tw.t * tw.t * (3 - 2 * tw.t);
      h.root.position.lerpVectors(tw.from.p, tw.to.p, e);
      h.root.rotation.set(
        THREE.MathUtils.lerp(tw.from.r.x, tw.to.r.x, e),
        THREE.MathUtils.lerp(tw.from.r.y, tw.to.r.y, e),
        THREE.MathUtils.lerp(tw.from.r.z, tw.to.r.z, e));
      setGrip(h, THREE.MathUtils.lerp(tw.from.g, tw.to.g, e));
      if (tw.t >= 1) { delete this.handTw[side]; tw.resolve(); }
    }
  }

  private updateTether() {
    if (!this.tetherAnchor) { this.tether.visible = false; return; }
    this.tether.visible = true;
    const hip = this.camera.localToWorld(new THREE.Vector3(-0.15, -0.75, 0.05));
    const a = this.tetherAnchor;
    const pos = this.tether.geometry.attributes.position as THREE.BufferAttribute;
    const n = pos.count, d = hip.distanceTo(a);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const p = hip.clone().lerp(a, k);
      // slack: a lazy curve that drifts (no gravity in orbit, so it floats in loose arcs)
      const sag = Math.sin(k * Math.PI) * Math.min(1.2, d * 0.12);
      p.x += Math.sin(k * 5 + this.elapsed * 0.6) * sag * 0.25;
      p.y += Math.sin(k * Math.PI) * sag * 0.4 - sag * 0.2;
      p.z += Math.cos(k * 4 + this.elapsed * 0.5) * sag * 0.25;
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
  }

  private updateDebris(dt: number) {
    // spawn streaks ahead (debris crosses the orbit at kilometres per second; drawn slowed so it reads)
    if (this.debris > 0) {
      const want = Math.floor(this.debris * 2.2 * dt * 60);
      for (let i = 0; i < want && this.streaks.length < 160; i++) {
        const dir = new THREE.Vector3(-1, (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.5).normalize();
        const p = this.camera.position.clone().add(new THREE.Vector3(80 + Math.random() * 80, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 90));
        this.streaks.push({ p, v: dir.multiplyScalar(140 + Math.random() * 160), len: 3 + Math.random() * 8, life: 2 });
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
    for (let i = j; i < arr.count; i++) arr.setXYZ(i, 0, -1e5, 0);
    arr.needsUpdate = true;
    this.streakGeo.setDrawRange(0, j);

    const sp = this.sparkGeo.attributes.position as THREE.BufferAttribute;
    this.sparks = this.sparks.filter((s) => (s.life -= dt) > 0);
    this.sparks.forEach((s, i) => { s.p.addScaledVector(s.v, dt); sp.setXYZ(i, s.p.x, s.p.y, s.p.z); });
    sp.needsUpdate = true;
    this.sparkGeo.setDrawRange(0, this.sparks.length);
  }

  /** Sun on screen? Is the station in the way? (raycast a few times a second) */
  private updateFlare(dt: number) {
    const sp = this.camera.position.clone().addScaledVector(SUN_DIR, 1000).project(this.camera);
    const onScreen = sp.z < 1 && Math.abs(sp.x) < 1.3 && Math.abs(sp.y) < 1.3;
    if (onScreen && this.frame++ % 6 === 0) {
      this.ray.set(this.camera.position, SUN_DIR);
      this.ray.far = 300;
      this.blocked = this.ray.intersectObjects(this.occluders, true).length > 0;
    }
    const target = onScreen && !this.blocked ? 1 - Math.min(1, Math.hypot(sp.x, sp.y) / 1.6) * 0.5 : 0;
    this.sunVis += (target - this.sunVis) * Math.min(1, dt * 10);
    const f = this.flare.uniforms;
    f.sun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    f.strength.value = this.sunVis;
  }
  private blocked = false;

  render(renderer: THREE.WebGLRenderer) {
    const prev = renderer.toneMappingExposure;
    renderer.toneMappingExposure = this.exposure;
    this.composer.render();
    renderer.toneMappingExposure = prev;
  }

  resize(w: number, h: number) {
    this.camera.aspect = this.skyCam.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.skyCam.updateProjectionMatrix();
    this.composer.setPixelRatio(this.composer.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.visor.uniforms.res.value.set(w, h);
    this.flare.uniforms.aspect.value = w / h;
  }

  dispose() {
    this.composer.dispose();
    for (const s of [this.scene, this.sky]) s.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mt of mats) {
        for (const v of Object.values(mt)) if (v instanceof THREE.Texture && !Object.values(this.sharedTex).includes(v)) v.dispose();
        mt.dispose();
      }
    });
  }
  private sharedTex: Record<string, THREE.Texture> = {};
  /** Shared asset textures must not be disposed with the stage. */
  keepTextures(t: Record<string, THREE.Texture | null | undefined>) { for (const [k, v] of Object.entries(t)) if (v) this.sharedTex[k] = v; }
}

function glowTex(stops: [number, string][]) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
