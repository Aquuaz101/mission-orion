import { html } from './dom';

/**
 * Cold open, console-shooter style: black → credit → light line → the MISSION:ORION wordmark slams in
 * (impact + flash, music starts) → tagline → dissolve into the main menu.
 *
 * Browsers only allow sound after the player's first click or key press. If that has not happened yet,
 * a small corner hint asks for one; the first press then starts the audio (it does not skip the intro).
 * Any later press skips to the menu.
 */
export function playIntro(opts: {
  audioReady: () => boolean;
  startAudio: () => void;
  onLine?: () => void;
  onLogo: () => void;
  onReveal: () => void;
}): Promise<void> {
  const word = 'MISSION:ORION';
  const letters = [...word].map((ch, i) => `<span class="${ch === ':' ? 'colon' : ''}" style="--i:${i}">${ch}</span>`).join('');
  const el = html(`
    <section class="intro">
      <div class="intro-credit mono">A NASA Space Apps Challenge project</div>
      <div class="intro-stage">
        <div class="intro-line"></div>
        <div class="intro-flare"></div>
        <h1 class="intro-word">${letters}</h1>
        <div class="intro-tag mono">Bring the NASA experience to your home</div>
      </div>
      <div class="intro-flash"></div>
      <div class="intro-sound mono" hidden><i></i>Click or press any key for sound</div>
      <div class="intro-skip mono">Press any key to skip</div>
    </section>`);
  document.getElementById('ui')!.appendChild(el);

  return new Promise((resolve) => {
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    let logoShown = false, revealed = false, finished = false;
    const sound = el.querySelector<HTMLElement>('.intro-sound')!;

    const reveal = () => {
      if (revealed) return;
      revealed = true;
      opts.onReveal();
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      window.removeEventListener('keydown', onInput, true);
      window.removeEventListener('pointerdown', onInput, true);
      reveal();
      el.classList.add('out');
      setTimeout(() => { el.remove(); resolve(); }, 900);
    };
    const onInput = (e: Event) => {
      if (e instanceof KeyboardEvent && (e.repeat || e.code === 'F3' || e.code === 'F12')) return;
      e.preventDefault();
      e.stopPropagation();
      if (!opts.audioReady()) {
        // first press: enable sound only (and catch the music up if the logo is already on screen)
        opts.startAudio();
        sound.hidden = true;
        if (logoShown) opts.onLogo();
        return;
      }
      finish();
    };
    window.addEventListener('keydown', onInput, true);
    window.addEventListener('pointerdown', onInput, true);
    if (!opts.audioReady()) at(900, () => { if (!opts.audioReady()) sound.hidden = false; });

    at(250, () => el.classList.add('s-credit'));
    at(1900, () => { el.classList.add('s-line'); opts.onLine?.(); });
    at(2700, () => {
      el.classList.add('s-logo');
      logoShown = true;
      opts.onLogo();
    });
    at(3500, () => el.classList.add('s-tag'));
    at(5600, reveal);
    at(5700, finish);
  });
}
