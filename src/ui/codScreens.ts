import { html, $, $$, escapeHtml } from './dom';
import type { Sfx } from '../core/Sfx';
import { MISSIONS, type MissionInfo } from '../missions/registry';

/* Menus styled after classic military-shooter front ends (layout/mood only):
   stacked translucent menu bars, a big silhouette, wordmark top-right. */

export type CodMenuAction = 'start' | 'select' | 'controls' | 'settings' | 'sources' | 'credits';

const GROUPS: [CodMenuAction, string][][] = [
  [['start', 'Start Mission'], ['select', 'Mission Select']],
  [['controls', 'Controls'], ['settings', 'Settings']],
  [['sources', 'Mission Data & Sources'], ['credits', 'Credits']],
];

/** Arrow-key navigation across a list of buttons (COD-style). */
function arrowNav(root: HTMLElement, items: HTMLElement[], sfx: Sfx, axis: 'y' | 'x' = 'y') {
  const prev = axis === 'y' ? 'ArrowUp' : 'ArrowLeft', next = axis === 'y' ? 'ArrowDown' : 'ArrowRight';
  const onKey = (e: KeyboardEvent) => {
    if (!root.isConnected) return window.removeEventListener('keydown', onKey);
    if (document.querySelector('.modal-backdrop')) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.code === prev || e.code === next) {
      e.preventDefault();
      const d = e.code === next ? 1 : -1;
      const n = items[(i + d + items.length) % items.length] ?? items[0];
      n.focus();
      sfx.hover();
    }
  };
  window.addEventListener('keydown', onKey);
  for (const it of items) it.addEventListener('pointerenter', () => it.focus({ preventScroll: true }));
}

export function codMainMenu(sfx: Sfx, onAction: (a: CodMenuAction) => void) {
  const groups = GROUPS.map((g) => `<div class="cod-group">${g.map(([a, l]) => `<button class="cod-item" data-a="${a}"><span>${l}</span></button>`).join('')}</div>`).join('');
  const el = html(`
    <section class="cod-menu">
      <div class="cod-haze"></div>
      <div class="cod-grain"></div>
      <div class="cod-logo fade-up">
        <div class="cod-word">MISSION<em>:</em><b>ORION</b></div>
        <div class="cod-tag mono">Bring the NASA experience to your home</div>
      </div>
      <nav class="cod-nav">${groups}</nav>
      <div class="cod-foot mono">NASA Space Apps Challenge project · All imagery &amp; data: NASA / JPL / USGS</div>
      <div class="cod-hint mono"><span class="kbd">↑</span><span class="kbd">↓</span> navigate <span class="kbd">ENTER</span> select</div>
    </section>`);
  const items = $$(el, '.cod-item');
  items.forEach((b, i) => {
    b.style.animationDelay = `${0.15 + i * 0.06}s`;
    b.addEventListener('click', () => { sfx.click(); onAction(b.dataset.a as CodMenuAction); });
    b.addEventListener('focus', () => sfx.hover());
  });
  arrowNav(el, items, sfx);
  requestAnimationFrame(() => items[0]?.focus({ preventScroll: true }));
  return el;
}

const CARD_META: Record<string, { sub: string; date: string }> = {
  jupiter: { sub: 'Hubble Space Telescope', date: 'Launched 24 Apr 1990' },
  mars: { sub: 'Perseverance · Jezero Crater', date: 'Landed 18 Feb 2021' },
  iss: { sub: 'Spacewalk · helmet camera', date: 'Crewed since 2 Nov 2000' },
};

export interface MissionSelectUi {
  el: HTMLElement;
  index: number;
  setLabels(items: { key: string; x: number; y: number; visible: boolean }[]): void;
}

export function codMissionSelect(
  sfx: Sfx,
  hooks: { onFocus: (m: MissionInfo | null) => void; onLaunch: (m: MissionInfo) => void; onTab: (t: 'controls' | 'settings' | 'sources' | 'credits') => void; onBack: () => void },
): MissionSelectUi {
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const cards = MISSIONS.map((m) => `
    <button class="ms-card ${m.enabled ? '' : 'locked'}" data-id="${m.id}">
      <div class="ms-thumb ${m.image ? '' : 'blueprint'}" style="${m.image ? `background-image:url('${m.image}');` : ''}background-position:${m.imagePos};${m.imageSize ? `background-size:${m.imageSize};` : ''}${m.imageFilter ? `filter:${m.imageFilter}` : ''}">${m.enabled ? '' : '<i class="lock"></i>'}</div>
      <div class="ms-card-name">${escapeHtml(m.title)}</div>
      <div class="ms-card-date mono">${CARD_META[m.id]?.date ?? ''}</div>
    </button>`).join('');
  const el = html(`
    <section class="ms passthrough">
      <header class="ms-tabs mono interactive">
        <span class="kbd">ESC</span>
        <b>Mission Select</b>
        <button data-t="controls">Controls</button>
        <button data-t="settings">Settings</button>
        <button data-t="sources">Data &amp; Sources</button>
        <button data-t="credits">Credits</button>
        <button data-t="back">Main Menu</button>
      </header>
      <div class="ms-labels"></div>
      <div class="ms-title"></div>
      <div class="ms-scale mono">Planet positions for ${today} · distances not to scale</div>
      <div class="ms-carousel interactive">${cards}</div>
      <footer class="ms-keys mono"><span><b class="kbd">ENTER</b> Launch</span><span><b class="kbd">←</b><b class="kbd">→</b> Browse</span><span><b class="kbd">ESC</b> Back</span></footer>
    </section>`);

  const ui: MissionSelectUi = {
    el,
    index: 0,
    setLabels(items) {
      $(el, '.ms-labels').innerHTML = items.filter((i) => i.visible).map((i) => `<span class="ms-plabel mono ${focusKey() === i.key ? 'on' : ''}" style="left:${i.x}px;top:${i.y}px">${i.key.toUpperCase()}</span>`).join('');
    },
  };
  const cardEls = $$(el, '.ms-card');
  const focusKey = () => { const id = MISSIONS[ui.index]?.id; return id === 'iss' ? 'earth' : id; };

  const select = (i: number, sound = true, fly = true) => {
    ui.index = (i + MISSIONS.length) % MISSIONS.length;
    const m = MISSIONS[ui.index];
    cardEls.forEach((c, k) => c.classList.toggle('on', k === ui.index));
    const meta = CARD_META[m.id];
    $(el, '.ms-title').innerHTML = `
      <div class="ms-code mono">Mission ${m.code} · ${m.verb}</div>
      <h1>${escapeHtml(m.title)}</h1>
      <div class="ms-sub">${escapeHtml(m.subtitle)}</div>
      <p>${escapeHtml(m.description)}</p>
      <div class="ms-meta mono"><span>${escapeHtml(meta?.sub ?? m.instrument)}</span><span>${m.duration}</span></div>
      ${m.enabled ? '<div class="ms-go mono"><span class="kbd">ENTER</span> Launch mission</div>' : '<div class="tag fiction">In development</div>'}`;
    const t = $(el, '.ms-title');
    t.classList.remove('in');
    void t.offsetWidth;
    t.classList.add('in');
    if (sound) sfx.hover();
    hooks.onFocus(fly ? m : null);
  };

  // Hovering a card flies the camera to that world; leaving the carousel returns to the map overview.
  let hoverTimer = 0;
  cardEls.forEach((c, i) => {
    c.addEventListener('pointerenter', () => { clearTimeout(hoverTimer); hoverTimer = window.setTimeout(() => select(i, i !== ui.index), 150); });
    c.addEventListener('click', () => { select(i, false); launch(); });
  });
  $(el, '.ms-carousel').addEventListener('pointerleave', () => { clearTimeout(hoverTimer); hoverTimer = window.setTimeout(() => hooks.onFocus(null), 350); });
  const launch = () => {
    const m = MISSIONS[ui.index];
    if (!m.enabled) {
      sfx.error();
      const c = cardEls[ui.index];
      c.classList.add('shake');
      setTimeout(() => c.classList.remove('shake'), 400);
      return;
    }
    sfx.confirm();
    hooks.onLaunch(m);
  };
  for (const b of $$(el, '.ms-tabs button')) {
    b.addEventListener('pointerenter', () => sfx.hover());
    b.addEventListener('click', () => { sfx.click(); const t = b.dataset.t!; if (t === 'back') hooks.onBack(); else hooks.onTab(t as 'controls'); });
  }
  const onKey = (e: KeyboardEvent) => {
    if (!el.isConnected) return window.removeEventListener('keydown', onKey);
    if (document.querySelector('.modal-backdrop')) return;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') select(ui.index + 1);
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') select(ui.index - 1);
    else if (e.code === 'Enter') launch();
    else if (e.code === 'Escape') { sfx.back(); hooks.onBack(); }
  };
  window.addEventListener('keydown', onKey);
  (ui as MissionSelectUi & { launchId: (id: string) => void }).launchId = (id: string) => {
    const i = MISSIONS.findIndex((m) => m.id === id);
    if (i >= 0) { select(i); launch(); }
  };
  requestAnimationFrame(() => select(0, false, false)); // start on the overview map
  return ui;
}
