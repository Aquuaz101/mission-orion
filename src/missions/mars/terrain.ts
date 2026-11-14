import * as THREE from 'three';
import type { Assets } from '../../core/Assets';

/**
 * Jezero crater delta front from the USGS/HiRISE DTM (see scripts/extract-jezero.mjs).
 * World units are metres; +x = east, -z = north (image row 0). Relief is exaggerated
 * ×EXAG for readability on screen. Disclosed as "simplified" in the sources panel.
 */
export const EXAG = 1.5;

interface JezeroMeta { resolution: number; sizeMeters: number; minElevation: number; maxElevation: number }

export class Terrain {
  readonly size: number;
  readonly n: number;
  readonly heights: Float32Array; // metres above the lowest point (exaggerated)
  readonly minElevation: number;
  readonly mesh: THREE.Mesh;
  private reliefReal: number;

  constructor(assets: Assets, detail: { color: THREE.Texture; normal: THREE.Texture }) {
    const meta = assets.json.jezeroMeta as JezeroMeta;
    const raw = new Uint16Array(assets.binaries.jezeroHeight!);
    this.n = meta.resolution;
    this.size = meta.sizeMeters;
    this.minElevation = meta.minElevation;
    this.reliefReal = meta.maxElevation - meta.minElevation;
    this.heights = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) this.heights[i] = (raw[i] / 65535) * this.reliefReal * EXAG;

    const SEG = 383; // ≈ 4 m between vertices
    const geo = new THREE.PlaneGeometry(this.size, this.size, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();

    const albedo = this.buildAlbedo(assets.textures.jezeroOrtho ?? null);
    const mat = new THREE.MeshStandardMaterial({ map: albedo, roughness: 0.96, metalness: 0, normalMap: detail.normal, normalScale: new THREE.Vector2(0.9, 0.9) });
    detail.normal.repeat.set(this.size / 7, this.size / 7);
    // Two octaves of tiled detail colour on top of the 1.5 m/texel HiRISE-derived albedo.
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: detail.color };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; uniform sampler2D detailMap;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float d1 = texture2D(detailMap, vWPos.xz / 5.0).r;
          float d2 = texture2D(detailMap, vWPos.xz / 41.0).g;
          diffuseColor.rgb *= mix(0.78, 1.2, d1) * mix(0.86, 1.12, d2);`);
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
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

  normalAt(x: number, z: number, out = new THREE.Vector3()) {
    const e = 1.5;
    return out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }

  /** Slope in degrees. */
  slopeAt(x: number, z: number) {
    return THREE.MathUtils.radToDeg(Math.acos(this.normalAt(x, z).y));
  }

  /** Real elevation (m, Mars datum) at x,z, i.e. undoing the exaggeration. */
  realElevationAt(x: number, z: number) {
    return this.minElevation + this.heightAt(x, z) / EXAG;
  }

  /** Grid pixel (0..n-1) → world position on the surface. */
  pixelToWorld(px: number, pz: number) {
    const x = (px / (this.n - 1) - 0.5) * this.size;
    const z = (pz / (this.n - 1) - 0.5) * this.size;
    return new THREE.Vector3(x, this.heightAt(x, z), z);
  }

  /** Brightness (0..1) of the HiRISE image at x,z: bright = exposed rock, dark = sand. */
  rockiness = (_x: number, _z: number) => 0.5;

  /** Colour texture from the real HiRISE image: dark ripples → basaltic sand, bright → light-toned delta rock. */
  private buildAlbedo(ortho: THREE.Texture | null) {
    const S = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const g = canvas.getContext('2d')!;
    let gray: Uint8ClampedArray | null = null;
    if (ortho?.image) {
      g.drawImage(ortho.image as CanvasImageSource, 0, 0, S, S);
      gray = g.getImageData(0, 0, S, S).data.slice();
    }
    const img = g.createImageData(S, S);
    const sand = [0.36, 0.2, 0.12], rock = [0.74, 0.5, 0.34], dark = [0.24, 0.13, 0.08];
    const lum = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const l = gray ? gray[i * 4] / 255 : 0.5;
        lum[i] = l;
        const wx = (x / (S - 1) - 0.5) * this.size, wz = (y / (S - 1) - 0.5) * this.size;
        const steep = THREE.MathUtils.smoothstep(this.slopeAt(wx, wz), 8, 30);
        const t = THREE.MathUtils.smoothstep(l, 0.35, 0.8);
        const t2 = THREE.MathUtils.smoothstep(l, 0.0, 0.35);
        for (let c = 0; c < 3; c++) {
          let v = THREE.MathUtils.lerp(dark[c], sand[c], t2);
          v = THREE.MathUtils.lerp(v, rock[c], Math.min(1, t + steep * 0.35));
          img.data[i * 4 + c] = Math.round(Math.pow(v, 1 / 2.2) * 255); // write sRGB
        }
        img.data[i * 4 + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.rockiness = (x: number, z: number) => {
      const px = Math.round((x / this.size + 0.5) * (S - 1)), pz = Math.round((z / this.size + 0.5) * (S - 1));
      return lum[THREE.MathUtils.clamp(pz, 0, S - 1) * S + THREE.MathUtils.clamp(px, 0, S - 1)];
    };
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
    const h = n2(x, y) * 0.45 + n3(x, y) * 0.3 + n4(x, y) * 0.25;
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
    const v = new THREE.Vector3(-hx * 6, -hy * 6, 1).normalize();
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
