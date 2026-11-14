/** Shaders for the spacewalk: Earth from 420 km, atmosphere, sun shafts + flare, helmet visor. */
import * as THREE from 'three';

export const R_EARTH = 6371;
export const ALT = 420;
/** High-resolution real satellite patch under the flight path: NOAA-20 VIIRS true colour, 21 Aug 2024 (NASA GIBS),
 *  ≈ 0.5 km per pixel, lon -100..-60, lat 12..38. Real clouds are baked in, so the shader splits them back out. */
const DETAIL = { lon0: -100, lon1: -60, lat1: 12, lat0: 38 };

export const earthMaterial = (day: THREE.Texture | null, detail: THREE.Texture | null, night: THREE.Texture | null, cloudTex: THREE.Texture | null, nightDetail: THREE.Texture | null = null) =>
  new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: day }, detailMap: { value: detail }, nightMap: { value: night }, cloudMap: { value: cloudTex }, nightDetail: { value: nightDetail ?? night },
      bounds: { value: new THREE.Vector4(DETAIL.lon0, DETAIL.lon1, DETAIL.lat1, DETAIL.lat0) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunLocal: { value: new THREE.Vector3(0, 1, 0) }, camPos: { value: new THREE.Vector3() }, sunColor: { value: new THREE.Color(1, 1, 1) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vL;
      void main(){ vUv = uv; vL = normalize(position); vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D dayMap, detailMap, nightMap, cloudMap, nightDetail; uniform vec4 bounds; uniform vec3 sunDir, sunLocal, camPos, sunColor;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vL;
      vec2 dUv(float lon, float lat){ return vec2((lon - bounds.x) / (bounds.y - bounds.x), (lat - bounds.z) / (bounds.w - bounds.z)); }
      // clouds in the satellite image: bright and colourless (min channel), soft edges kept
      float cloudOf(vec3 c){ return smoothstep(0.2, 0.6, min(c.r, min(c.g, c.b))); }
      vec2 uvOf(vec3 n){ float phi = atan(n.z, -n.x); if (phi < 0.0) phi += 6.2831853; return vec2(phi / 6.2831853, 1.0 - acos(clamp(n.y, -1.0, 1.0)) / 3.1415927); }
      void main(){
        float lon = vUv.x * 360.0 - 180.0, lat = vUv.y * 180.0 - 90.0;
        vec3 day = texture2D(dayMap, vUv).rgb;
        vec2 duv = dUv(lon, lat);
        float edge = smoothstep(0.0, 0.04, duv.x) * smoothstep(1.0, 0.96, duv.x) * smoothstep(0.0, 0.05, duv.y) * smoothstep(1.0, 0.95, duv.y);
        vec3 img = texture2D(detailMap, clamp(duv, 0.0, 1.0)).rgb;
        float cImg = cloudOf(img);
        float cLum = dot(img, vec3(0.3, 0.5, 0.2));
        day = mix(day, img, edge);
        vec3 N = normalize(vN), L = normalize(sunDir), V = normalize(camPos - vW);
        float ndl = dot(N, L);
        // surface light: soft terminator, coloured by the (low, reddened) Sun
        float lit = smoothstep(-0.05, 0.28, ndl) * max(ndl + 0.04, 0.0) / 1.04;
        vec3 sunC = sunColor * mix(vec3(1.0, 0.62, 0.38), vec3(1.0), smoothstep(0.0, 0.35, ndl));
        float water = clamp((day.b - max(day.r, day.g * 0.85)) * 30.0, 0.0, 1.0) * (1.0 - smoothstep(0.08, 0.2, day.g));
        // ocean: a touch of depth blue so it is not flat black-blue
        day = mix(day, day * vec3(0.85, 1.0, 1.25) + vec3(0.0, 0.006, 0.02), water * 0.6);
        float c = mix(texture2D(cloudMap, vUv).r, cImg, edge);
        vec2 suv = uvOf(normalize(vL + normalize(sunLocal) * 0.0035));
        float shImg = cloudOf(texture2D(detailMap, clamp(dUv(suv.x * 360.0 - 180.0, suv.y * 180.0 - 90.0), 0.0, 1.0)).rgb);
        float sh = mix(texture2D(cloudMap, suv).r, shImg, edge);
        vec3 col = day * 1.38 * lit * sunC * (1.0 - sh * 0.55 * smoothstep(0.0, 0.2, ndl));
        // sun glint on open water, tinted by the Sun
        vec3 H = normalize(L + V);
        float nh = max(dot(N, H), 0.0);
        col += sunC * (pow(nh, 320.0) * 4.5 + pow(nh, 45.0) * 0.16) * water * (1.0 - c) * smoothstep(0.0, 0.12, ndl);
        // clouds sit ~10 km up: their tops catch the dawn before the ground does (pink-orange), bases are greyer
        float cl = smoothstep(-0.11, 0.25, ndl) * max(ndl + 0.11, 0.0) / 1.11;
        vec3 dawn = mix(vec3(1.0, 0.5, 0.35), vec3(1.0, 0.97, 0.94), smoothstep(-0.02, 0.3, ndl));
        float thick = smoothstep(0.35, 1.0, c);
        float shade = mix(1.0, clamp(cLum * 1.2, 0.55, 1.15), edge); // real cloud tops: bright domes, grey shadowed flanks
        vec3 cloudCol = dawn * sunColor * (0.02 + 1.18 * cl) * mix(0.82, 1.06, thick) * shade;
        col = mix(col, cloudCol, smoothstep(0.04, 0.9, c) * 0.94);
        // twilight band on the ground just past the terminator
        col += vec3(0.5, 0.18, 0.06) * smoothstep(-0.1, 0.0, ndl) * smoothstep(0.08, 0.0, ndl) * 0.08 * (1.0 - c);
        // night: city lights + faint airglow on the ocean
        float night = smoothstep(0.04, -0.14, ndl);
        // city lights: NASA Black Marble (≈ 1 km) under the flight path, the global map elsewhere; the faint land glow is cut
        vec3 lights = mix(texture2D(nightMap, vUv).rgb, max(texture2D(nightDetail, clamp(duv, 0.0, 1.0)).rgb - 0.012, 0.0) * 1.15, edge);
        col += lights * vec3(1.0, 0.72, 0.42) * night * (1.0 - c * 0.85) * 1.9;
        col += vec3(0.004, 0.008, 0.018) * night;
        // aerial perspective: blue haze thickening toward the limb (by day), dusky at the terminator
        float mu = max(dot(N, V), 0.0);
        float haze = pow(1.0 - mu, 4.2);
        vec3 sky = mix(vec3(0.5, 0.3, 0.24), vec3(0.22, 0.45, 1.0), smoothstep(-0.04, 0.1, ndl)) * (0.03 + 0.95 * smoothstep(-0.12, 0.4, ndl));
        col = mix(col, sky, clamp(haze * 0.82 + 0.025, 0.0, 0.9) * smoothstep(-0.25, 0.1, ndl) + haze * 0.1);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

/** Thin atmosphere shell: glow from the closest-approach height; blue by day, red-orange band at the terminator,
 *  strong forward scattering toward the Sun so the sunrise burns along the limb. */
export const atmosphereMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: new THREE.Vector3(0, 1, 0) }, camPos: { value: new THREE.Vector3() }, center: { value: new THREE.Vector3() } },
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
        float lit = smoothstep(-0.3, 0.15, s);
        vec3 blue = vec3(0.25, 0.55, 1.0) * 2.4;
        vec3 dusk = vec3(1.0, 0.42, 0.14) * 2.6;
        vec3 col = mix(dusk, blue, smoothstep(-0.02, 0.28, s)) * lit;
        float vs = max(dot(V, sunDir), 0.0);
        float fwd = pow(vs, 18.0) * 9.0 + pow(vs, 4.0) * 1.6;            // tight corona + wide Mie halo
        vec3 halo = mix(vec3(1.0, 0.38, 0.12), vec3(1.0, 0.72, 0.42), smoothstep(-0.1, 0.25, s));
        col += halo * fwd * smoothstep(-0.38, 0.0, s);
        col += vec3(0.05, 0.25, 0.12) * 0.25 * (1.0 - lit);
        gl_FragColor = vec4(col * dens, dens);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
  });

/** Sun shafts (radial blur of the occlusion buffer) + lens flare whose strength follows the Sun's visibility. */
export const RaysShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tOcc: { value: null as THREE.Texture | null },
    sun: { value: new THREE.Vector2(0.5, 0.5) },
    rays: { value: 0 },
    flare: { value: 0 },
    tint: { value: new THREE.Color(1, 0.9, 0.75) },
    aspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tOcc; uniform vec2 sun; uniform float rays, flare, aspect; uniform vec3 tint; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (rays > 0.001) {
        vec2 delta = (vUv - sun) * (1.0 / 64.0) * 0.92;
        vec2 p = vUv; float decay = 1.0, acc = 0.0;
        for (int i = 0; i < 64; i++) { p -= delta; acc += texture2D(tOcc, p).r * decay; decay *= 0.965; }
        c += tint * acc * (rays / 64.0) * 2.6;
      }
      if (flare > 0.001) {
        // how much of the Sun's disc is actually visible past the station
        float vis = (texture2D(tOcc, sun).r * 2.0 + texture2D(tOcc, sun + vec2(0.004, 0.0)).r + texture2D(tOcc, sun - vec2(0.004, 0.0)).r + texture2D(tOcc, sun + vec2(0.0, 0.006)).r + texture2D(tOcc, sun - vec2(0.0, 0.006)).r) / 6.0;
        float s = flare * vis;
        vec2 d = vUv - sun; d.x *= aspect;
        float r = length(d), a = atan(d.y, d.x);
        float burst = pow(abs(sin(a * 4.0 + 0.4)), 40.0) * exp(-r * 5.0) * 0.45 + pow(abs(sin(a * 7.0)), 70.0) * exp(-r * 9.0) * 0.3;
        float glow = exp(-r * 16.0) * 1.1 + exp(-r * 4.0) * 0.1;
        float streak = exp(-abs(d.y) * 190.0) * exp(-abs(d.x) * 1.6) * 0.45;
        vec3 col = tint * (burst + glow) + vec3(0.55, 0.72, 1.0) * streak;
        vec2 axis = vec2(0.5) - sun;
        for (int i = 0; i < 5; i++) {
          vec2 g = sun + axis * (0.9 + float(i) * 0.76);
          vec2 gd = vUv - g; gd.x *= aspect;
          float sz = 0.018 + 0.012 * float(i);
          float ring = smoothstep(sz, sz * 0.7, length(gd)) * (0.55 + 0.45 * smoothstep(sz * 0.4, sz, length(gd)));
          col += mix(vec3(0.25, 0.5, 1.0), vec3(1.0, 0.6, 0.3), float(i) / 4.0) * ring * 0.06;
        }
        c += col * s;
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/** Helmet visor: curvature, fringing, breath fog, reflections, helmet rim, sun-lit smudges, alert tint. */
export const VisorShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDirt: { value: null as THREE.Texture | null },
    res: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 }, fog: { value: 0.2 }, alert: { value: 0 }, flash: { value: 0 }, dark: { value: 0 },
    sun: { value: new THREE.Vector2(0.5, 0.5) }, sunGlare: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tDirt; uniform vec2 res, sun; uniform float time, fog, alert, flash, dark, sunGlare; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv, q = uv - 0.5;
      float asp = res.x / res.y;
      vec2 qa = vec2(q.x * asp, q.y);
      vec2 duv = 0.5 + q * (1.0 - 0.06 * dot(qa, qa));
      float r = length(qa * vec2(0.62, 1.0));
      float ca = smoothstep(0.25, 0.75, r) * 0.006;
      vec3 c = vec3(texture2D(tDiffuse, duv + q * ca).r, texture2D(tDiffuse, duv).g, texture2D(tDiffuse, duv - q * ca).b);
      float fm = fog * smoothstep(0.42, 0.0, length((uv - vec2(0.5, -0.04)) * vec2(1.1, 1.9)));
      vec3 b = vec3(0.0);
      for (int i = 0; i < 6; i++) { float a = float(i) * 1.047; b += texture2D(tDiffuse, duv + vec2(cos(a), sin(a)) * 0.012).rgb; }
      c = mix(c, b / 6.0 * 0.8 + vec3(0.16, 0.17, 0.18), clamp(fm, 0.0, 0.75));
      // smudges and scratches on the visor light up when the Sun is near the line of sight
      vec2 sd = uv - sun; sd.x *= asp;
      float near = exp(-length(sd) * 2.2) * sunGlare;
      c += vec3(1.0, 0.92, 0.8) * texture2D(tDirt, uv).r * near * 0.55;
      float arc = 0.86 - 0.32 * pow(uv.x - 0.42, 2.0);
      c += vec3(0.7, 0.78, 0.9) * smoothstep(0.006, 0.0, abs(uv.y - arc)) * smoothstep(0.08, 0.35, uv.x) * smoothstep(0.92, 0.62, uv.x) * 0.05;
      c += vec3(0.6, 0.7, 0.85) * smoothstep(0.7, 0.0, length((uv - vec2(0.12, 0.92)) * vec2(1.3, 2.0))) * 0.03;
      float rim = smoothstep(0.52, 0.8, r) + smoothstep(0.9, 1.0, uv.y) * 0.85;
      c = mix(c, vec3(0.004, 0.006, 0.01), clamp(rim, 0.0, 1.0));
      c += vec3(0.6, 0.04, 0.0) * alert * smoothstep(0.38, 0.75, r) * (0.55 + 0.45 * sin(time * 6.0));
      c += vec3(0.85, 0.9, 1.0) * flash;
      c *= 1.0 - dark;
      c += (hash(uv * res + fract(time) * 91.0) - 0.5) * 0.02;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/** Procedural visor dirt: fingerprint-like smears, specks and a few fine scratches (greyscale). */
export function visorDirt() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 288;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 288);
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 26; i++) {
    const x = r() * 512, y = r() * 288, rad = 12 + r() * 46;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(255,255,255,${0.08 + r() * 0.12})`); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    g.strokeStyle = `rgba(255,255,255,${0.05 + r() * 0.06})`; g.lineWidth = 1;
    for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(x, y, rad * (0.2 + k * 0.12), r() * 6, r() * 6 + 2.5); g.stroke(); }
  }
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.35})`; g.fillRect(r() * 512, r() * 288, 1 + r() * 1.5, 1 + r() * 1.5); }
  for (let i = 0; i < 6; i++) { g.strokeStyle = `rgba(255,255,255,${0.1 + r() * 0.12})`; g.lineWidth = 0.6; g.beginPath(); const x = r() * 512, y = r() * 288; g.moveTo(x, y); g.quadraticCurveTo(x + (r() - 0.5) * 120, y + (r() - 0.5) * 60, x + (r() - 0.5) * 220, y + (r() - 0.5) * 80); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function glowTex(stops: [number, string][]) {
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
