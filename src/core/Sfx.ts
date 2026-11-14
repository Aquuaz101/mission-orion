/**
 * All sound is synthesised with Web Audio: zero audio files, works offline,
 * no licensing questions. The context is created on the first user gesture.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private ambience: { stop: () => void; set?: (v: number) => void } | null = null;
  private volume = Number(localStorage.getItem('orion.volume') ?? 0.7);

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  get level() {
    return this.volume;
  }

  setVolume(v: number) {
    this.volume = v;
    localStorage.setItem('orion.volume', String(v));
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; to?: number; delay?: number; attack?: number } = {}) {
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
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private burst(dur: number, freq: number, q: number, gain: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  hover() { this.tone(2600, 0.04, { gain: 0.025, type: 'triangle' }); }
  click() { this.tone(880, 0.09, { gain: 0.08, to: 1320, type: 'triangle' }); }
  back() { this.tone(900, 0.1, { gain: 0.06, to: 520, type: 'triangle' }); }
  confirm() {
    this.tone(660, 0.18, { gain: 0.08, type: 'sine' });
    this.tone(990, 0.3, { gain: 0.07, type: 'sine', delay: 0.09 });
  }
  linked() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, { gain: 0.07, delay: i * 0.08 }));
  }
  success() {
    [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.6, { gain: 0.06, delay: i * 0.11, type: 'triangle' }));
  }
  error() {
    this.tone(220, 0.18, { gain: 0.09, type: 'square' });
    this.tone(180, 0.22, { gain: 0.07, type: 'square', delay: 0.12 });
  }
  shutter() {
    this.burst(0.05, 4000, 0.8, 0.5);
    this.burst(0.07, 2500, 1.2, 0.35, 0.07);
    this.tone(1800, 0.05, { gain: 0.04, delay: 0.02 });
  }
  blip() { this.tone(1400, 0.06, { gain: 0.04, type: 'sine' }); }
  alarm(times = 3) {
    for (let i = 0; i < times; i++) {
      this.tone(880, 0.22, { gain: 0.09, type: 'sawtooth', delay: i * 0.5 });
      this.tone(660, 0.22, { gain: 0.09, type: 'sawtooth', delay: i * 0.5 + 0.25 });
    }
  }
  servo(dur = 0.8) {
    this.tone(180, dur, { gain: 0.05, type: 'sawtooth', to: 240, attack: 0.05 });
    this.burst(dur, 900, 4, 0.04);
  }

  /** Looping background bed. 'space' = deep drone, 'mars' = wind (intensity via set()). */
  setAmbience(kind: 'space' | 'mars' | 'none') {
    this.ambience?.stop();
    this.ambience = null;
    const ctx = this.ctx;
    if (!ctx || kind === 'none') return;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
    out.connect(this.master);
    const nodes: AudioScheduledSourceNode[] = [];

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.connect(filt).connect(g).connect(out);
    nodes.push(src);

    if (kind === 'space') {
      filt.type = 'lowpass';
      filt.frequency.value = 180;
      g.gain.value = 0.05;
      for (const f of [55, 82.5]) {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.frequency.value = f;
        og.gain.value = 0.018;
        o.connect(og).connect(out);
        nodes.push(o);
      }
    } else {
      filt.type = 'bandpass';
      filt.frequency.value = 420;
      filt.Q.value = 0.6;
      g.gain.value = 0.06;
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 0.13;
      lg.gain.value = 160;
      lfo.connect(lg).connect(filt.frequency);
      nodes.push(lfo);
    }
    nodes.forEach((n) => n.start());
    this.ambience = {
      stop: () => {
        out.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
        setTimeout(() => nodes.forEach((n) => n.stop()), 1500);
      },
      set: (v: number) => {
        g.gain.setTargetAtTime(0.05 + v * 0.35, ctx.currentTime, 0.6);
        filt.frequency.setTargetAtTime(420 + v * 700, ctx.currentTime, 0.6);
      },
    };
  }

  /** 0..1 storm intensity for the Mars wind bed. */
  setWind(v: number) {
    this.ambience?.set?.(v);
  }
}
