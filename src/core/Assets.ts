import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/**
 * Loads every asset up front with *real* progress (weighted by file size, with
 * byte-level progress where the browser reports it). Optional assets that fail
 * resolve to null so the game keeps going with a fallback.
 */
export interface AssetJob {
  key: string;
  url: string;
  kind: 'texture' | 'gltf' | 'binary' | 'json';
  label: string;     // shown on the loading screen while this file loads
  kb: number;        // approximate size, used to weight progress
  required?: boolean;
  srgb?: boolean;
}

export const ASSET_JOBS: AssetJob[] = [
  { key: 'stars', url: '/textures/stars.jpg', kind: 'texture', kb: 1700, label: 'Star catalogue · NASA Tycho star map', required: true, srgb: true },
  { key: 'earthDay', url: '/textures/earth_day.jpg', kind: 'texture', kb: 230, label: 'Earth imagery · NASA Blue Marble', srgb: true },
  { key: 'earthNight', url: '/textures/earth_night.jpg', kind: 'texture', kb: 440, label: 'Earth at night · NASA Black Marble', srgb: true },
  { key: 'jupiter', url: '/textures/jupiter.jpg', kind: 'texture', kb: 735, label: 'Jupiter global map · NASA/JPL Cassini', srgb: true },
  { key: 'io', url: '/textures/io.jpg', kind: 'texture', kb: 205, label: 'Io surface map · NASA/USGS', srgb: true },
  { key: 'europa', url: '/textures/europa.jpg', kind: 'texture', kb: 226, label: 'Europa surface map · NASA/USGS', srgb: true },
  { key: 'ganymede', url: '/textures/ganymede.jpg', kind: 'texture', kb: 305, label: 'Ganymede surface map · NASA/USGS', srgb: true },
  { key: 'callisto', url: '/textures/callisto.jpg', kind: 'texture', kb: 373, label: 'Callisto surface map · NASA/USGS', srgb: true },
  { key: 'mars', url: '/textures/mars.jpg', kind: 'texture', kb: 294, label: 'Mars global map · NASA/USGS', srgb: true },
  { key: 'jezeroHeight', url: '/data/jezero_height.bin', kind: 'binary', kb: 1150, label: 'Jezero crater terrain · HiRISE elevation model' },
  { key: 'jezeroMeta', url: '/data/jezero.json', kind: 'json', kb: 1, label: 'Jezero crater terrain · metadata' },
  { key: 'jezeroOrtho', url: '/data/jezero_ortho.jpg', kind: 'texture', kb: 345, label: 'Jezero crater imagery · MRO HiRISE', srgb: true },
  { key: 'soilDiff', url: '/textures/pbr/soil_diff.jpg', kind: 'texture', kb: 690, label: 'Surface detail · soil (Poly Haven CC0)', srgb: true },
  { key: 'soilNor', url: '/textures/pbr/soil_nor.jpg', kind: 'texture', kb: 1888, label: 'Surface detail · soil normals' },
  { key: 'soilArm', url: '/textures/pbr/soil_arm.jpg', kind: 'texture', kb: 217, label: 'Surface detail · soil roughness' },
  { key: 'rockDiff', url: '/textures/pbr/rock_diff.jpg', kind: 'texture', kb: 300, label: 'Surface detail · rock (Poly Haven CC0)', srgb: true },
  { key: 'rockNor', url: '/textures/pbr/rock_nor.jpg', kind: 'texture', kb: 202, label: 'Surface detail · rock normals' },
  { key: 'rockArm', url: '/textures/pbr/rock_arm.jpg', kind: 'texture', kb: 21, label: 'Surface detail · rock roughness' },
  { key: 'rover', url: '/models/perseverance.glb', kind: 'gltf', kb: 4870, label: 'Rover model · NASA/JPL-Caltech Perseverance' },
  { key: 'hubble', url: '/models/hubble.glb', kind: 'gltf', kb: 1655, label: 'Hubble Space Telescope model · NASA' },
];

export type ProgressFn = (fraction: number, label: string) => void;

export class Assets {
  readonly textures: Record<string, THREE.Texture | null> = {};
  readonly models: Record<string, GLTF | null> = {};
  readonly binaries: Record<string, ArrayBuffer | null> = {};
  readonly json: Record<string, unknown> = {};
  readonly failed: string[] = [];

  async loadAll(jobs: AssetJob[], onProgress: ProgressFn) {
    const total = jobs.reduce((s, j) => s + j.kb, 0);
    const partial = new Map<string, number>(); // key -> fraction of this file loaded
    let currentLabel = jobs[0]?.label ?? '';

    const report = () => {
      let done = 0;
      for (const j of jobs) done += (partial.get(j.key) ?? 0) * j.kb;
      onProgress(Math.min(1, done / total), currentLabel);
    };

    // NASA's models are Draco-compressed; the decoder ships in /public/draco (offline-safe).
    const draco = new DRACOLoader().setDecoderPath('/draco/');
    const gltfLoader = new GLTFLoader().setDRACOLoader(draco);
    const texLoader = new THREE.TextureLoader();

    // A few parallel downloads; the label tracks the most recently started file.
    const queue = [...jobs];
    const worker = async () => {
      while (queue.length) {
        const job = queue.shift()!;
        currentLabel = job.label;
        partial.set(job.key, 0);
        report();
        try {
          await this.loadOne(job, gltfLoader, texLoader, (f) => {
            partial.set(job.key, f);
            report();
          });
        } catch (err) {
          console.warn(`[assets] failed: ${job.url}`, err);
          this.failed.push(job.key);
          if (job.required) throw new Error(`Required asset failed to load: ${job.label}`);
        }
        partial.set(job.key, 1);
        report();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  private async loadOne(job: AssetJob, gltf: GLTFLoader, tex: THREE.TextureLoader, progress: (f: number) => void) {
    switch (job.kind) {
      case 'texture': {
        const t = await tex.loadAsync(job.url);
        if (job.srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        this.textures[job.key] = t;
        return;
      }
      case 'gltf': {
        this.models[job.key] = await gltf.loadAsync(job.url, (e) => {
          if (e.lengthComputable && e.total) progress(e.loaded / e.total);
        });
        return;
      }
      case 'binary': {
        const res = await fetch(job.url);
        if (!res.ok) throw new Error(`${res.status}`);
        this.binaries[job.key] = await res.arrayBuffer();
        return;
      }
      case 'json': {
        const res = await fetch(job.url);
        if (!res.ok) throw new Error(`${res.status}`);
        this.json[job.key] = await res.json();
        return;
      }
    }
  }
}
