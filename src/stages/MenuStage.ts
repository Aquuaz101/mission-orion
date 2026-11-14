import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Stage } from '../core/Engine';
import type { Assets } from '../core/Assets';
import { createStarSphere } from './sky';

/**
 * Main-menu scene: a realistic orbital establishing shot. A large Earth (NASA Blue Marble globally; under the camera
 * the real NOAA-20 VIIRS image of the Gulf of Mexico at ≈ 0.5 km/px with its own clouds and cloud shadows, plus
 * NASA Black Marble city lights past the terminator; a thin physically-shaped atmosphere), the Sun just above the limb,
 * and NASA's high-detail ISS (the same model the spacewalk uses) streamed in after the menu appears, drifting into
 * frame lit by the Sun, blue Earthshine and reflections.
 * Slow cinematic drift + slight mouse parallax; filmic grade.
 */
const R = 10;                                   // Earth radius (scene units)
const EARTH_C = new THREE.Vector3(0, -11.4, -3); // close: the horizon arcs across the lower frame
const SUN_DIR = new THREE.Vector3(0.86, 0.32, -0.12).normalize(); // low Sun from the right: day/dusk across the disc
const ISS_HOME = new THREE.Vector3(1.75, 0.05, -0.6);
/** Sub-camera point on Earth: the Gulf of Mexico and Florida, inside the high-resolution satellite patch. */
const VIEW_LAT = 4, VIEW_LON = -84; // the camera looks over the limb: the visible band is ≈ 20–40° north of this point
/** Bounds of the VIIRS / Black Marble patch (must match issfx). */
const DETAIL = { lon0: -100, lon1: -60, lat1: 12, lat0: 38 };

const earthVert = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vL;
  void main(){ vUv = uv; vL = normalize(position); vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const earthFrag = /* glsl */ `
  uniform sampler2D day, night, clouds, detail, nightDetail; uniform vec4 bounds; uniform float hasDetail; uniform vec3 sunDir, sunLocal; uniform float cloudShift;
  vec2 dUv(vec2 uv){ return vec2((uv.x * 360.0 - 180.0 - bounds.x) / (bounds.y - bounds.x), (uv.y * 180.0 - 90.0 - bounds.z) / (bounds.w - bounds.z)); }
  float edgeOf(vec2 d){ return hasDetail * smoothstep(0.0, 0.06, d.x) * smoothstep(1.0, 0.94, d.x) * smoothstep(0.0, 0.08, d.y) * smoothstep(1.0, 0.92, d.y); }
  float cloudOf(vec3 c){ return smoothstep(0.2, 0.6, min(c.r, min(c.g, c.b))); }
  varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vL;
  vec2 uvOf(vec3 n){ float phi = atan(n.z, -n.x); if (phi < 0.0) phi += 6.2831853; return vec2(phi / 6.2831853, 1.0 - acos(clamp(n.y, -1.0, 1.0)) / 3.1415927); }
  void main(){
    vec3 N = normalize(vN), L = normalize(sunDir), V = normalize(cameraPosition - vW);
    float ndl = dot(N, L);
    vec3 d = texture2D(day, vUv).rgb;
    vec2 duv = dUv(vUv);
    float edge = edgeOf(duv);
    vec3 img = texture2D(detail, clamp(duv, 0.0, 1.0)).rgb;
    d = mix(d, img, edge);
    vec2 cuv = vUv + vec2(cloudShift, 0.0);
    float c = mix(texture2D(clouds, cuv).r, cloudOf(img), edge);
    vec2 suv = uvOf(normalize(vL + normalize(sunLocal) * 0.004));
    float sh = mix(texture2D(clouds, suv + vec2(cloudShift, 0.0)).r, cloudOf(texture2D(detail, clamp(dUv(suv), 0.0, 1.0)).rgb), edge);
    float cShade = mix(1.0, clamp(dot(img, vec3(0.3, 0.5, 0.2)) * 1.2, 0.55, 1.15), edge);
    // soft terminator (light wraps a little through the atmosphere)
    float lit = smoothstep(-0.08, 0.35, ndl) * max(ndl + 0.06, 0.0) / 1.06;
    float water = clamp((d.b - max(d.r, d.g * 0.85)) * 28.0, 0.0, 1.0);
    vec3 col = d * 1.15 * lit * (1.0 - sh * 0.45);
    // ocean sun-glint (broad + sharp lobes)
    vec3 H = normalize(L + V); float nh = max(dot(N, H), 0.0);
    col += vec3(1.0, 0.86, 0.66) * (pow(nh, 300.0) * 2.4 + pow(nh, 30.0) * 0.08) * water * (1.0 - c) * smoothstep(0.0, 0.2, ndl);
    // clouds: bright on the day side, faint blue-grey into the terminator
    vec3 cl = mix(vec3(0.55, 0.62, 0.75), vec3(1.0, 0.98, 0.95), smoothstep(0.0, 0.4, ndl)) * lit * 1.05 * cShade;
    col = mix(col, cl, smoothstep(0.05, 0.9, c) * 0.82);
    // warm sunset tint right on the terminator (narrow, subtle)
    col *= mix(vec3(1.0), vec3(1.25, 0.82, 0.6), smoothstep(0.25, 0.0, ndl) * smoothstep(-0.12, 0.02, ndl));
    // city lights past the terminator
    float nightSide = smoothstep(0.02, -0.18, ndl);
    vec3 lights = mix(texture2D(night, vUv).rgb, max(texture2D(nightDetail, clamp(duv, 0.0, 1.0)).rgb - 0.012, 0.0) * 1.15, edge);
    col += lights * vec3(1.0, 0.7, 0.4) * 2.2 * nightSide * (1.0 - c * 0.85);
    // aerial perspective: thin blue haze thickening toward the limb (day side only)
    float mu = max(dot(N, V), 0.0);
    float haze = pow(1.0 - mu, 4.0);
    col = mix(col, vec3(0.3, 0.55, 1.0) * (0.15 + 0.85 * smoothstep(-0.1, 0.5, ndl)), haze * 0.75);
    gl_FragColor = vec4(col, 1.0);
  }`;

/** Atmosphere shell: density from the view ray's closest approach height; blue by day, a thin warm band at twilight. */
const atmoFrag = /* glsl */ `
  uniform vec3 sunDir, center; uniform float rIn, rOut;
  varying vec3 vW;
  void main(){
    vec3 D = normalize(vW - cameraPosition), oc = cameraPosition - center;
    float t = -dot(oc, D);
    vec3 cp = oc + D * max(t, 0.0);
    float h = (length(cp) - rIn) / (rOut - rIn);
    float dens = exp(-max(h, 0.0) * 5.5) * smoothstep(-0.05, 0.03, h) * (1.0 - smoothstep(0.85, 1.0, h));
    float s = dot(normalize(cp), normalize(sunDir));
    float day = smoothstep(-0.18, 0.25, s);
    vec3 blue = vec3(0.32, 0.6, 1.0) * 2.0;
    vec3 dusk = vec3(1.0, 0.55, 0.3) * 1.6;
    vec3 col = mix(dusk, blue, smoothstep(-0.02, 0.22, s)) * day;
    // forward scattering when looking toward the Sun
    col *= 1.0 + 2.5 * pow(max(dot(D, normalize(sunDir)), 0.0), 12.0);
    gl_FragColor = vec4(col * dens, 1.0);
  }`;

const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, time: { value: 0 }, sun: { value: new THREE.Vector2(0.8, 0.6) }, flare: { value: 0 }, aspect: { value: 16 / 9 }, fade: { value: 1 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time, flare, aspect, fade; uniform vec2 sun; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 q = vUv - 0.5;
      float ca = dot(q, q) * 0.006;
      vec3 c = vec3(texture2D(tDiffuse, vUv + q * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - q * ca).b);
      // restrained lens flare from the Sun: anamorphic streak + two faint ghosts
      if (flare > 0.001) {
        vec2 d = vUv - sun; d.x *= aspect;
        float streak = exp(-abs(d.y) * 220.0) * exp(-abs(d.x) * 2.2);
        vec3 f = vec3(0.55, 0.72, 1.0) * streak * 0.35;
        for (int i = 1; i <= 2; i++) {
          vec2 g = sun + (vec2(0.5) - sun) * (0.7 + float(i) * 0.55);
          vec2 gd = vUv - g; gd.x *= aspect;
          f += vec3(0.35, 0.5, 0.9) * smoothstep(0.05, 0.02, length(gd)) * 0.04 / float(i);
        }
        c += f * flare;
      }
      // filmic finish: cool shadows, gentle vignette, fine grain
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c * vec3(0.94, 0.98, 1.06), c, smoothstep(0.0, 0.5, l));
      c *= 1.0 - dot(q * vec2(1.0, 1.15), q * vec2(1.0, 1.15)) * 0.85;
      c += (hash(vUv * 1000.0 + fract(time) * 31.0) - 0.5) * 0.018;
      gl_FragColor = vec4(c * fade, 1.0);
    }`,
};

export class MenuStage implements Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.05, 4000);
  private composer: EffectComposer;
  private grade: ShaderPass;
  private earth: THREE.Mesh;
  private earthMat: THREE.ShaderMaterial;
  private station: THREE.Object3D | null = null;
  private stationT = 0; // seconds since the station arrived (drives its drift into frame)
  private baseQ = new THREE.Quaternion();
  private elapsed = 0;
  private fadeT = 0;
  private mouse = new THREE.Vector2();
  private mouseCur = new THREE.Vector2();
  private onMove = (e: PointerEvent) => this.mouse.set(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5);

  constructor(assets: Assets, renderer: THREE.WebGLRenderer) {
    const T = assets.textures;
    const stars = createStarSphere(T.stars!, 1500, 0.55);
    this.scene.add(stars);

    // ── Earth
    if (T.earthClouds) { T.earthClouds.wrapS = THREE.RepeatWrapping; T.earthClouds.needsUpdate = true; }
    for (const t of [T.earthHd, T.earthNight, T.earthClouds, T.earthDetail, T.earthNightDetail]) if (t) { t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.needsUpdate = true; }
    this.earthMat = new THREE.ShaderMaterial({
      uniforms: {
        day: { value: T.earthHd ?? T.earthDay ?? null }, night: { value: T.earthNight ?? null }, clouds: { value: T.earthClouds ?? null },
        detail: { value: T.earthDetail ?? T.earthHd ?? null }, nightDetail: { value: T.earthNightDetail ?? T.earthNight ?? null },
        bounds: { value: new THREE.Vector4(DETAIL.lon0, DETAIL.lon1, DETAIL.lat1, DETAIL.lat0) }, hasDetail: { value: T.earthDetail ? 1 : 0 },
        sunDir: { value: SUN_DIR.clone() }, sunLocal: { value: SUN_DIR.clone() }, cloudShift: { value: 0 },
      },
      vertexShader: earthVert, fragmentShader: earthFrag,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(R, 256, 128), this.earthMat);
    this.earth.position.copy(EARTH_C);
    this.baseQ = orientEarth(VIEW_LAT, VIEW_LON, new THREE.Vector3(0.6, 0.6, 7).sub(EARTH_C).normalize());
    this.earth.quaternion.copy(this.baseQ);
    this.scene.add(this.earth);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.022, 192, 96), new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: SUN_DIR.clone() }, center: { value: EARTH_C.clone() }, rIn: { value: R * 0.998 }, rOut: { value: R * 1.022 } },
      vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: atmoFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    }));
    atmo.position.copy(EARTH_C);
    this.scene.add(atmo);

    // ── Sun: small hot disc + soft glow (bloom does the rest)
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial([[0, 'rgba(255,255,255,1)'], [0.06, 'rgba(255,252,245,1)'], [0.16, 'rgba(255,236,210,0.35)'], [0.45, 'rgba(255,215,180,0.06)'], [1, 'rgba(255,200,160,0)']]), color: new THREE.Color(14, 13, 12), blending: THREE.AdditiveBlending, depthWrite: false }));
    sun.position.copy(SUN_DIR).multiplyScalar(1200);
    sun.scale.setScalar(260);
    this.scene.add(sun);

    // ── Lighting for the station: Sun key, blue Earthshine from below, faint cool rim; environment for metal reflections
    const key = new THREE.DirectionalLight(0xfff4e6, 3.4);
    key.position.copy(SUN_DIR).multiplyScalar(50);
    this.scene.add(key, new THREE.HemisphereLight(0x05070c, 0x3d6aa8, 0.9));
    const rim = new THREE.DirectionalLight(0x9cc4ff, 0.6);
    rim.position.set(-6, 3, -8);
    this.scene.add(rim);
    this.scene.environment = spaceEnvironment(renderer);

    // NASA's high-detail ISS (40 MB): streamed after the menu is up, shared with Mission 03 (one download)
    const hd = assets.models.issHd;
    if (hd) this.placeStation(hd.scene);
    else void assets.loadModel('issHd', '/models/iss_hd.glb').then((g) => this.placeStation(g.scene)).catch(() => {});

    // ── Post
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 0.9));
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    window.addEventListener('pointermove', this.onMove);
    this.update(0);
  }

  update(dt: number) {
    this.elapsed += dt;
    this.fadeT += dt;
    const t = this.elapsed;
    // slow dolly along a shallow arc + gentle parallax from the mouse
    this.mouseCur.lerp(this.mouse, 1 - Math.exp(-dt * 1.5));
    const m = this.mouseCur;
    this.camera.position.set(Math.sin(t * 0.045) * 0.5 - m.x * 0.5, 0.35 + Math.sin(t * 0.031) * 0.12 + m.y * 0.25, 6.5 - Math.sin(t * 0.02) * 0.4);
    this.camera.lookAt(0.9 - m.x * 0.2, -1.1 + m.y * 0.1, -6);
    // Earth turns, clouds drift a touch faster
    this.earth.quaternion.copy(this.baseQ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t * 0.003));
    this.earthMat.uniforms.cloudShift.value = t * 0.0012;
    this.earthMat.uniforms.sunLocal.value.copy(SUN_DIR).applyQuaternion(this.earth.quaternion.clone().invert());
    if (this.station) {
      // arrives from the right and slightly behind over ~6 s, then floats with a slow attitude drift
      this.stationT += dt;
      const k = 1 - Math.pow(1 - Math.min(1, this.stationT / 6), 3);
      this.station.position.set(ISS_HOME.x + (1 - k) * 4.5 + Math.sin(t * 0.11) * 0.06, ISS_HOME.y + (1 - k) * 0.6 + Math.sin(t * 0.17) * 0.04, ISS_HOME.z - (1 - k) * 3);
      this.station.rotation.set(STATION_ROT.x + Math.sin(t * 0.07) * 0.025, STATION_ROT.y + (1 - k) * 0.35 + Math.sin(t * 0.05) * 0.03, STATION_ROT.z);
    }
    // flare follows the Sun on screen (off when it slips behind the frame edge)
    const sp = SUN_DIR.clone().multiplyScalar(1200).project(this.camera);
    const g = this.grade.uniforms;
    g.time.value = t;
    g.sun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    g.flare.value = sp.z < 1 ? THREE.MathUtils.clamp(1.4 - Math.hypot(sp.x, sp.y), 0, 1) : 0;
    g.fade.value = Math.min(1, this.fadeT / 1.6); // fade up from black
  }

  /**
   * Put the NASA station in the shot. The menu gets its own copy: 839 meshes are baked into one mesh per material
   * (≈ 43 draw calls instead of 839) and the materials get physically sensible values (the export marks everything
   * fully metallic, which mirrors black space and reads dark). The mission keeps the original untouched.
   */
  private placeStation(src: THREE.Object3D) {
    if (this.station) return;
    const st = src.clone(true);
    st.position.set(0, 0, 0); st.rotation.set(0, 0, 0); st.scale.setScalar(1);
    st.traverse((o) => { if (o.name === 'SSRMS_Base') o.visible = true; });
    st.updateMatrixWorld(true);
    const shown = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    st.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material) || !shown(mesh)) return;
      const src = mesh.geometry, g = new THREE.BufferGeometry();
      const n = src.attributes.position.count;
      // de-quantise to float (meshopt packs positions/normals/uvs as normalised ints) and keep a common attribute set
      const f32 = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined, size: number) => {
        const out = new Float32Array(n * size);
        if (a) for (let i = 0; i < n; i++) { out[i * size] = a.getX(i); if (size > 1) out[i * size + 1] = a.getY(i); if (size > 2) out[i * size + 2] = a.getZ(i); }
        return new THREE.BufferAttribute(out, size);
      };
      g.setAttribute('position', f32(src.attributes.position, 3));
      g.setAttribute('normal', f32(src.attributes.normal, 3));
      g.setAttribute('uv', f32(src.attributes.uv, 2));
      g.setIndex(new THREE.BufferAttribute(src.index ? Uint32Array.from(src.index.array as ArrayLike<number>) : Uint32Array.from({ length: n }, (_, i) => i), 1));
      if (!src.attributes.normal) g.computeVertexNormals();
      g.applyMatrix4(mesh.matrixWorld);
      const list = byMat.get(mesh.material) ?? [];
      list.push(g);
      byMat.set(mesh.material, list);
    });
    const baked = new THREE.Group();
    for (const [mat, geos] of byMat) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      baked.add(new THREE.Mesh(merged, menuMaterial(mat as THREE.MeshStandardMaterial)));
    }
    const box = new THREE.Box3().setFromObject(baked);
    baked.position.sub(box.getCenter(new THREE.Vector3()));
    const pivot = new THREE.Group();
    pivot.add(baked);
    pivot.scale.setScalar(3.4 / box.getSize(new THREE.Vector3()).z); // truss span ≈ 3.4 units
    this.scene.add(pivot);
    this.station = pivot;
    this.stationT = 0;
  }

  render() { this.composer.render(); }
  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setPixelRatio(this.composer.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.grade.uniforms.aspect.value = w / h;
  }
  /** Restart the fade-in (when returning to the menu). */
  replay() { this.fadeT = 0; }
  dispose() { window.removeEventListener('pointermove', this.onMove); this.composer.dispose(); }
}

function radial(stops: [number, string][]) {
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

/** Realistic surface response for the menu copy of the station (materials are cloned; the mission's stay as they are). */
function menuMaterial(src: THREE.MeshStandardMaterial) {
  const m = src.clone();
  const n = src.name;
  if (/IROSA/i.test(n)) { m.metalness = 0.35; m.roughness = 0.32; m.color = new THREE.Color(0.95, 0.82, 0.62); }  // roll-out arrays: copper-amber cells
  else if (/Truss|ELC|Payload/i.test(n)) { m.metalness = 0.22; m.roughness = 0.5; }                                    // aluminium structure, satin
  else if (/MLI|Lettering/i.test(n)) { m.metalness = 0.0; m.roughness = 0.62; }                                          // thermal blankets, paint
  else { m.metalness = 0.12; m.roughness = 0.5; }                                                                       // painted / blanket-covered modules
  m.envMapIntensity = 1.25;
  m.transparent = false; m.opacity = 1; m.depthWrite = true;
  return m;
}

/** Station attitude in the menu shot: truss diagonal across the frame, arrays tilted to catch the Sun. */
const STATION_ROT = new THREE.Euler(0.42, -0.62, 0.12);

/** Tiny environment for reflections: black sky, blue Earth glow below, a bright Sun. */
function spaceEnvironment(renderer: THREE.WebGLRenderer) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x000000);
  const earth = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.18, 0.32, 0.6) }));
  earth.position.set(0, -14, -4);
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(30, 28, 26) }));
  sun.position.copy(SUN_DIR).multiplyScalar(20);
  s.add(earth, sun);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  return env;
}

/** Rotation that puts (lat, lon) facing `toward` with geographic north as close to screen-up as possible. */
function orientEarth(lat: number, lon: number, toward: THREE.Vector3) {
  const P = (la: number, lo: number) => {
    const phi = ((lo + 180) / 360) * Math.PI * 2, th = ((90 - la) / 180) * Math.PI;
    return new THREE.Vector3(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
  };
  const u = P(lat, lon);
  const q1 = new THREE.Quaternion().setFromUnitVectors(u, toward);
  const north = P(lat + 1, lon).sub(u).normalize().applyQuaternion(q1);
  const up = new THREE.Vector3(0, 1, 0);
  const want = up.sub(toward.clone().multiplyScalar(up.dot(toward))).normalize();
  const proj = north.sub(toward.clone().multiplyScalar(north.dot(toward))).normalize();
  const ang = Math.atan2(toward.dot(proj.clone().cross(want)), proj.dot(want));
  return new THREE.Quaternion().setFromAxisAngle(toward, ang).multiply(q1);
}
