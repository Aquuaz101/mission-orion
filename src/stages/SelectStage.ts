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
  private beam: THREE.Mesh;
  private beamMat: THREE.ShaderMaterial;
  private focus: Focus = 'overview';
  private camPos = new THREE.Vector3(0, 24, 27);
  private lookPos = new THREE.Vector3(0, 0, 1);
  private camTarget = new THREE.Vector3(0, 24, 27);
  private lookTarget = new THREE.Vector3(0, 0, 1);
  private satTarget = 0.35;
  private diving = false;
  private elapsed = 0;

  constructor(assets: Assets, renderer: THREE.WebGLRenderer) {
    this.sky = createStarSphere(assets.textures.stars!, 1500, 0.9);
    this.scene.add(this.sky);

    // Sun
    const sun = new THREE.Group();
    sun.add(new THREE.Mesh(new THREE.SphereGeometry(0.9, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(4, 3.4, 2.4) })));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(256, [[0, 'rgba(255,240,215,0.9)'], [0.2, 'rgba(255,200,140,0.25)'], [1, 'rgba(255,180,120,0)']]), blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(9);
    sun.add(glow);
    this.scene.add(sun);
    this.scene.add(new THREE.PointLight(0xfff1dd, 2.4, 0, 0));
    this.scene.add(new THREE.AmbientLight(0x6a7a96, 0.18));

    // Orbits (dashed, map-like)
    for (const r of Object.values(ORBITS)) {
      const pts = Array.from({ length: 257 }, (_, i) => { const a = (i / 256) * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r); });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x9fb2cc, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.35 }));
      line.computeLineDistances();
      this.scene.add(line);
    }
    // Faint grid plane: the "map table"
    const grid = new THREE.PolarGridHelper(22, 16, 8, 128, 0x23324a, 0x162236);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    this.scene.add(grid);

    const mk = (tex: THREE.Texture | null | undefined, r: number, color: number) =>
      new THREE.Mesh(new THREE.SphereGeometry(r, 64, 32), new THREE.MeshStandardMaterial({ map: tex ?? null, color: tex ? 0xffffff : color, roughness: 1 }));
    this.planets = {
      earth: mk(assets.textures.earthDay, RADII.earth, 0x3366aa),
      mars: mk(assets.textures.mars, RADII.mars, 0xb05a30),
      jupiter: mk(assets.textures.jupiter, RADII.jupiter, 0xc8a070),
    };
    this.planets.jupiter.scale.y = 0.935;
    for (const k of Object.keys(this.planets) as (keyof typeof ORBITS)[]) {
      const lon = THREE.MathUtils.degToRad(meanLongitudeDeg(k));
      // ecliptic longitude measured counter-clockwise seen from ecliptic north (+y)
      this.planets[k].position.set(Math.cos(lon) * ORBITS[k], 0, -Math.sin(lon) * ORBITS[k]);
      this.scene.add(this.planets[k]);
    }

    // Uplink beam from Earth to the selected world.
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, opacity: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float time; uniform float opacity; varying vec2 vUv;
        void main(){ float pulse = smoothstep(0.0, 0.06, fract(vUv.y - time * 0.5)) * (1.0 - smoothstep(0.06, 0.2, fract(vUv.y - time * 0.5)));
          gl_FragColor = vec4(vec3(0.55, 0.85, 1.0) * (0.5 + pulse * 2.0), opacity * (0.35 + pulse)); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8, 1, true), this.beamMat);
    this.scene.add(this.beam);

    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.6, 0.85));
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
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
      this.camTarget.set(0, 24, 27);
      this.lookTarget.set(0, 0, 1);
      this.satTarget = 0.35;
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
    const right = new THREE.Vector3(toCam.z, 0, -toCam.x); // screen-left direction at the planet
    this.lookTarget.copy(m.position).addScaledVector(right, r * 1.25);
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

    // beam from Earth to the focused planet
    const target = this.focus === 'jupiter' || this.focus === 'mars' ? this.planets[this.focus].position : null;
    this.beamMat.uniforms.time.value = this.elapsed;
    this.beamMat.uniforms.opacity.value += ((target ? 1 : 0) - this.beamMat.uniforms.opacity.value) * (1 - Math.exp(-dt * 4));
    if (target) {
      const a = this.planets.earth.position, d = target.clone().sub(a);
      this.beam.position.copy(a).addScaledVector(d, 0.5);
      this.beam.scale.set(1, d.length(), 1);
      this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    }
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
  /** Reset after returning from a mission. */
  reset() {
    this.diving = false;
    this.grade.uniforms.fade.value = 1;
    this.setFocus('overview');
  }
}
