/**
 * Game audio engine (Web Audio, fully offline).
 *
 * Mix: every sound goes to one of four buses (sfx, ambience, music, voice) → master → (muffle filter) → out.
 * Music and ambience sit behind a ducking gain that dips whenever ACE speaks.
 * A shared convolution reverb gives cutscene stingers and music some space.
 *
 * Sounds: if a recorded/generated file exists in /audio/sfx (listed in its manifest.json, produced by
 * `npm run gen:audio` with ElevenLabs), it is used; otherwise every sound falls back to a synthesised
 * version, so the game always has full audio even with no files at all.
 */
export type MusicState = 'none' | 'menu' | 'jupiter' | 'mars' | 'tension' | 'rescue' | 'triumph';
type Bus = 'sfx' | 'amb' | 'music' | 'voice';
export interface Mix { master: number; music: number; sfx: number; voice: number }

const MIX_KEY = 'orion.mix';
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Sfx {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private muffle!: BiquadFilterNode;
  private bus = {} as Record<Bus, GainNode>;
  private duckGain!: GainNode;
  private reverb!: ConvolverNode;
  private reverbIn!: GainNode;
  private noise!: AudioBuffer;
  private ambience: { stop: () => void; set?: (v: number) => void } | null = null;
  private samples = new Map<string, AudioBuffer>();
  private sampleNames = new Set<string>();
  private mix: Mix = { master: 0.8, music: 0.55, sfx: 0.85, voice: 1 };
  private music: MusicDirector | null = null;
  private loops = new Map<string, { set: (a: number, b?: number) => void; stop: () => void }>();
  private duckers = 0;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(MIX_KEY) ?? 'null');
      if (saved) Object.assign(this.mix, saved);
      else if (localStorage.getItem('orion.volume')) this.mix.master = Number(localStorage.getItem('orion.volume'));
    } catch { /* defaults */ }
  }

  get context() { return this.ctx; }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new AudioContext());
    // master chain: buses → master gain → muffle (storm / impacts) → compressor → speakers
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.out = ctx.createGain();
    this.out.gain.value = this.mix.master;
    this.out.connect(this.muffle).connect(comp).connect(ctx.destination);

    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.out);
    for (const b of ['sfx', 'amb', 'music', 'voice'] as Bus[]) {
      const g = ctx.createGain();
      g.connect(b === 'music' || b === 'amb' ? this.duckGain : this.out);
      this.bus[b] = g;
    }
    this.applyMix();

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Generated hall impulse (2.8 s exponential decay, stereo decorrelated).
    this.reverb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 2.8), ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3.2);
    }
    this.reverb.buffer = ir;
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 0.35;
    this.reverbIn.connect(this.reverb).connect(this.out);

    void this.loadSamples();
  }

  // ───────────────────────────────────────────── mix
  get level() { return this.mix.master; }
  get mixLevels(): Mix { return { ...this.mix }; }
  setVolume(v: number) { this.setMix({ master: v }); }
  setMix(p: Partial<Mix>) {
    Object.assign(this.mix, p);
    localStorage.setItem(MIX_KEY, JSON.stringify(this.mix));
    this.applyMix();
  }
  private applyMix() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(this.mix.master, t, 0.05);
    this.bus.music.gain.setTargetAtTime(this.mix.music, t, 0.05);
    this.bus.sfx.gain.setTargetAtTime(this.mix.sfx, t, 0.05);
    this.bus.amb.gain.setTargetAtTime(this.mix.sfx * 0.9, t, 0.05);
    this.bus.voice.gain.setTargetAtTime(this.mix.voice, t, 0.05);
  }
  /** Dip music + ambience under dialogue (reference counted). */
  duck(on: boolean) {
    this.duckers = Math.max(0, this.duckers + (on ? 1 : -1));
    if (!this.ctx) return;
    this.duckGain.gain.setTargetAtTime(this.duckers ? 0.38 : 1, this.ctx.currentTime, on ? 0.08 : 0.5);
  }
  /** 0 = clear, 1 = heavily muffled (inside the dust storm, after an impact). */
  setMuffle(v: number) {
    if (!this.ctx) return;
    const f = 20000 * Math.pow(900 / 20000, Math.min(1, Math.max(0, v)));
    this.muffle.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.25);
  }

  // ───────────────────────────────────────────── generated samples (optional)
  private async loadSamples() {
    try {
      const res = await fetch('/audio/sfx/manifest.json');
      if (!res.ok) return;
      const list = (await res.json()) as { files?: Record<string, string> };
      const files = list.files ?? {};
      await Promise.all(Object.entries(files).map(async ([name, file]) => {
        try {
          const buf = await (await fetch(`/audio/sfx/${file}`)).arrayBuffer();
          this.samples.set(name, await this.ctx!.decodeAudioData(buf));
          this.sampleNames.add(name);
        } catch { /* keep synth fallback */ }
      }));
    } catch { /* no generated audio: synth only */ }
  }
  has(name: string) { return this.samples.has(name); }

  /** Play a generated sample if present. Returns false when the synth fallback should play. */
  play(name: string, opts: { gain?: number; rate?: number; bus?: Bus; verb?: number; delay?: number } = {}) {
    const ctx = this.ctx, buf = this.samples.get(name);
    if (!ctx || !buf) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = opts.gain ?? 1;
    src.connect(g).connect(this.bus[opts.bus ?? 'sfx']);
    if (opts.verb) { const s = ctx.createGain(); s.gain.value = opts.verb; g.connect(s).connect(this.reverbIn); }
    src.start(ctx.currentTime + (opts.delay ?? 0));
    return true;
  }

  // ───────────────────────────────────────────── synth primitives
  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; to?: number; delay?: number; attack?: number; bus?: Bus; verb?: number } = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    const peak = opts.gain ?? 0.15;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + (opts.attack ?? 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.bus[opts.bus ?? 'sfx']);
    if (opts.verb) { const s = ctx.createGain(); s.gain.value = opts.verb; g.connect(s).connect(this.reverbIn); }
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private burst(dur: number, freq: number, q: number, gain: number, delay = 0, opts: { type?: BiquadFilterType; bus?: Bus; verb?: number; attack?: number } = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    if (opts.attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + opts.attack); }
    else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.bus[opts.bus ?? 'sfx']);
    if (opts.verb) { const s = ctx.createGain(); s.gain.value = opts.verb; g.connect(s).connect(this.reverbIn); }
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  // ───────────────────────────────────────────── UI
  hover() { if (!this.play('ui_hover', { gain: 0.5 })) this.tone(2600, 0.04, { gain: 0.025, type: 'triangle' }); }
  click() { if (!this.play('ui_click', { gain: 0.7 })) this.tone(880, 0.09, { gain: 0.08, to: 1320, type: 'triangle' }); }
  back() { if (!this.play('ui_back', { gain: 0.7 })) this.tone(900, 0.1, { gain: 0.06, to: 520, type: 'triangle' }); }
  confirm() {
    if (this.play('ui_confirm', { gain: 0.8 })) return;
    this.tone(660, 0.18, { gain: 0.08, type: 'sine' });
    this.tone(990, 0.3, { gain: 0.07, type: 'sine', delay: 0.09, verb: 0.3 });
  }
  linked() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, { gain: 0.07, delay: i * 0.08 })); }
  success() {
    if (this.play('success', { gain: 0.8, verb: 0.2 })) return;
    [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.6, { gain: 0.06, delay: i * 0.11, type: 'triangle', verb: 0.35 }));
  }
  error() {
    this.tone(220, 0.18, { gain: 0.09, type: 'square' });
    this.tone(180, 0.22, { gain: 0.07, type: 'square', delay: 0.12 });
  }
  blip() { this.tone(1400, 0.06, { gain: 0.04, type: 'sine' }); }

  // ───────────────────────────────────────────── telescope
  shutter() {
    if (this.play('scope_shutter', { gain: 0.9 })) return;
    this.burst(0.05, 4000, 0.8, 0.5);
    this.burst(0.07, 2500, 1.2, 0.35, 0.07);
    this.tone(1800, 0.05, { gain: 0.04, delay: 0.02 });
    // sensor readout chirp
    this.tone(3200, 0.25, { gain: 0.018, type: 'square', to: 5200, delay: 0.12 });
  }
  /** Target acquired: two-tone lock. */
  lockOn() {
    if (this.play('scope_lock', { gain: 0.7 })) return;
    this.tone(1760, 0.09, { gain: 0.05, type: 'sine' });
    this.tone(2637, 0.22, { gain: 0.05, type: 'sine', delay: 0.09, verb: 0.2 });
  }
  /** Small detent click (focus / exposure steps). */
  detent() { this.tone(3000 + Math.random() * 400, 0.018, { gain: 0.03, type: 'square' }); }

  /** Telescope motors: zoom whine, slew rumble, focus servo. All 0..1. */
  scopeMotors(zoom: number, slew: number, focus: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    let m = this.loops.get('scope');
    if (!m) {
      const out = ctx.createGain(); out.gain.value = 1; out.connect(this.bus.sfx);
      const mk = (type: OscillatorType, f: number, filt: number, q: number) => {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = filt; bp.Q.value = q;
        const g = ctx.createGain(); g.gain.value = 0;
        o.connect(bp).connect(g).connect(out); o.start();
        return { o, g, bp };
      };
      const z = mk('sawtooth', 180, 1400, 2.5), f = mk('square', 95, 900, 4);
      const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true;
      const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 260;
      const ng = ctx.createGain(); ng.gain.value = 0;
      n.connect(nf).connect(ng).connect(out); n.start();
      m = {
        set: (a: number) => void a,
        stop: () => { out.gain.setTargetAtTime(0, ctx.currentTime, 0.1); setTimeout(() => { z.o.stop(); f.o.stop(); n.stop(); }, 600); },
      };
      (m as unknown as { parts: unknown }).parts = { z, f, ng };
      this.loops.set('scope', m);
    }
    const p = (m as unknown as { parts: { z: { o: OscillatorNode; g: GainNode }; f: { o: OscillatorNode; g: GainNode }; ng: GainNode } }).parts;
    const t = ctx.currentTime;
    p.z.g.gain.setTargetAtTime(Math.min(1, zoom) * 0.05, t, 0.05);
    p.z.o.frequency.setTargetAtTime(160 + zoom * 260, t, 0.08);
    p.f.g.gain.setTargetAtTime(Math.min(1, focus) * 0.04, t, 0.04);
    p.f.o.frequency.setTargetAtTime(80 + focus * 120, t, 0.05);
    p.ng.gain.setTargetAtTime(Math.min(1, slew) * 0.12, t, 0.1);
  }

  // ───────────────────────────────────────────── rover
  servo(dur = 0.8) {
    if (this.play('rover_servo', { gain: 0.7, rate: 0.9 + Math.random() * 0.2 })) return;
    this.tone(180, dur, { gain: 0.05, type: 'sawtooth', to: 240, attack: 0.05 });
    this.tone(361, dur, { gain: 0.018, type: 'square', to: 482, attack: 0.05 });
    this.burst(dur, 900, 4, 0.04);
  }

  /** Rotary-percussive drill buzz. */
  drill(dur = 1.2) {
    if (this.play('rover_drill', { gain: 0.9 })) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.linearRampToValueAtTime(118, t + dur * 0.5);
    lfo.frequency.value = 31;
    lg.gain.value = 9;
    lfo.connect(lg).connect(osc.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.12);
    g.gain.setValueAtTime(0.07, t + dur - 0.2);
    g.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(g).connect(this.bus.sfx);
    osc.start(t); lfo.start(t);
    osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    this.burst(dur, 2600, 2, 0.05);
  }

  /** Continuous drive sound: electric motor whine + gravel crunch. speed 0..1, sand 0..1. */
  roverDrive(speed: number, sand = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    let m = this.loops.get('rover');
    if (!m) {
      const out = ctx.createGain(); out.connect(this.bus.sfx);
      const hasMotor = this.samples.get('rover_motor'), hasGravel = this.samples.get('rover_gravel');
      // motor: sample loop or two detuned saws through a resonant low-pass
      let motorRate: AudioParam | null = null, motorFreq: AudioParam[] = [];
      const mg = ctx.createGain(); mg.gain.value = 0; mg.connect(out);
      const srcs: AudioScheduledSourceNode[] = [];
      if (hasMotor) {
        const s = ctx.createBufferSource(); s.buffer = hasMotor; s.loop = true; s.connect(mg); s.start(); srcs.push(s); motorRate = s.playbackRate;
      } else {
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 3; lp.connect(mg);
        for (const det of [0, 7]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 60; o.detune.value = det; o.connect(lp); o.start(); srcs.push(o); motorFreq.push(o.frequency); }
        const w = ctx.createOscillator(); w.type = 'sine'; w.frequency.value = 600; const wg = ctx.createGain(); wg.gain.value = 0.12; w.connect(wg).connect(lp); w.start(); srcs.push(w); motorFreq.push(w.frequency);
      }
      // gravel: sample loop or band-passed noise with random crackle
      const gg = ctx.createGain(); gg.gain.value = 0; gg.connect(out);
      let gravelFilter: BiquadFilterNode | null = null;
      if (hasGravel) { const s = ctx.createBufferSource(); s.buffer = hasGravel; s.loop = true; s.connect(gg); s.start(); srcs.push(s); }
      else {
        const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
        gravelFilter = ctx.createBiquadFilter(); gravelFilter.type = 'bandpass'; gravelFilter.frequency.value = 1700; gravelFilter.Q.value = 0.7;
        s.connect(gravelFilter).connect(gg); s.start(); srcs.push(s);
      }
      const state = { speed: 0, sand: 0 };
      const crackle = window.setInterval(() => {
        if (!hasGravel && state.speed > 0.08 && Math.random() < state.speed * 0.9) this.burst(0.03, 2500 + Math.random() * 2500, 3, 0.05 * state.speed, Math.random() * 0.1);
      }, 90);
      m = {
        set: (sp: number, sd = 0) => {
          state.speed = sp; state.sand = sd;
          const t = ctx.currentTime;
          mg.gain.setTargetAtTime(0.012 + sp * 0.07, t, 0.15);
          if (motorRate) motorRate.setTargetAtTime(0.7 + sp * 0.6, t, 0.2);
          motorFreq.forEach((f, i) => f.setTargetAtTime((i === 2 ? 480 : 48) * (1 + sp * 0.9), t, 0.2));
          gg.gain.setTargetAtTime(sp * (hasGravel ? 0.6 : 0.08) * (1 - sd * 0.5), t, 0.1);
          gravelFilter?.frequency.setTargetAtTime(1700 - sd * 900, t, 0.2);
        },
        stop: () => { clearInterval(crackle); out.gain.setTargetAtTime(0, ctx.currentTime, 0.15); setTimeout(() => srcs.forEach((s) => s.stop()), 800); },
      };
      this.loops.set('rover', m);
    }
    m.set(Math.min(1, Math.abs(speed)), sand);
  }

  stopLoops() {
    this.loops.forEach((l) => l.stop());
    this.loops.clear();
  }

  // ───────────────────────────────────────────── cinematic
  /** Deep "whoomp" for the satellite-view jump cuts. */
  whoosh() {
    if (this.play('whoosh', { gain: 0.9, verb: 0.3 })) return;
    this.tone(120, 0.5, { gain: 0.16, to: 38, type: 'sine', attack: 0.02 });
    this.burst(0.35, 500, 0.6, 0.12);
  }
  /** Big low brass-like hit (trailer "braam"). */
  braam() {
    if (this.play('braam', { gain: 1, verb: 0.4 })) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(180, t); lp.frequency.exponentialRampToValueAtTime(1400, t + 0.35); lp.frequency.exponentialRampToValueAtTime(260, t + 3.2);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
    lp.connect(g).connect(this.bus.sfx);
    const s = ctx.createGain(); s.gain.value = 0.5; g.connect(s).connect(this.reverbIn);
    for (const [n, det] of [[26, 0], [26, 9], [38, -6], [33, 4], [14, 0]] as const) {
      const o = ctx.createOscillator(); o.type = n === 14 ? 'sine' : 'sawtooth'; o.frequency.value = midi(n); o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + 3.8);
    }
    this.burst(0.5, 120, 0.8, 0.25, 0, { type: 'lowpass' });
  }
  /** Taiko-style percussive impact. */
  impact(gain = 1) {
    if (this.play('impact', { gain, verb: 0.3 })) return;
    this.tone(78, 0.9, { gain: 0.32 * gain, to: 34, type: 'sine', attack: 0.004, verb: 0.3 });
    this.burst(0.25, 180, 0.7, 0.3 * gain, 0, { type: 'lowpass', verb: 0.3 });
    this.burst(0.08, 2400, 0.6, 0.08 * gain);
  }
  /** Rising tension swell over `dur` seconds (into a cut / reveal). */
  riser(dur = 3) {
    if (this.play('riser', { gain: 0.8, verb: 0.3 })) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(5000, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    src.connect(bp).connect(g).connect(this.bus.sfx);
    const s = ctx.createGain(); s.gain.value = 0.4; g.connect(s).connect(this.reverbIn);
    src.start(t); src.stop(t + dur + 0.1);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(440, t + dur);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.03, t + dur); og.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    o.connect(og).connect(this.bus.sfx); o.start(t); o.stop(t + dur + 0.1);
  }
  /** Mechanical clamp / tow-cable latch. */
  clank() {
    if (this.play('latch_clank', { gain: 1, verb: 0.25 })) return;
    this.burst(0.18, 1900, 6, 0.35, 0, { verb: 0.3 });
    this.burst(0.22, 3400, 9, 0.18, 0.015);
    this.tone(523, 0.5, { gain: 0.06, type: 'triangle', to: 500 });
    this.tone(1307, 0.35, { gain: 0.035, type: 'triangle' });
    this.tone(70, 0.3, { gain: 0.2, to: 40 });
  }
  /** Cable winch spooling out. */
  winch(dur = 1.4) {
    if (this.play('winch', { gain: 0.8 })) return;
    this.tone(240, dur, { gain: 0.04, type: 'sawtooth', to: 380, attack: 0.05 });
    for (let i = 0; i < dur * 14; i++) this.burst(0.02, 3200, 4, 0.04, i / 14);
  }
  /** Emergency klaxon. */
  alarm(times = 3) {
    if (this.play('alarm', { gain: 0.6 })) return;
    for (let i = 0; i < times; i++) {
      this.tone(880, 0.22, { gain: 0.07, type: 'sawtooth', delay: i * 0.5, verb: 0.2 });
      this.tone(660, 0.22, { gain: 0.07, type: 'sawtooth', delay: i * 0.5 + 0.25, verb: 0.2 });
    }
  }
  /** Countdown tick (last seconds of the recovery window). */
  tick(urgent = false) { this.tone(urgent ? 1500 : 1100, 0.05, { gain: urgent ? 0.06 : 0.035, type: 'square' }); }
  /** Comms open/close for ACE transmissions. */
  radio(open: boolean) {
    if (this.play(open ? 'radio_in' : 'radio_out', { gain: 0.35, bus: 'voice' })) return;
    this.burst(open ? 0.09 : 0.06, 2200, 0.8, 0.05, 0, { bus: 'voice' });
    this.tone(open ? 1250 : 950, 0.045, { gain: 0.025, type: 'sine', bus: 'voice', delay: open ? 0.06 : 0 });
  }

  // ───────────────────────────────────────────── ambience
  /** Looping background bed. 'space' = deep drone, 'mars' = wind (storm intensity via setWind). */
  setAmbience(kind: 'space' | 'mars' | 'none') {
    this.ambience?.stop();
    this.ambience = null;
    const ctx = this.ctx;
    if (!ctx || kind === 'none') return;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
    out.connect(this.bus.amb);
    const nodes: AudioScheduledSourceNode[] = [];
    const timers: number[] = [];

    const bed = this.samples.get(kind === 'space' ? 'amb_space' : 'amb_mars');
    const src = ctx.createBufferSource();
    src.buffer = bed ?? this.noise;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.connect(filt).connect(g).connect(out);
    nodes.push(src);

    let set: ((v: number) => void) | undefined;
    if (kind === 'space') {
      filt.type = 'lowpass';
      filt.frequency.value = bed ? 20000 : 180;
      g.gain.value = bed ? 0.5 : 0.05;
      if (!bed) for (const f of [55, 82.5]) {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.frequency.value = f;
        og.gain.value = 0.018;
        o.connect(og).connect(out);
        nodes.push(o);
      }
    } else {
      filt.type = bed ? 'lowpass' : 'bandpass';
      filt.frequency.value = bed ? 2400 : 420;
      filt.Q.value = bed ? 0.5 : 0.6;
      g.gain.value = bed ? 0.45 : 0.06;
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 0.13;
      lg.gain.value = bed ? 600 : 160;
      lfo.connect(lg).connect(filt.frequency);
      nodes.push(lfo);
      // storm layer: deep roar + gusts + grit pattering on the hull
      const roar = ctx.createBufferSource(); roar.buffer = this.samples.get('amb_storm') ?? this.noise; roar.loop = true;
      const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = this.samples.has('amb_storm') ? 6000 : 300;
      const rg = ctx.createGain(); rg.gain.value = 0;
      roar.connect(rf).connect(rg).connect(out);
      nodes.push(roar);
      let level = 0;
      timers.push(window.setInterval(() => {
        if (level > 0.25 && Math.random() < level * 0.5) {
          // gust: a band-passed swell sweeping up then down
          const t = ctx.currentTime, d = 1.2 + Math.random() * 1.8;
          const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
          const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
          bp.frequency.setValueAtTime(300, t); bp.frequency.linearRampToValueAtTime(900 + level * 900, t + d * 0.4); bp.frequency.linearRampToValueAtTime(350, t + d);
          const gg = ctx.createGain(); gg.gain.setValueAtTime(0.0001, t); gg.gain.exponentialRampToValueAtTime(0.12 * level, t + d * 0.4); gg.gain.exponentialRampToValueAtTime(0.0001, t + d);
          s.connect(bp).connect(gg).connect(out); s.start(t, Math.random()); s.stop(t + d + 0.1);
        }
        if (level > 0.4) for (let i = 0; i < level * 6; i++) this.burst(0.015, 4000 + Math.random() * 3000, 5, 0.025 * level, Math.random() * 0.6, { bus: 'amb' });
      }, 700));
      set = (v: number) => {
        level = v;
        const t = ctx.currentTime;
        g.gain.setTargetAtTime((bed ? 0.45 : 0.05) + v * (bed ? 0.4 : 0.3), t, 0.6);
        if (!bed) filt.frequency.setTargetAtTime(420 + v * 700, t, 0.6);
        rg.gain.setTargetAtTime(v * v * (this.samples.has('amb_storm') ? 0.9 : 0.35), t, 0.8);
      };
    }
    nodes.forEach((n) => n.start());
    this.ambience = {
      stop: () => {
        timers.forEach(clearInterval);
        out.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
        setTimeout(() => nodes.forEach((n) => n.stop()), 1500);
      },
      set,
    };
  }

  /** 0..1 storm intensity for the Mars wind bed. */
  setWind(v: number) {
    this.ambience?.set?.(v);
  }

  // ───────────────────────────────────────────── music
  setMusic(state: MusicState, intensity = 0) {
    if (!this.ctx) return;
    if (!this.music) this.music = new MusicDirector(this.ctx, this.bus.music, this.reverbIn, this.noise, this.samples);
    this.music.set(state, intensity);
  }
  setMusicIntensity(v: number) { this.music?.setIntensity(v); }

  // ───────────────────────────────────────────── voice
  /** Decode a voice line file (cached). */
  private voiceCache = new Map<string, Promise<AudioBuffer | null>>();
  loadVoice(url: string) {
    let p = this.voiceCache.get(url);
    if (!p) {
      p = (async () => {
        if (!this.ctx) return null;
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          return await this.ctx.decodeAudioData(await res.arrayBuffer());
        } catch { return null; }
      })();
      this.voiceCache.set(url, p);
    }
    return p;
  }

  private voiceChain: AudioNode | null = null;
  /** ACE's voice processing: clean, close, slightly synthetic (subtle doubled chorus + presence). */
  private voiceIn() {
    const ctx = this.ctx!;
    if (this.voiceChain) return this.voiceChain;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 95;
    const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3200; pres.gain.value = 2.5; pres.Q.value = 0.8;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.15;
    hp.connect(pres).connect(comp).connect(this.bus.voice);
    // doubled, slightly detuned copy: the "AI" sheen
    const dl = ctx.createDelay(0.05); dl.delayTime.value = 0.014;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.6; const lg = ctx.createGain(); lg.gain.value = 0.002; lfo.connect(lg).connect(dl.delayTime); lfo.start();
    const dg = ctx.createGain(); dg.gain.value = 0.13;
    comp.connect(dl).connect(dg).connect(this.bus.voice);
    const vs = ctx.createGain(); vs.gain.value = 0.12; comp.connect(vs).connect(this.reverbIn);
    this.voiceChain = hp;
    return hp;
  }

  /** Play a decoded voice line. Resolves when it ends or is stopped. */
  playVoice(buf: AudioBuffer, rate = 1): { done: Promise<void>; stop: () => void } {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    src.connect(g).connect(this.voiceIn());
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    src.onended = () => resolve();
    src.start(ctx.currentTime + 0.08);
    return {
      done,
      stop: () => { g.gain.setTargetAtTime(0, ctx.currentTime, 0.03); setTimeout(() => { try { src.stop(); } catch { /* already stopped */ } resolve(); }, 120); },
    };
  }
}

/**
 * Procedural score: slow pads in minor modes, an ostinato + taiko layer for the emergency,
 * a major swell for the triumph. Loops a generated music file instead when one exists (music_<state>).
 */
class MusicDirector {
  private state: MusicState = 'none';
  private intensity = 0;
  private timer = 0;
  private nextBar = 0;
  private bar = 0;
  private out: GainNode;
  private file: { src: AudioBufferSourceNode; g: GainNode } | null = null;

  private static readonly DEF: Record<Exclude<MusicState, 'none'>, { chords: number[][]; bar: number; cutoff: number; gain: number; pulse?: boolean; perc?: boolean; type: OscillatorType }> = {
    // D minor: i – VI – III – VII (heroic, restrained)
    menu: { chords: [[50, 57, 62, 65], [46, 53, 58, 62], [41, 53, 57, 60], [48, 55, 60, 64]], bar: 6, cutoff: 900, gain: 0.05, type: 'sawtooth' },
    // E lydian, airy and high
    jupiter: { chords: [[52, 59, 64, 68, 70], [50, 57, 62, 66, 69], [52, 59, 63, 68, 71], [47, 54, 59, 63, 66]], bar: 8, cutoff: 1500, gain: 0.035, type: 'triangle' },
    // A minor drone with slow colour changes
    mars: { chords: [[45, 52, 57, 60], [45, 52, 57, 62], [41, 48, 57, 60], [43, 50, 55, 59]], bar: 9, cutoff: 650, gain: 0.045, type: 'sawtooth' },
    // C minor, insistent
    tension: { chords: [[48, 55, 60, 63], [44, 51, 56, 60], [46, 53, 58, 62], [43, 50, 55, 59]], bar: 2.6, cutoff: 800, gain: 0.05, pulse: true, perc: true, type: 'sawtooth' },
    rescue: { chords: [[48, 55, 60, 63, 67], [44, 51, 60, 63, 68], [41, 48, 56, 60, 65], [43, 50, 59, 62, 67]], bar: 2.4, cutoff: 1300, gain: 0.055, pulse: true, perc: true, type: 'sawtooth' },
    // C major swell
    triumph: { chords: [[48, 55, 60, 64, 67], [41, 53, 60, 65, 69], [43, 55, 62, 67, 71], [48, 55, 64, 67, 72]], bar: 3.2, cutoff: 1800, gain: 0.055, perc: true, type: 'sawtooth' },
  };

  constructor(private ctx: AudioContext, bus: GainNode, verb: GainNode, private noise: AudioBuffer, private samples: Map<string, AudioBuffer>) {
    this.out = ctx.createGain();
    this.out.connect(bus);
    const send = ctx.createGain();
    send.gain.value = 0.9;
    this.out.connect(send).connect(verb);
  }

  setIntensity(v: number) { this.intensity = Math.max(0, Math.min(1, v)); }

  set(state: MusicState, intensity = 0) {
    this.intensity = intensity;
    if (state === this.state) return;
    this.state = state;
    const t = this.ctx.currentTime;
    // crossfade: fade the old layer while the new one starts on the next bar
    if (this.file) { const f = this.file; f.g.gain.setTargetAtTime(0, t, 0.8); setTimeout(() => f.src.stop(), 4000); this.file = null; }
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(state === 'none' ? 0 : 1, t, state === 'none' ? 0.8 : 0.3);
    clearInterval(this.timer);
    if (state === 'none') return;
    const file = this.samples.get(`music_${state}`);
    if (file) {
      const src = this.ctx.createBufferSource(); src.buffer = file; src.loop = state !== 'triumph';
      const g = this.ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.9, t, 1);
      src.connect(g).connect(this.out); src.start();
      this.file = { src, g };
      return;
    }
    this.bar = 0;
    this.nextBar = t + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 120);
    this.schedule();
  }

  private schedule() {
    const s = this.state;
    if (s === 'none') return;
    const def = MusicDirector.DEF[s];
    while (this.nextBar < this.ctx.currentTime + 0.5) {
      if (s === 'triumph' && this.bar >= def.chords.length) { this.set('mars'); return; }
      const t = this.nextBar, chord = def.chords[this.bar % def.chords.length];
      this.pad(chord, t, def.bar, def.cutoff * (1 + this.intensity * 0.8), def.gain, def.type);
      if (def.pulse) this.pulse(chord[0], t, def.bar);
      if (def.perc) this.perc(t, def.bar, s === 'triumph');
      this.nextBar += def.bar;
      this.bar++;
    }
  }

  private pad(notes: number[], t: number, dur: number, cutoff: number, gain: number, type: OscillatorType) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(cutoff * 0.6, t); lp.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.5); lp.frequency.linearRampToValueAtTime(cutoff * 0.7, t + dur * 1.3);
    const g = ctx.createGain();
    const att = Math.min(2, dur * 0.35), end = t + dur * 1.35;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + att);
    g.gain.setValueAtTime(gain, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, end);
    lp.connect(g).connect(this.out);
    for (const n of notes) for (const det of [-7, 6]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = midi(n); o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(end + 0.05);
    }
    // sub
    const sub = ctx.createOscillator(); sub.frequency.value = midi(notes[0] - 12);
    const sg = ctx.createGain(); sg.gain.setValueAtTime(0.0001, t); sg.gain.linearRampToValueAtTime(gain * 0.9, t + att); sg.gain.linearRampToValueAtTime(0.0001, end);
    sub.connect(sg).connect(this.out); sub.start(t); sub.stop(end + 0.05);
  }

  /** Driving 8th-note ostinato on the root (filter opens with intensity). */
  private pulse(root: number, t: number, dur: number) {
    const ctx = this.ctx, steps = Math.round(dur / 0.3), step = dur / steps;
    for (let i = 0; i < steps; i++) {
      const at = t + i * step, accent = i % 4 === 0 ? 1 : 0.6;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = midi(root - 12 + (i % 8 === 6 ? 7 : 0));
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
      lp.frequency.setValueAtTime(300 + this.intensity * 1600, at); lp.frequency.exponentialRampToValueAtTime(120, at + step * 0.9);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.06 * accent, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + step * 0.95);
      o.connect(lp).connect(g).connect(this.out); o.start(at); o.stop(at + step);
      if (this.intensity > 0.55 && i % 2 === 1) {
        const h = ctx.createOscillator(); h.type = 'square'; h.frequency.value = midi(root + 24 + (i % 4 === 3 ? 3 : 0));
        const hg = ctx.createGain(); hg.gain.setValueAtTime(0.0001, at); hg.gain.linearRampToValueAtTime(0.012 * this.intensity, at + 0.01); hg.gain.exponentialRampToValueAtTime(0.0001, at + step * 0.8);
        h.connect(hg).connect(this.out); h.start(at); h.stop(at + step);
      }
    }
  }

  /** Taiko-like hits: beat 1 always, more with intensity. */
  private perc(t: number, dur: number, triumph: boolean) {
    const hits = triumph ? [0] : this.intensity > 0.6 ? [0, 0.375, 0.5, 0.875] : this.intensity > 0.3 ? [0, 0.5] : [0];
    for (const h of hits) {
      const at = t + h * dur, big = h === 0 ? 1 : 0.6;
      const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(90, at); o.frequency.exponentialRampToValueAtTime(38, at + 0.5);
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.26 * big, at + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.8);
      o.connect(g).connect(this.out); o.start(at); o.stop(at + 0.9);
      const n = this.ctx.createBufferSource(); n.buffer = this.noise;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
      const ng = this.ctx.createGain(); ng.gain.setValueAtTime(0.18 * big, at); ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      n.connect(f).connect(ng).connect(this.out); n.start(at, Math.random()); n.stop(at + 0.25);
    }
  }
}
