import * as THREE from 'three';

/** A self-contained 3D scene (space backdrop, telescope view, Mars...). */
export interface Stage {
  update(dt: number, time: number): void;
  render(renderer: THREE.WebGLRenderer): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private stage: Stage | null = null;
  private last = performance.now();
  private elapsed = 0;
  private readonly tickers = new Set<(dt: number, t: number) => void>();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    window.addEventListener('resize', () => this.onResize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  get current() {
    return this.stage;
  }

  setStage(stage: Stage | null) {
    if (this.stage && this.stage !== stage) this.stage.dispose();
    this.stage = stage;
    if (stage) stage.resize(window.innerWidth, window.innerHeight);
  }

  /** Per-frame callbacks outside the stage (UI, input polling...). Returns an unsubscribe fn. */
  onTick(fn: (dt: number, t: number) => void) {
    this.tickers.add(fn);
    return () => this.tickers.delete(fn);
  }

  private onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.stage?.resize(w, h);
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1); // clamp after tab switches
    this.last = now;
    this.elapsed += dt;
    for (const fn of this.tickers) fn(dt, this.elapsed);
    if (this.stage) {
      this.stage.update(dt, this.elapsed);
      this.stage.render(this.renderer);
    }
  }
}
