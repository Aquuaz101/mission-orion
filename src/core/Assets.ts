import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

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
  { key: 'stars', url: import.meta.env.BASE_URL + 'textures/stars.jpg', kind: 'texture', kb: 1700, label: 'Star catalogue · NASA Tycho star map', required: true, srgb: true },
  { key: 'earthDay', url: import.meta.env.BASE_URL + 'textures/earth_day.jpg', kind: 'texture', kb: 230, label: 'Earth imagery · NASA Blue Marble', srgb: true },
  { key: 'earthNight', url: import.meta.env.BASE_URL + 'textures/earth_night.jpg', kind: 'texture', kb: 440, label: 'Earth at night · NASA Black Marble', srgb: true },
  { key: 'jupiter', url: import.meta.env.BASE_URL + 'textures/jupiter.jpg', kind: 'texture', kb: 735, label: 'Jupiter global map · NASA/JPL Cassini', srgb: true },
  { key: 'io', url: import.meta.env.BASE_URL + 'textures/io.jpg', kind: 'texture', kb: 205, label: 'Io surface map · NASA/USGS', srgb: true },
  { key: 'europa', url: import.meta.env.BASE_URL + 'textures/europa.jpg', kind: 'texture', kb: 226, label: 'Europa surface map · NASA/USGS', srgb: true },
  { key: 'ganymede', url: import.meta.env.BASE_URL + 'textures/ganymede.jpg', kind: 'texture', kb: 305, label: 'Ganymede surface map · NASA/USGS', srgb: true },
  { key: 'callisto', url: import.meta.env.BASE_URL + 'textures/callisto.jpg', kind: 'texture', kb: 373, label: 'Callisto surface map · NASA/USGS', srgb: true },
  { key: 'mars', url: import.meta.env.BASE_URL + 'textures/mars.jpg', kind: 'texture', kb: 294, label: 'Mars global map · NASA/USGS', srgb: true },
  { key: 'jezeroHeight', url: import.meta.env.BASE_URL + 'data/jezero_height.bin', kind: 'binary', kb: 1150, label: 'Jezero crater terrain · HiRISE elevation model' },
  { key: 'jezeroMeta', url: import.meta.env.BASE_URL + 'data/jezero.json', kind: 'json', kb: 1, label: 'Jezero crater terrain · metadata' },
  { key: 'jezeroOrtho', url: import.meta.env.BASE_URL + 'data/jezero_ortho.jpg', kind: 'texture', kb: 345, label: 'Jezero crater imagery · MRO HiRISE', srgb: true },
  { key: 'soilDiff', url: import.meta.env.BASE_URL + 'textures/pbr/soil_diff.jpg', kind: 'texture', kb: 690, label: 'Surface detail · soil (Poly Haven CC0)', srgb: true },
  { key: 'soilNor', url: import.meta.env.BASE_URL + 'textures/pbr/soil_nor.jpg', kind: 'texture', kb: 1888, label: 'Surface detail · soil normals' },
  { key: 'soilArm', url: import.meta.env.BASE_URL + 'textures/pbr/soil_arm.jpg', kind: 'texture', kb: 217, label: 'Surface detail · soil roughness' },
  { key: 'rockDiff', url: import.meta.env.BASE_URL + 'textures/pbr/rock_diff.jpg', kind: 'texture', kb: 300, label: 'Surface detail · rock (Poly Haven CC0)', srgb: true },
  { key: 'rockNor', url: import.meta.env.BASE_URL + 'textures/pbr/rock_nor.jpg', kind: 'texture', kb: 202, label: 'Surface detail · rock normals' },
  { key: 'rockArm', url: import.meta.env.BASE_URL + 'textures/pbr/rock_arm.jpg', kind: 'texture', kb: 21, label: 'Surface detail · rock roughness' },
  { key: 'rover', url: import.meta.env.BASE_URL + 'models/perseverance.glb', kind: 'gltf', kb: 4870, label: 'Rover model · NASA/JPL-Caltech Perseverance' },
  { key: 'hubble', url: import.meta.env.BASE_URL + 'models/hubble.glb', kind: 'gltf', kb: 1655, label: 'Hubble Space Telescope model · NASA' },
  { key: 'earthHd', url: import.meta.env.BASE_URL + 'textures/earth_hd.jpg', kind: 'texture', kb: 1160, label: 'Earth from orbit · NASA Blue Marble Next Generation', srgb: true },
  { key: 'earthDetail', url: import.meta.env.BASE_URL + 'textures/earth_detail.jpg', kind: 'texture', kb: 6400, label: 'Gulf of Mexico at 500 m/px · NASA VIIRS (NOAA-20)', srgb: true },
  { key: 'earthNightDetail', url: import.meta.env.BASE_URL + 'textures/earth_night_detail.jpg', kind: 'texture', kb: 710, label: 'City lights at 1 km/px · NASA Black Marble', srgb: true },
  { key: 'earthClouds', url: import.meta.env.BASE_URL + 'textures/earth_clouds.jpg', kind: 'texture', kb: 580, label: 'Cloud cover (baked)' },
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

    const gltfLoader = this.gltfLoader();
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

  private loader: GLTFLoader | null = null;
  private gltfLoader() {
    // Draco (NASA rover/Hubble) + meshopt (packed ISS) decoders, both bundled for offline use.
    return (this.loader ??= new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath(import.meta.env.BASE_URL + 'draco/')).setMeshoptDecoder(MeshoptDecoder));
  }

  /** Load a large model on demand (not at boot). Cached. */
  async loadModel(key: string, url: string, onProgress?: (f: number) => void) {
    if (this.models[key]) return this.models[key];
    // one download per model even when several callers ask at once (prefetch + briefing + mission); everyone sees progress
    if (onProgress) (this.progressFns[key] ??= new Set()).add(onProgress);
    const p = (this.pendingModels[key] ??= this.gltfLoader()
      .loadAsync(url, (e) => { if (e.lengthComputable && e.total) { this.modelFrac[key] = e.loaded / e.total; this.progressFns[key]?.forEach((f) => f(e.loaded / e.total)); } })
      .then((g) => (this.models[key] = g))
      .finally(() => { delete this.pendingModels[key]; delete this.progressFns[key]; }));
    return p;
  }
  /** Fraction of a model download done so far (1 when cached), or null if it has not started. */
  modelProgress(key: string) { return this.models[key] ? 1 : this.pendingModels[key] ? this.modelFrac[key] ?? 0 : null; }
  private pendingModels: Partial<Record<string, Promise<GLTF>>> = {};
  private progressFns: Record<string, Set<(f: number) => void>> = {};
  private modelFrac: Record<string, number> = {};

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
