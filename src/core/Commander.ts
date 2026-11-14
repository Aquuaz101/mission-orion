import '../styles/commander.css';

export interface CommanderLine {
  text: string;
  /** 'alert' paints the box orange and uses a more urgent voice. */
  mood?: 'normal' | 'alert';
}

type Input = string | CommanderLine | (string | CommanderLine)[];

/**
 * The AI Mission Commander: scripted, event-driven lines shown as subtitles
 * and spoken with the browser's offline speech engine (if enabled).
 * Works with no internet and no AI API.
 */
export class Commander {
  readonly el: HTMLElement;
  private textEl: HTMLElement;
  private queue: CommanderLine[] = [];
  private running = false;
  private skipCurrent: (() => void) | null = null;
  private idleResolvers: (() => void)[] = [];
  private voice: SpeechSynthesisVoice | null = null;
  voiceEnabled = localStorage.getItem('orion.voice') !== 'off';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'commander';
    this.el.innerHTML = `
      <div class="cmd-badge">
        <div class="cmd-wave"><i></i><i></i><i></i><i></i><i></i></div>
        <div>
          <div class="cmd-name">ORION CONTROL</div>
          <div class="cmd-role">Mission Commander · AI</div>
        </div>
      </div>
      <div class="cmd-text"></div>
      <div class="cmd-skip"><span class="kbd">TAB</span> skip</div>`;
    this.textEl = this.el.querySelector('.cmd-text')!;
    parent.appendChild(this.el);

    if ('speechSynthesis' in window) {
      const pick = () => (this.voice = pickVoice(speechSynthesis.getVoices()));
      pick();
      speechSynthesis.addEventListener('voiceschanged', pick);
    }
  }

  setVoiceEnabled(on: boolean) {
    this.voiceEnabled = on;
    localStorage.setItem('orion.voice', on ? 'on' : 'off');
    if (!on && 'speechSynthesis' in window) speechSynthesis.cancel();
  }

  /** Queue lines. Resolves when these lines have finished (or were skipped). */
  say(input: Input, opts: { interrupt?: boolean } = {}): Promise<void> {
    const lines = (Array.isArray(input) ? input : [input]).map((l) => (typeof l === 'string' ? { text: l } : l));
    if (opts.interrupt) this.clear();
    this.queue.push(...lines);
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
    while (this.queue.length) {
      const line = this.queue.shift()!;
      await this.play(line);
    }
    this.el.classList.remove('show', 'alert', 'speaking');
    this.running = false;
    const rs = this.idleResolvers;
    this.idleResolvers = [];
    rs.forEach((r) => r());
  }

  private play(line: CommanderLine) {
    return new Promise<void>((resolve) => {
      this.el.classList.toggle('alert', line.mood === 'alert');
      this.el.classList.add('speaking');
      this.textEl.textContent = '';
      const chars = [...line.text];
      let i = 0;
      let speechDone = !this.voiceEnabled || !this.voice;
      let minTimeDone = false;
      let finished = false;

      const typer = window.setInterval(() => {
        i = Math.min(chars.length, i + 2);
        this.textEl.textContent = chars.slice(0, i).join('');
        if (i >= chars.length) window.clearInterval(typer);
      }, 22);

      const finish = () => {
        if (finished) return;
        finished = true;
        window.clearInterval(typer);
        window.clearTimeout(minTimer);
        window.clearTimeout(safety);
        this.textEl.textContent = line.text;
        this.el.classList.remove('speaking');
        this.skipCurrent = null;
        if ('speechSynthesis' in window) speechSynthesis.cancel();
        window.setTimeout(resolve, 250);
      };
      const check = () => speechDone && minTimeDone && finish();

      // Reading time: ~15 chars/s + 1.2 s, so subtitles stay up long enough without voice.
      const minTimer = window.setTimeout(() => { minTimeDone = true; check(); }, 1200 + line.text.length * 62);
      // Safety net in case the speech engine never fires 'end'.
      const safety = window.setTimeout(finish, 4000 + line.text.length * 110);

      if (!speechDone) {
        const u = new SpeechSynthesisUtterance(line.text);
        u.voice = this.voice;
        u.rate = line.mood === 'alert' ? 1.08 : 1.0;
        u.pitch = 0.92;
        u.onend = u.onerror = () => { speechDone = true; check(); };
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }
      this.skipCurrent = finish;
    });
  }
}

/** Prefer offline (localService) English voices; natural-sounding ones first. */
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const local = en.filter((v) => v.localService);
  const pool = local.length ? local : en;
  const prefs = [/guy/i, /david/i, /mark/i, /aria/i, /zira/i, /daniel/i, /google uk english male/i, /alex/i];
  for (const p of prefs) {
    const v = pool.find((x) => p.test(x.name));
    if (v) return v;
  }
  return pool[0] ?? null;
}
