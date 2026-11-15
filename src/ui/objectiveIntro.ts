import '../styles/objIntro.css';
import { html, escapeHtml } from './dom';
import type { Input } from '../core/Input';
import type { Sfx } from '../core/Sfx';

export type ObjIcon = 'rock' | 'target' | 'storm' | 'moon' | 'tether' | 'route' | 'battery' | 'shield' | 'signal';
export interface IntroObjective { title: string; sub: string; icon: ObjIcon; teaser?: boolean }
export interface ObjectiveIntroOpts {
  eyebrow: string;            // e.g. "MISSION 02 · JEZERO CRATER"
  title: string;              // e.g. "Collect the samples"
  accent: string;             // main mission colour
  accent2: string;            // secondary gradient colour
  objectives: IntroObjective[];
  footer?: string;            // a one-line controls hint
  target?: () => HTMLElement | null; // the HUD objective panel the cards fly into
}

/** Line-art icons (stroke-drawn on reveal). 48×48 viewBox. */
const ICONS: Record<ObjIcon, string> = {
  rock: '<path d="M10 32 L16 16 L28 10 L38 20 L36 34 L22 40 Z"/><path d="M16 16 L22 26 L38 20"/><path d="M22 26 L22 40"/>',
  target: '<circle cx="24" cy="24" r="15"/><circle cx="24" cy="24" r="6"/><path d="M24 3 V12 M24 36 V45 M3 24 H12 M36 24 H45"/>',
  storm: '<path d="M8 18 C14 10 34 10 40 18"/><path d="M6 26 C14 18 34 18 42 26"/><path d="M10 34 C18 28 30 28 38 34"/><circle cx="24" cy="40" r="3"/>',
  moon: '<circle cx="18" cy="24" r="12"/><circle cx="38" cy="14" r="5"/><path d="M8 30 C14 34 24 34 30 28"/>',
  tether: '<circle cx="24" cy="12" r="6"/><path d="M24 18 C10 24 38 30 24 36 C16 40 20 44 24 44"/>',
  route: '<circle cx="10" cy="38" r="4"/><circle cx="38" cy="10" r="4"/><path d="M13 35 C22 30 14 20 24 18 C32 16 30 12 35 12" stroke-dasharray="3 4"/>',
  battery: '<rect x="8" y="14" width="30" height="20" rx="2"/><path d="M38 20 H42 V28 H38"/><path d="M20 18 L16 25 H23 L19 31"/>',
  shield: '<path d="M24 5 L40 11 V24 C40 34 32 41 24 44 C16 41 8 34 8 24 V11 Z"/><path d="M17 24 L22 29 L32 18"/>',
  signal: '<path d="M12 36 L24 12 L36 36"/><path d="M8 18 C12 12 16 10 20 9 M40 18 C36 12 32 10 28 9"/><circle cx="24" cy="12" r="2"/>',
};

/**
 * Full-screen objectives intro, played when a mission's gameplay begins: the mission gradient sweeps in, the title
 * lands, each objective card reveals with its icon drawing itself, then the whole screen collapses into the mission's
 * own objective panel (the cards fly to it). About 6 s; Enter, Space, a click or the phone's Skip jumps to the
 * transition. Resolves once the HUD is fully back.
 */
export function playObjectiveIntro(root: HTMLElement, input: Input, sfx: Sfx, o: ObjectiveIntroOpts): Promise<void> {
  const cards = o.objectives.map((ob, i) => `
    <li class="oi-card${ob.teaser ? ' teaser' : ''}" style="--i:${i}">
      <div class="oi-num mono">${ob.teaser ? '?' : String(i + 1).padStart(2, '0')}</div>
      <svg class="oi-icon" viewBox="0 0 48 48" aria-hidden="true">${ICONS[ob.icon]}</svg>
      <div class="oi-txt"><b>${escapeHtml(ob.title)}</b><span>${escapeHtml(ob.sub)}</span></div>
      <i class="oi-bar"></i>
    </li>`).join('');
  const el = html(`
    <section class="obj-intro" style="--acc:${o.accent};--acc2:${o.accent2};--n:${o.objectives.length}">
      <div class="oi-bg"></div><div class="oi-grain"></div><div class="oi-sweep"></div>
      <div class="oi-inner">
        <div class="oi-eyebrow mono">${escapeHtml(o.eyebrow)} <em>· Objectives</em></div>
        <h1 class="oi-title">${escapeHtml(o.title)}</h1>
        <ol class="oi-list">${cards}</ol>
        ${o.footer ? `<div class="oi-footer mono">${escapeHtml(o.footer)}</div>` : ''}
        <div class="oi-skip mono"><b class="kbd">Enter</b> start now</div>
      </div>
    </section>`);
  root.appendChild(el);
  sfx.riser(1.6);

  return new Promise((resolve) => {
    const timers: number[] = [];
    let leaving = false;
    const at = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms));
    // a soft tick as each card lands
    o.objectives.forEach((_, i) => at(900 + i * 420, () => { sfx.blip(); sfx.typeTick(); }));

    const leave = (fast: boolean) => {
      if (leaving) return;
      leaving = true;
      timers.forEach(clearTimeout);
      off();
      el.classList.add('leave');
      if (fast) el.classList.add('fast');
      sfx.whoosh();
      // FLIP: every card flies into the HUD objective panel as the gradient collapses toward it
      const target = o.target?.();
      const tr = target?.getBoundingClientRect();
      el.querySelectorAll<HTMLElement>('.oi-card').forEach((c, i) => {
        const r = c.getBoundingClientRect();
        const dx = tr ? tr.left + tr.width / 2 - (r.left + r.width / 2) : -r.left;
        const dy = tr ? tr.top + tr.height / 2 - (r.top + r.height / 2) : -r.top;
        c.style.setProperty('--dx', `${dx}px`);
        c.style.setProperty('--dy', `${dy}px`);
        c.style.setProperty('--d', `${fast ? i * 30 : i * 70}ms`);
      });
      if (tr) { el.style.setProperty('--tx', `${tr.left + tr.width / 2}px`); el.style.setProperty('--ty', `${tr.top + tr.height / 2}px`); }
      const dur = fast ? 650 : 1100;
      window.setTimeout(() => {
        el.remove();
        if (target) { target.classList.remove('oi-landed'); void target.offsetWidth; target.classList.add('oi-landed'); }
        sfx.objective();
        resolve();
      }, dur);
    };
    const off = input.onPress((id) => { if (id === 'confirm' || id === 'primary' || id === 'skip') leave(true); });
    el.addEventListener('pointerdown', () => leave(true));
    at(900 + o.objectives.length * 420 + 2200, () => leave(false));
  });
}
