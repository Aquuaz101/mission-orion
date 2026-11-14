import * as THREE from 'three';

/** A self-contained 3D scene (space backdrop, telescope view, Mars...). */
export interface Stage {
  update(dt: number, time: number): void;
  render(renderer: THREE.WebGLRenderer): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/**
 * Renderer + main loop + dynamic resolution scaling (DRS).
 * DRS works like modern console shooters: when the frame rate drops below the
 * target, the internal render resolution is lowered in small steps (HUD stays
 * sharp); when there is headroom it climbs back to full resolution.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private stage: Stage | null = null;
  private last = performance.now();
  private elapsed = 0;
  private readonly tickers = new Set<(dt: number, t: number) => void>();

  /** Device-pixel ratio chosen by the quality preset. */
  basePixelRatio = Math.min(window.devicePixelRatio, 2);
  /** Dynamic resolution scale (multiplies basePixelRatio). */
  resScale = 1;
  drsEnabled = true;
  targetFps = 58;
  private minScale = 0.55;
  private frames = 0;
  private frameAccum = 0;
  private goodSeconds = 0;
  fps = 60;
  frameMs = 16.7;
  private stats: HTMLElement | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in three r18x
    this.renderer.info.autoReset = false; // count draw calls across all post passes of a frame

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); this.toggleStats(); } });
    this.renderer.setAnimationLoop(() => this.frame());
  }

  get current() {
    return this.stage;
  }

  /** Switch the rendered stage. The caller owns the old stage (dispose it if no longer needed). */
  setStage(stage: Stage | null) {
    this.stage = stage;
    this.resScale = 1;
    this.applyPixelRatio();
  }

  /** Per-frame callbacks outside the stage (UI, input polling...). Returns an unsubscribe fn. */
  onTick(fn: (dt: number, t: number) => void) {
    this.tickers.add(fn);
    return () => this.tickers.delete(fn);
  }

  setBasePixelRatio(pr: number) {
    this.basePixelRatio = pr;
    this.applyPixelRatio();
  }

  /**
   * Request a canvas resize. Resizing a WebGL canvas clears its drawing buffer, so doing it
   * after a frame was rendered (e.g. from DRS at the end of frame(), or from a UI handler)
   * makes the browser present a black frame. The resize is therefore deferred to the start
   * of the next frame, immediately before that frame renders.
   */
  applyPixelRatio() {
    this.resizePending = true;
  }
  private resizePending = false;

  private doResize() {
    this.resizePending = false;
    const pr = Math.max(0.5, this.basePixelRatio * this.resScale);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.stage?.resize(window.innerWidth, window.innerHeight);
  }

  toggleStats(force?: boolean) {
    const on = force ?? !this.stats;
    if (!on && this.stats) { this.stats.remove(); this.stats = null; }
    if (on && !this.stats) {
      this.stats = document.createElement('div');
      this.stats.className = 'perf-stats mono';
      document.body.appendChild(this.stats);
    }
  }

  private onResize() {
    this.applyPixelRatio();
  }

  private frame() {
    const now = performance.now();
    const raw = (now - this.last) / 1000;
    const dt = Math.min(raw, 0.1); // clamp after tab switches
    this.last = now;
    this.elapsed += dt;
    for (const fn of this.tickers) fn(dt, this.elapsed);
    if (this.resizePending) this.doResize(); // after tickers (they may switch stage), right before render
    if (this.stage) {
      this.renderer.info.reset();
      this.stage.update(dt, this.elapsed);
      this.stage.render(this.renderer);
    }
    this.measure(raw);
  }

  private measure(raw: number) {
    if (raw > 0.5) return; // tab was hidden
    this.frames++;
    this.frameAccum += raw;
    if (this.frameAccum < 1) return;
    this.fps = this.frames / this.frameAccum;
    this.frameMs = (this.frameAccum / this.frames) * 1000;
    this.frames = 0;
    this.frameAccum = 0;

    if (this.drsEnabled && this.stage) {
      if (this.fps < this.targetFps - 6 && this.resScale > this.minScale) {
        this.resScale = Math.max(this.minScale, +(this.resScale - (this.fps < this.targetFps - 20 ? 0.15 : 0.08)).toFixed(2));
        this.goodSeconds = 0;
        this.applyPixelRatio();
      } else if (this.fps > this.targetFps && this.resScale < 1) {
        if (++this.goodSeconds >= 3) {
          this.resScale = Math.min(1, +(this.resScale + 0.08).toFixed(2));
          this.goodSeconds = 0;
          this.applyPixelRatio();
        }
      } else this.goodSeconds = 0;
    }

    if (this.stats) {
      const info = this.renderer.info.render;
      this.stats.innerHTML = `${this.fps.toFixed(0)} FPS · ${this.frameMs.toFixed(1)} ms<br>res ${(this.resScale * 100).toFixed(0)}% · ${this.renderer.getPixelRatio().toFixed(2)}x<br>draws ${info.calls} · tris ${(info.triangles / 1000).toFixed(0)}k`;
    }
  }
}
