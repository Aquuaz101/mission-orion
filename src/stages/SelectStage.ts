import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { Stage } from '../core/Engine';
import type { Assets } from '../core/Assets';
import { createStarSphere, glowTexture } from './sky';

/**
 * Mission-select "operations map": the inner solar system out to Jupiter.
 * Planet positions use today's mean heliocentric longitudes (JPL approximate
 * Keplerian elements, J2000). Orbit radii are compressed: not to scale.
 */
type Focus = 'overview' | 'jupiter' | 'mars' | 'earth';

const ORBITS = { earth: 7, mars: 10.5, jupiter: 17 };
const RADII = { earth: 0.5, mars: 0.36, jupiter: 1.3 };
// Mean longitude at J2000 (deg) and rate (deg / Julian century), from JPL "Keplerian Elements for Approximate Positions".
const ELEMENTS = { earth: [100.46457166, 35999.37244981], mars: [-4.55343205, 19140.30268499], jupiter: [34.39644051, 3034.74612775] };

export function meanLongitudeDeg(planet: keyof typeof ELEMENTS, date = new Date()) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const [L0, rate] = ELEMENTS[planet];
  return (((L0 + rate * T) % 360) + 360) % 360;
}

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, sat: { value: 0.35 }, fade: { value: 0 }, fadeColor: { value: new THREE.Color(0, 0, 0) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float sat; uniform float fade; uniform vec3 fadeColor; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l) * vec3(0.92, 0.96, 1.05), c, sat);
      vec2 d = vUv - 0.5; c *= 1.0 - dot(d, d) * 0.9;
      gl_FragColor = vec4(mix(c, fadeColor, fade), 1.0);
    }`,
};

export class SelectStage implements Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 3000);
  private composer: EffectComposer;
  private grade: ShaderPass;
  private planets: Record<'earth' | 'mars' | 'jupiter', THREE.Mesh>;
  private sky: THREE.Mesh;
  private mapMat: THREE.ShaderMaterial;
  private earthMat: THREE.ShaderMaterial;
  private beams: Partial<Record<'mars' | 'jupiter', THREE.Group>> = {};
  private ring: THREE.Mesh;
  private ringMat: THREE.ShaderMaterial;
  private corona: THREE.Sprite[] = [];
  private focus: Focus = 'overview';
  private camPos = new THREE.Vector3(-7, 24, 27);
  private lookPos = new THREE.Vector3(-7, 0, 1);
  private camTarget = new THREE.Vector3(-7, 24, 27);
  private lookTarget = new THREE.Vector3(-7, 0, 1);
  private satTarget = 0.55;
  private diving = false;
  private elapsed = 0;

  constructor(assets: Assets, renderer: THREE.WebGLRenderer) {
    const T = assets.textures;
    this.sky = createStarSphere(T.stars!, 1500, 0.9);
    this.scene.add(this.sky);

    // ── Sun: white-hot core, layered warm corona, slow-turning star streaks (bloom does the rest)
    const sun = new THREE.Group();
    sun.add(new THREE.Mesh(new THREE.SphereGeometry(0.8, 48, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(5, 4.2, 3) })));
    const layers: [number, [number, string][]][] = [
      [3.2, [[0, 'rgba(255,250,240,0.95)'], [0.25, 'rgba(255,220,170,0.45)'], [1, 'rgba(255,190,120,0)']]],
      [8, [[0, 'rgba(255,214,160,0.35)'], [0.35, 'rgba(255,170,100,0.08)'], [1, 'rgba(255,140,80,0)']]],
      [18, [[0, 'rgba(255,190,130,0.10)'], [1, 'rgba(255,150,90,0)']]],
    ];
    for (const [size, stops] of layers) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(256, stops), blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.scale.setScalar(size);
      sun.add(sp);
    }
    for (const rot of [0, 0.5]) {
      const st = new THREE.Sprite(new THREE.SpriteMaterial({ map: streakTexture(), blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5, rotation: rot }));
      st.scale.setScalar(11);
      sun.add(st);
      this.corona.push(st);
    }
    this.scene.add(sun);
    this.scene.add(new THREE.PointLight(0xfff1dd, 3.1, 0, 0));
    this.scene.add(new THREE.HemisphereLight(0x3a4c6e, 0x0a0d14, 0.35)); // faint fill so night sides are not pure black

    // ── "Map table": smooth anti-aliased orbit rings drawn per pixel, with a bright trail behind each planet
    this.mapMat = new THREE.ShaderMaterial({
      uniforms: { radii: { value: new THREE.Vector3(ORBITS.earth, ORBITS.mars, ORBITS.jupiter) }, ang: { value: new THREE.Vector3() }, hi: { value: new THREE.Vector3() }, time: { value: 0 }, pl: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] } },
      vertexShader: /* glsl */ `varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 radii, ang, hi; uniform float time; uniform vec3 pl[3]; varying vec2 vP;
        const float TAU = 6.2831853;
        vec3 orbit(float r, float a, float R, float pa, float h, float fw) {
          float d = abs(r - R);
          float core = 1.0 - smoothstep(fw * 0.6, fw * 1.6, d);
          float glow = exp(-d / (fw * 7.0 + 0.04));
          float behind = mod(pa - a + TAU, TAU);           // angle behind the planet (they move counter-clockwise)
          float trail = exp(-behind * 1.6);
          vec3 c = mix(vec3(0.45, 0.62, 0.85), vec3(0.55, 0.9, 1.0), h);
          return c * (core * (0.26 + trail * 1.1 + h * 0.3) + glow * (0.04 + trail * 0.25 + h * 0.1));
        }
        void main(){
          float r = length(vP), a = atan(-vP.y, vP.x);
          float fw = fwidth(r);
          vec3 col = orbit(r, a, radii.x, ang.x, hi.x, fw) + orbit(r, a, radii.y, ang.y, hi.y, fw) + orbit(r, a, radii.z, ang.z, hi.z, fw);
          // faint range rings + a soft sunlit disc on the table
          float rr = abs(fract(r / 3.0 + 0.5) - 0.5) * 3.0;
          col += vec3(0.3, 0.42, 0.6) * (1.0 - smoothstep(0.0, fw * 1.4, rr)) * 0.06 * smoothstep(24.0, 6.0, r);
          col += vec3(1.0, 0.75, 0.45) * exp(-r * 0.32) * 0.07;
          float alpha = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0) * smoothstep(26.0, 19.0, r);
          // the table passes through each planet's centre: keep the lines off the discs
          for (int i = 0; i < 3; i++) alpha *= smoothstep(pl[i].z * 1.02, pl[i].z * 1.25, distance(vP, pl[i].xy));
          gl_FragColor = vec4(col, alpha);
        }`,
      transparent: true, depthWrite: false,
    });
    const table = new THREE.Mesh(new THREE.PlaneGeometry(56, 56), this.mapMat);
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.002;
    this.scene.add(table);

    // ── Planets: Earth with day/night/city lights/clouds; Mars + Jupiter lit by the Sun; thin atmospheres
    if (T.earthClouds) { T.earthClouds.wrapS = THREE.RepeatWrapping; T.earthClouds.needsUpdate = true; } // clouds drift: wrap, never clamp-smear
    this.earthMat = earthMaterial(T.earthHd ?? T.earthDay ?? null, T.earthNight ?? null, T.earthClouds ?? null);
    const earth = new THREE.Mesh(new THREE.SphereGeometry(RADII.earth, 96, 48), this.earthMat);
    const mk = (tex: THREE.Texture | null | undefined, r: number, color: number) =>
      new THREE.Mesh(new THREE.SphereGeometry(r, 96, 48), new THREE.MeshStandardMaterial({ map: tex ?? null, color: tex ? 0xffffff : color, roughness: 0.95 }));
    this.planets = { earth, mars: mk(T.mars, RADII.mars, 0xb05a30), jupiter: mk(T.jupiter, RADII.jupiter, 0xc8a070) };
    this.planets.jupiter.scale.y = 0.935;
    const atmos: Record<string, [number, THREE.Color, number]> = { earth: [1.18, new THREE.Color(0.35, 0.62, 1.0), 1.3], mars: [1.1, new THREE.Color(1.0, 0.55, 0.3), 0.5], jupiter: [1.07, new THREE.Color(1.0, 0.85, 0.65), 0.35] };
    const angs: number[] = [];
    for (const k of Object.keys(this.planets) as (keyof typeof ORBITS)[]) {
      const lon = THREE.MathUtils.degToRad(meanLongitudeDeg(k));
      // ecliptic longitude measured counter-clockwise seen from ecliptic north (+y)
      this.planets[k].position.set(Math.cos(lon) * ORBITS[k], 0, -Math.sin(lon) * ORBITS[k]);
      angs.push(Math.atan2(Math.sin(lon), Math.cos(lon)));
      this.scene.add(this.planets[k]);
      const [sc, col, gain] = atmos[k];
      const shell = new THREE.Mesh(new THREE.SphereGeometry(RADII[k] * sc, 64, 32), atmosphereMaterial(col, gain, this.planets[k].position, RADII[k] * (k === 'jupiter' ? 0.93 : 0.995), RADII[k] * sc));
      shell.position.copy(this.planets[k].position);
      if (k === 'jupiter') shell.scale.y = 0.935;
      this.scene.add(shell);
    }
    this.mapMat.uniforms.ang.value.set(angs[0], angs[1], angs[2]);
    (['earth', 'mars', 'jupiter'] as const).forEach((k, i) => (this.mapMat.uniforms.pl.value as THREE.Vector3[])[i].set(this.planets[k].position.x, this.planets[k].position.z, RADII[k]));

    // ── Focus ring around the selected world (billboard, ticks slowly turning)
    this.ringMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, opacity: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float time, opacity; varying vec2 vUv;
        void main(){
          vec2 p = vUv * 2.0 - 1.0; float r = length(p), a = atan(p.y, p.x);
          float fw = fwidth(r);
          float ring = 1.0 - smoothstep(fw, fw * 2.5, abs(r - 0.86));
          float ticks = step(0.93, fract((a + time * 0.25) / 6.2831853 * 4.0 + 0.035)) * (1.0 - smoothstep(fw, fw * 2.5, abs(r - 0.94)));
          float arc = step(0.5, fract((a - time * 0.6) / 6.2831853)) * (1.0 - smoothstep(fw, fw * 3.0, abs(r - 0.98))) * 0.5;
          float v = max(max(ring * 0.55, ticks), arc);
          gl_FragColor = vec4(vec3(0.6, 0.9, 1.0) * 1.4, v * opacity);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.ringMat);
    this.scene.add(this.ring);

    // ── Uplink: curved data-link arcs from Earth to Mars and Jupiter (flowing pulses)
    for (const k of ['mars', 'jupiter'] as const) this.beams[k] = this.buildBeam(this.planets.earth.position, this.planets[k].position);

    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.55, 0.9));
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  private buildBeam(a: THREE.Vector3, b: THREE.Vector3) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += a.distanceTo(b) * 0.12;
    const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
    const g = new THREE.Group();
    for (const [radius, core] of [[0.014, 1], [0.045, 0]] as const) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, opacity: { value: 0 }, core: { value: core } },
        vertexShader: /* glsl */ `varying vec2 vUv; varying float vDist; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */ `
          uniform float time, opacity, core; varying vec2 vUv; varying float vDist;
          void main(){
            float near = smoothstep(1.5, 5.0, vDist);   // never smear across the lens
            float s = vUv.x;
            float pulse = pow(max(0.0, sin((s * 9.0 - time * 1.6) * 3.14159)), 18.0);
            float ends = smoothstep(0.0, 0.06, s) * smoothstep(1.0, 0.94, s);
            float edge = core > 0.5 ? 1.0 : pow(1.0 - abs(vUv.y - 0.5) * 2.0, 2.0) * 0.18;
            vec3 c = vec3(0.45, 0.85, 1.0) * (0.55 + pulse * 3.0);
            gl_FragColor = vec4(c, opacity * ends * edge * near * (core > 0.5 ? 0.85 : 1.0));
          }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 200, radius, 10, false), mat));
    }
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  /** Screen-space label positions for the HTML overlay. */
  labels(w: number, h: number) {
    const out: { key: string; x: number; y: number; visible: boolean }[] = [];
    if (this.focus !== 'overview') return out;
    for (const [key, m] of Object.entries(this.planets)) {
      const p = m.position.clone().add(new THREE.Vector3(0, (m.geometry as THREE.SphereGeometry).parameters.radius * 1.6, 0)).project(this.camera);
      out.push({ key, x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, visible: p.z < 1 });
    }
    return out;
  }

  setFocus(f: Focus) {
    this.focus = f;
    if (f === 'overview') {
      this.camTarget.set(-7, 24, 27);
      this.lookTarget.set(-7, 0, 1);
      this.satTarget = 0.55;
      return;
    }
    const m = this.planets[f];
    const r = (m.geometry as THREE.SphereGeometry).parameters.radius;
    const out = m.position.clone().setY(0).normalize();
    const side = new THREE.Vector3(-out.z, 0, out.x);
    const dist = r * (f === 'jupiter' ? 6.5 : 8.5);
    // camera on the sunward side (lit hemisphere visible), a little above; planet framed right of centre
    this.camTarget.copy(m.position).addScaledVector(out, -dist * 0.72).addScaledVector(side, dist * 0.62).add(new THREE.Vector3(0, r * 1.6, 0));
    const toCam = this.camTarget.clone().sub(m.position).setY(0).normalize();
    const right = new THREE.Vector3(toCam.z, 0, -toCam.x); // screen-right direction at the planet
    this.lookTarget.copy(m.position).addScaledVector(right, -dist * 0.36); // look left of the planet → it sits right of centre, clear of the details panel
    this.satTarget = 1;
  }

  /** Dive into the focused world before launching a mission. */
  dive(): Promise<void> {
    if (this.focus === 'overview') return Promise.resolve();
    this.diving = true;
    const m = this.planets[this.focus];
    this.lookTarget.copy(m.position);
    this.camTarget.copy(m.position).add(this.camPos.clone().sub(m.position).normalize().multiplyScalar((m.geometry as THREE.SphereGeometry).parameters.radius * 1.05));
    return new Promise((r) => setTimeout(r, 1300));
  }

  update(dt: number) {
    this.elapsed += dt;
    const k = 1 - Math.exp(-dt * (this.diving ? 2.6 : 2.2));
    this.camPos.lerp(this.camTarget, k);
    this.lookPos.lerp(this.lookTarget, k);
    const drift = this.focus === 'overview' ? new THREE.Vector3(Math.sin(this.elapsed * 0.1) * 0.6, 0, Math.cos(this.elapsed * 0.08) * 0.4) : new THREE.Vector3();
    this.camera.position.copy(this.camPos).add(drift);
    this.camera.lookAt(this.lookPos);
    this.sky.position.copy(this.camera.position);
    this.planets.jupiter.rotation.y += dt * 0.12;
    this.planets.earth.rotation.y += dt * 0.08;
    this.planets.mars.rotation.y += dt * 0.07;

    const g = this.grade.uniforms;
    g.sat.value += (this.satTarget - g.sat.value) * (1 - Math.exp(-dt * 3));
    g.fade.value += ((this.diving ? 1 : 0) - g.fade.value) * (1 - Math.exp(-dt * (this.diving ? 2.4 : 6)));

    // data-link arc to the focused world + focus ring
    const t = this.focus === 'jupiter' || this.focus === 'mars' ? this.focus : null;
    for (const k of ['mars', 'jupiter'] as const) {
      const g = this.beams[k]!;
      let op = 0;
      for (const m of g.children as THREE.Mesh[]) {
        const u = (m.material as THREE.ShaderMaterial).uniforms;
        u.time.value = this.elapsed;
        u.opacity.value += ((t === k ? 1 : 0) - u.opacity.value) * (1 - Math.exp(-dt * 4));
        op = u.opacity.value;
      }
      g.visible = op > 0.01;
    }
    const fp = this.focus !== 'overview' ? this.planets[this.focus] : null;
    const ru = this.ringMat.uniforms;
    ru.time.value = this.elapsed;
    ru.opacity.value += ((fp && !this.diving ? 1 : 0) - ru.opacity.value) * (1 - Math.exp(-dt * 5));
    if (fp) {
      const r = (fp.geometry as THREE.SphereGeometry).parameters.radius;
      this.ring.position.copy(fp.position);
      this.ring.scale.setScalar(r * 3.2);
      this.ring.quaternion.copy(this.camera.quaternion);
    }
    const hi = this.mapMat.uniforms.hi.value as THREE.Vector3;
    hi.lerp(new THREE.Vector3(this.focus === 'earth' ? 1 : 0, this.focus === 'mars' ? 1 : 0, this.focus === 'jupiter' ? 1 : 0), 1 - Math.exp(-dt * 4));
    this.mapMat.uniforms.time.value = this.elapsed;
    this.earthMat.uniforms.time.value = this.elapsed;
    this.corona.forEach((c, i) => ((c.material as THREE.SpriteMaterial).rotation = (i ? 0.5 : 0) + this.elapsed * (i ? -0.015 : 0.01)));
  }

  render() {
    this.composer.render();
  }
  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setPixelRatio(this.composer.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }
  dispose() {
    this.composer.dispose();
  }
  /** Reset after returning from a mission. With `from`, the camera starts at that planet and pulls out to the map. */
  reset(from?: string) {
    this.diving = false;
    this.grade.uniforms.fade.value = 1;
    const m = from === 'mars' || from === 'jupiter' || from === 'earth' ? this.planets[from] : null;
    if (m) {
      const r = (m.geometry as THREE.SphereGeometry).parameters.radius;
      const out = m.position.clone().setY(0).normalize();
      this.camPos.copy(m.position).addScaledVector(out, -r * 2.2).add(new THREE.Vector3(0, r * 0.8, 0));
      this.lookPos.copy(m.position);
    }
    this.setFocus('overview');
  }
}

/** Earth for the map: NASA day map, city lights on the night side, clouds, sunlit atmosphere rim. Sun at the origin. */
function earthMaterial(day: THREE.Texture | null, night: THREE.Texture | null, clouds: THREE.Texture | null) {
  return new THREE.ShaderMaterial({
    uniforms: { day: { value: day }, night: { value: night }, clouds: { value: clouds }, time: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D day, night, clouds; uniform float time; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 N = normalize(vN), L = normalize(-vW), V = normalize(cameraPosition - vW);
        float ndl = dot(N, L);
        vec3 d = texture2D(day, vUv).rgb;
        float c = texture2D(clouds, vUv + vec2(time * 0.0015, 0.0)).r;
        vec3 lit = mix(d * 1.25, vec3(1.0), c * 0.85) * max(ndl, 0.0) * 1.35;
        float nightSide = smoothstep(0.12, -0.2, ndl);
        vec3 city = texture2D(night, vUv).rgb * vec3(1.0, 0.72, 0.42) * 2.6 * nightSide * (1.0 - c * 0.8);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 rim = vec3(0.3, 0.6, 1.0) * fres * (0.15 + 1.1 * smoothstep(-0.3, 0.5, ndl));
        vec3 amb = d * 0.035 + vec3(0.01, 0.015, 0.03);
        gl_FragColor = vec4(lit + city + rim + amb, 1.0);
      }`,
  });
}

/** Back-face glow shell: a thin atmosphere halo, brighter on the sunlit limb. */
function atmosphereMaterial(color: THREE.Color, gain: number, center: THREE.Vector3, radius: number, outer: number) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: color }, gain: { value: gain }, center: { value: center.clone() }, radius: { value: radius }, outer: { value: outer } },
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vW;
      void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color, center; uniform float gain, radius, outer; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 D = normalize(vW - cameraPosition);
        vec3 oc = cameraPosition - center;
        float t = -dot(oc, D);
        vec3 cp = oc + D * t;                       // closest point of the view ray to the planet centre
        float h = (length(cp) - radius) / (outer - radius);
        if (h < 0.0) discard;                        // the planet itself is in front: no halo over the disc
        float glow = exp(-h * 5.0) * (1.0 - smoothstep(0.75, 1.0, h));
        float sun = 0.2 + 0.8 * smoothstep(-0.35, 0.5, dot(normalize(cp), normalize(-center)));
        gl_FragColor = vec4(color * glow * sun * gain, 1.0);
      }`,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/** Soft 6-point star-streak sprite for the Sun. */
function streakTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.translate(256, 256);
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    const grd = g.createLinearGradient(0, 0, 250, 0);
    grd.addColorStop(0, 'rgba(255,235,205,0.9)');
    grd.addColorStop(1, 'rgba(255,200,150,0)');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(0, -3); g.lineTo(250, 0); g.lineTo(0, 3); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
