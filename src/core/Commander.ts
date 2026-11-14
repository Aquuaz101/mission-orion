import '../styles/commander.css';
import type { Sfx } from './Sfx';
import { voiceId } from './voiceId';

export interface CommanderLine {
  text: string;
  /** 'alert' paints the box orange and uses a more urgent delivery. */
  mood?: 'normal' | 'alert';
}

type Input = string | CommanderLine | (string | CommanderLine)[];

/**
 * ACE: the mission AI. Scripted, event-driven lines shown as subtitles and spoken with
 * pre-generated voice files (public/audio/ace, made with ElevenLabs by `npm run gen:audio`).
 * Lines without a file fall back to the browser's offline speech engine. No network needed.
 */
export class Commander {
  readonly el: HTMLElement;
  private textEl: HTMLElement;
  private queue: CommanderLine[] = [];
  private running = false;
  private skipCurrent: (() => void) | null = null;
  private idleResolvers: (() => void)[] = [];
  private voice: SpeechSynthesisVoice | null = null;
  private files = new Map<string, string>();
  voiceEnabled = localStorage.getItem('orion.voice') !== 'off';

  constructor(parent: HTMLElement, private sfx: Sfx) {
    this.el = document.createElement('div');
    this.el.className = 'commander';
    this.el.innerHTML = `
      <p class="cmd-line"><b class="cmd-name">ACE:</b> <span class="cmd-text"></span></p>
      <div class="cmd-skip"><span class="kbd">TAB</span> skip</div>`;
    this.textEl = this.el.querySelector('.cmd-text')!;
    parent.appendChild(this.el);

    if ('speechSynthesis' in window) {
      const pick = () => (this.voice = pickVoice(speechSynthesis.getVoices()));
      pick();
      speechSynthesis.addEventListener('voiceschanged', pick);
    }
    void fetch('/audio/ace/manifest.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((m: { lines?: Record<string, string> } | null) => {
        for (const [id, file] of Object.entries(m?.lines ?? {})) this.files.set(id, `/audio/ace/${file}`);
      })
      .catch(() => { /* no generated voice: browser speech fallback */ });
  }

  /** True when a generated voice file exists for this line. */
  hasVoice(text: string) {
    return this.files.has(voiceId(text));
  }

  setVoiceEnabled(on: boolean) {
    this.voiceEnabled = on;
    localStorage.setItem('orion.voice', on ? 'on' : 'off');
    if (!on) this.skipCurrent?.();
  }

  /** Queue lines. Resolves when these lines have finished (or were skipped). */
  say(input: Input, opts: { interrupt?: boolean } = {}): Promise<void> {
    const lines = (Array.isArray(input) ? input : [input]).map((l) => (typeof l === 'string' ? { text: l } : l));
    if (opts.interrupt) this.clear();
    this.queue.push(...lines);
    // start decoding the voice files right away so playback starts without a gap
    if (this.voiceEnabled) for (const l of lines) { const f = this.files.get(voiceId(l.text)); if (f) void this.sfx.loadVoice(f); }
    const done = new Promise<void>((resolve) => this.idleResolvers.push(resolve));
    if (!this.running) void this.run();
    return done;
  }

  /** Skip the line currently shown. */
  skip() {
    this.skipCurrent?.();
  }

  /** Drop everything queued and hide. */
  clear() {
    this.queue = [];
    this.skipCurrent?.();
  }

  get busy() {
    return this.running;
  }

  private async run() {
    this.running = true;
    this.el.classList.add('show');
    this.sfx.radio(true);
    this.sfx.duck(true);
    while (this.queue.length) {
      const line = this.queue.shift()!;
      await this.play(line);
    }
    this.sfx.duck(false);
    if (this.el.classList.contains('show')) this.sfx.radio(false);
    this.el.classList.remove('show', 'alert', 'speaking');
    this.running = false;
    const rs = this.idleResolvers;
    this.idleResolvers = [];
    rs.forEach((r) => r());
  }

  private play(line: CommanderLine) {
    return new Promise<void>((resolve) => {
      void (async () => {
        this.el.classList.toggle('alert', line.mood === 'alert');
        this.el.classList.add('speaking');
        this.textEl.textContent = '';
        const chars = [...line.text];
        let i = 0;
        let finished = false;
        let stopVoice: (() => void) | null = null;

        const file = this.voiceEnabled ? this.files.get(voiceId(line.text)) : undefined;
        let skippedEarly = false;
        this.skipCurrent = () => (skippedEarly = true); // skip/clear while the file is still decoding
        const buf = file ? await this.sfx.loadVoice(file) : null;
        if (skippedEarly) { this.skipCurrent = null; this.textEl.textContent = line.text; return resolve(); }
        const useFile = !!buf && !!this.sfx.context;
        const useTts = !useFile && this.voiceEnabled && !!this.voice;
        let speechDone = !useFile && !useTts;
        let minTimeDone = false;

        // Subtitles type in at roughly the speaking pace when a voice file is playing.
        const cps = useFile ? Math.max(14, chars.length / buf!.duration) : 45;
        const typer = window.setInterval(() => {
          i = Math.min(chars.length, i + Math.max(1, Math.round(cps * 0.045)));
          this.textEl.textContent = chars.slice(0, i).join('');
          if (i >= chars.length) window.clearInterval(typer);
        }, 45);

        const finish = () => {
          if (finished) return;
          finished = true;
          window.clearInterval(typer);
          window.clearTimeout(minTimer);
          window.clearTimeout(safety);
          this.textEl.textContent = line.text;
          this.el.classList.remove('speaking');
          this.skipCurrent = null;
          stopVoice?.();
          if (useTts && 'speechSynthesis' in window) speechSynthesis.cancel();
          window.setTimeout(resolve, useFile ? 350 : 250);
        };
        const check = () => speechDone && minTimeDone && finish();

        // Reading time when there is no voice: ~15 chars/s + 1.2 s, so subtitles stay up long enough.
        const minTimer = window.setTimeout(() => { minTimeDone = true; check(); }, useFile ? 0 : 1200 + line.text.length * 62);
        // Safety net in case audio never reports its end.
        const safety = window.setTimeout(finish, useFile ? (buf!.duration + 3) * 1000 : 4000 + line.text.length * 110);

        if (useFile) {
          const v = this.sfx.playVoice(buf!);
          stopVoice = v.stop;
          void v.done.then(() => { speechDone = true; check(); });
        } else if (useTts) {
          const u = new SpeechSynthesisUtterance(line.text);
          u.voice = this.voice;
          u.rate = line.mood === 'alert' ? 1.08 : 1.0;
          u.pitch = 0.88;
          u.onend = u.onerror = () => { speechDone = true; check(); };
          speechSynthesis.cancel();
          speechSynthesis.speak(u);
        }
        this.skipCurrent = finish;
      })();
    });
  }
}

/** Fallback voice: prefer offline British male English voices (closest to ACE's character). */
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const local = en.filter((v) => v.localService);
  const pool = local.length ? local : en;
  const prefs = [/ryan/i, /george/i, /google uk english male/i, /daniel/i, /thomas/i, /guy/i, /david/i, /mark/i, /alex/i];
  for (const p of prefs) {
    const v = pool.find((x) => p.test(x.name));
    if (v) return v;
  }
  return pool.find((v) => v.lang.toLowerCase() === 'en-gb') ?? pool[0] ?? null;
}
