/** Tiny DOM helpers: no framework needed for a handful of screens. */
export function html<T extends HTMLElement = HTMLElement>(markup: string): T {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as T;
}

export const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => [...root.querySelectorAll(sel)] as T[];

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Shows one full-screen element at a time with a cross-fade. */
export class ScreenHost {
  private current: HTMLElement | null = null;

  constructor(private root: HTMLElement) {}

  async show(el: HTMLElement | null) {
    const prev = this.current;
    this.current = el;
    if (prev) {
      prev.classList.remove('in');
      prev.classList.add('out');
      setTimeout(() => prev.remove(), 600);
    }
    if (el) {
      el.classList.add('screen');
      this.root.appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
    }
    await wait(prev ? 350 : 0);
  }
}

/** Modal dialog over the current screen. Resolves when closed. */
export function openModal(title: string, body: string | HTMLElement, onSound?: () => void): Promise<void> {
  return new Promise((resolve) => {
    const el = html(`
      <div class="modal-backdrop">
        <div class="modal panel brackets" role="dialog" aria-label="${escapeHtml(title)}">
          <header><h2>${escapeHtml(title)}</h2><button class="btn ghost close" aria-label="Close">Close <span class="kbd">ESC</span></button></header>
          <div class="modal-body"></div>
        </div>
      </div>`);
    const bodyEl = $(el, '.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else bodyEl.appendChild(body);
    const close = () => {
      onSound?.();
      el.classList.remove('in');
      window.removeEventListener('keydown', onKey, true);
      setTimeout(() => el.remove(), 300);
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    $(el, '.close').addEventListener('click', close);
    el.addEventListener('click', (e) => e.target === el && close());
    window.addEventListener('keydown', onKey, true);
    document.getElementById('ui')!.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
  });
}
