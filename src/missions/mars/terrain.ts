import * as THREE from 'three';
import type { Assets } from '../../core/Assets';

/**
 * Jezero crater delta front from the USGS/HiRISE DTM at ~1 m/px (scripts/extract-jezero.mjs).
 * World units are metres; +x = east, -z = north (image row 0). Relief is exaggerated ×EXAG so the
 * delta channels read as valleys on screen. Disclosed as "simplified" in the sources panel.
 *
 * The ground is split into TILES×TILES meshes so the renderer frustum-culls what is off screen.
 */
export const EXAG = 2.2;
const TILES = 6;

interface JezeroMeta { resolution: number; sizeMeters: number; minElevation: number; maxElevation: number }

export class Terrain {
  readonly size: number;
  readonly n: number;
  readonly heights: Float32Array; // metres above the lowest point (exaggerated)
  readonly slopes: Float32Array;  // degrees, per grid sample
  readonly minElevation: number;
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  private reliefReal: number;
  private lum: Float32Array | null = null;
  private lumSize = 0;

  constructor(assets: Assets, detail: { color: THREE.Texture; normal: THREE.Texture }) {
    const meta = assets.json.jezeroMeta as JezeroMeta;
    const raw = new Uint16Array(assets.binaries.jezeroHeight!);
    this.n = meta.resolution;
    this.size = meta.sizeMeters;
    this.minElevation = meta.minElevation;
    this.reliefReal = meta.maxElevation - meta.minElevation;
    this.heights = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) this.heights[i] = (raw[i] / 65535) * this.reliefReal * EXAG;
    this.slopes = this.computeSlopes();

    const albedo = this.buildAlbedo(assets.textures.jezeroOrtho ?? null);
    // Close-range surface: photographed red gravelly soil (Poly Haven, CC0), tiled every ~3.5 m,
    // modulated by the real HiRISE-derived macro albedo. Falls back to procedural detail.
    const soil = assets.textures.soilDiff ?? null, soilN = assets.textures.soilNor ?? null, soilR = assets.textures.soilArm ?? null;
    const tile = this.size / 3.5;
    for (const t of [soil, soilN, soilR, detail.normal]) if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(tile, tile); t.anisotropy = 8; t.needsUpdate = true; }
    this.material = new THREE.MeshStandardMaterial({
      map: albedo,
      roughness: 1,
      roughnessMap: soilR,
      metalness: 0,
      normalMap: soilN ?? detail.normal,
      normalScale: new THREE.Vector2(1.35, 1.35),
    });
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.soilMap = { value: soil ?? detail.color };
      sh.uniforms.hasSoil = { value: soil ? 1 : 0 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; uniform sampler2D soilMap; uniform float hasSoil;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          if (hasSoil > 0.5) {
            // two scales + rotation to hide tiling; macro albedo (HiRISE) supplies large-scale variation
            vec3 s1 = texture2D(soilMap, vWPos.xz / 3.5).rgb;
            vec3 s2 = texture2D(soilMap, mat2(0.8, -0.6, 0.6, 0.8) * vWPos.xz / 13.0).rgb;
            float far = smoothstep(25.0, 140.0, length(vWPos - cameraPosition));
            vec3 soilC = mix(mix(s1, s2, 0.35), s2, far);
            diffuseColor.rgb = soilC * diffuseColor.rgb * 3.1;
          } else {
            float d1 = texture2D(soilMap, vWPos.xz / 4.0).r;
            diffuseColor.rgb *= mix(0.8, 1.18, d1);
          }`);
    };

    // Tiles: shared material, ~2 m vertex spacing, each its own bounding sphere for culling.
    const seg = Math.round((this.n - 1) / 2 / TILES);
    const tileSize = this.size / TILES;
    for (let ty = 0; ty < TILES; ty++) for (let tx = 0; tx < TILES; tx++) {
      const geo = new THREE.PlaneGeometry(tileSize, tileSize, seg, seg);
      geo.rotateX(-Math.PI / 2);
      const cx = -this.size / 2 + (tx + 0.5) * tileSize, cz = -this.size / 2 + (ty + 0.5) * tileSize;
      geo.translate(cx, 0, cz);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        pos.setY(i, this.heightAt(x, z));
        uv.setXY(i, x / this.size + 0.5, 1 - (z / this.size + 0.5)); // global UVs so the albedo spans all tiles
      }
      geo.computeVertexNormals();
      this.fixSeamNormals(geo);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** Normals from the heightfield itself so neighbouring tiles shade seamlessly. */
  private fixSeamNormals(geo: THREE.BufferGeometry) {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nor = geo.attributes.normal as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      this.normalAt(pos.getX(i), pos.getZ(i), v, 2);
      nor.setXYZ(i, v.x, v.y, v.z);
    }
  }

  private computeSlopes() {
    const n = this.n, h = this.heights, cell = this.size / (n - 1);
    const s = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const xl = Math.max(0, x - 1), xr = Math.min(n - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(n - 1, y + 1);
      const dx = (h[y * n + xr] - h[y * n + xl]) / ((xr - xl) * cell);
      const dz = (h[yd * n + x] - h[yu * n + x]) / ((yd - yu) * cell);
      s[y * n + x] = THREE.MathUtils.radToDeg(Math.atan(Math.hypot(dx, dz)));
    }
    return s;
  }

  /** Bilinear height (m) at world x,z. */
  heightAt(x: number, z: number) {
    const n = this.n;
    const fx = THREE.MathUtils.clamp((x / this.size + 0.5) * (n - 1), 0, n - 1.001);
    const fz = THREE.MathUtils.clamp((z / this.size + 0.5) * (n - 1), 0, n - 1.001);
    const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
    const h = this.heights;
    const a = h[z0 * n + x0], b = h[z0 * n + x0 + 1], c = h[(z0 + 1) * n + x0], d = h[(z0 + 1) * n + x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  normalAt(x: number, z: number, out = new THREE.Vector3(), e = 1.2) {
    return out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }

  /** Slope in degrees (nearest grid sample). */
  slopeAt(x: number, z: number) {
    const n = this.n;
    const px = Math.round(THREE.MathUtils.clamp((x / this.size + 0.5) * (n - 1), 0, n - 1));
    const pz = Math.round(THREE.MathUtils.clamp((z / this.size + 0.5) * (n - 1), 0, n - 1));
    return this.slopes[pz * n + px];
  }

  realElevationAt(x: number, z: number) {
    return this.minElevation + this.heightAt(x, z) / EXAG;
  }

  /** Grid pixel (0..n-1) → world position on the surface. */
  pixelToWorld(px: number, pz: number) {
    const x = (px / (this.n - 1) - 0.5) * this.size;
    const z = (pz / (this.n - 1) - 0.5) * this.size;
    return new THREE.Vector3(x, this.heightAt(x, z), z);
  }

  /** HiRISE brightness at x,z (0..1): bright = exposed light-toned rock, dark = basaltic sand. */
  rockiness(x: number, z: number) {
    if (!this.lum) return 0.5;
    const S = this.lumSize;
    const px = Math.round(THREE.MathUtils.clamp((x / this.size + 0.5) * (S - 1), 0, S - 1));
    const pz = Math.round(THREE.MathUtils.clamp((z / this.size + 0.5) * (S - 1), 0, S - 1));
    return this.lum[pz * S + px];
  }

  /** Colour texture from the real HiRISE image + slope. */
  private buildAlbedo(ortho: THREE.Texture | null) {
    const S = 2048;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    let gray: Uint8ClampedArray | null = null;
    if (ortho?.image) {
      g.drawImage(ortho.image as CanvasImageSource, 0, 0, S, S);
      gray = g.getImageData(0, 0, S, S).data;
    }
    const img = g.createImageData(S, S);
    const LS = 512; // low-res luminance copy for rock placement
    this.lum = new Float32Array(LS * LS);
    this.lumSize = LS;
    // Macro tint (multiplied with the soil photo): dark basaltic sand → lighter, slightly paler bedrock.
    const sand = [0.3, 0.27, 0.26], rock = [0.46, 0.4, 0.36], dark = [0.2, 0.19, 0.19], steepC = [0.4, 0.33, 0.29];
    const toS = (v: number) => Math.round(Math.pow(Math.min(1, v), 1 / 2.2) * 255);
    const n = this.n;
    for (let y = 0; y < S; y++) {
      const gz = Math.round((y / (S - 1)) * (n - 1));
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const l = gray ? gray[i * 4] / 255 : 0.5;
        if ((x & 3) === 0 && (y & 3) === 0) this.lum[(y >> 2) * LS + (x >> 2)] = l;
        const gx = Math.round((x / (S - 1)) * (n - 1));
        const steep = THREE.MathUtils.smoothstep(this.slopes[gz * n + gx], 14, 34);
        const t = THREE.MathUtils.smoothstep(l, 0.38, 0.82), t2 = THREE.MathUtils.smoothstep(l, 0.0, 0.38);
        for (let c = 0; c < 3; c++) {
          let v = THREE.MathUtils.lerp(dark[c], sand[c], t2);
          v = THREE.MathUtils.lerp(v, rock[c], t);
          v = THREE.MathUtils.lerp(v, steepC[c], steep * 0.55); // exposed layered rock on steep faces
          img.data[i * 4 + c] = toS(v);
        }
        img.data[i * 4 + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }
}

/** Tileable procedural detail: R/G = two noise octaves (colour), plus a matching normal map. */
export function makeDetailTextures() {
  const S = 256;
  const noise = (period: number, seed: number) => {
    const grid = new Float32Array(period * period);
    let s = seed;
    for (let i = 0; i < grid.length; i++) { s = (s * 16807) % 2147483647; grid[i] = s / 2147483647; }
    return (x: number, y: number) => {
      const gx = (x / S) * period, gy = (y / S) * period;
      const x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => grid[((j + period) % period) * period + ((i + period) % period)];
      return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(x0, y0), at(x0 + 1, y0), sx), THREE.MathUtils.lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), sx), sy);
    };
  };
  const n1 = noise(8, 7), n2 = noise(16, 13), n3 = noise(32, 29), n4 = noise(64, 101);
  const hgt = new Float32Array(S * S);
  const col = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const h = n2(x, y) * 0.4 + n3(x, y) * 0.3 + n4(x, y) * 0.3;
    hgt[y * S + x] = h;
    const i = (y * S + x) * 4;
    col[i] = Math.round((n3(x, y) * 0.5 + n4(x, y) * 0.5) * 255);
    col[i + 1] = Math.round((n1(x, y) * 0.6 + n2(x, y) * 0.4) * 255);
    col[i + 2] = 128;
    col[i + 3] = 255;
  }
  const nrm = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const hx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x - 1 + S) % S)];
    const hy = hgt[((y + 1) % S) * S + x] - hgt[((y - 1 + S) % S) * S + x];
    const v = new THREE.Vector3(-hx * 7, -hy * 7, 1).normalize();
    const i = (y * S + x) * 4;
    nrm[i] = (v.x * 0.5 + 0.5) * 255; nrm[i + 1] = (v.y * 0.5 + 0.5) * 255; nrm[i + 2] = (v.z * 0.5 + 0.5) * 255; nrm[i + 3] = 255;
  }
  const mk = (data: Uint8Array) => {
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
  return { color: mk(col), normal: mk(nrm) };
}
