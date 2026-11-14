import type { CtrlMsg } from '../shared/protocol';
import type { Link } from './Link';

export type ControlMode = 'phone' | 'device';

export interface Vec2 { x: number; y: number }

type PressFn = (id: string) => void;
type ValueFn = (id: string, v: number) => void;

/** Keyboard keys that act as named actions (same ids the phone sends). */
const KEY_ACTIONS: Record<string, string> = {
  Space: 'primary',
  KeyE: 'interact',
  Enter: 'confirm',
  Escape: 'pause',
  Tab: 'skip',
};

/**
 * Merges phone + keyboard/mouse into one input surface. Both sources are always
 * live, so the keyboard keeps working if the phone drops mid-demo.
 */
export class Input {
  mode: ControlMode = 'device';

  private keys = new Set<string>();
  private phoneHeld = new Set<string>();
  private phoneL: Vec2 = { x: 0, y: 0 };
  private phoneR: Vec2 = { x: 0, y: 0 };
  private phoneSeen = 0;
  private mouse = { dx: 0, dy: 0, wheel: 0, dragging: false };
  private pressFns = new Set<PressFn>();
  private valueFns = new Set<ValueFn>();
  /** When false, mouse drags on the canvas are ignored (e.g. while menus are open). */
  pointerEnabled = false;
  /** 'lock': click captures the mouse for free-look (tank-game style); 'drag': click-and-drag. */
  lookMode: 'drag' | 'lock' = 'drag';
  /** Mouse position over the window, -1..1 (y up), and when it last moved (performance.now()). */
  readonly pointer = { x: 0, y: 0, movedAt: 0 };

  get pointerLocked() {
    return document.pointerLockElement === this.canvas;
  }
  releasePointer() {
    if (this.pointerLocked) document.exitPointerLock();
  }

  constructor(link: Link, private canvas: HTMLCanvasElement) {
    document.addEventListener('mousemove', (e) => {
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = 1 - (e.clientY / window.innerHeight) * 2;
      this.pointer.movedAt = performance.now();
      if (!this.pointerLocked || !this.pointerEnabled) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    canvas.addEventListener('click', () => {
      if (this.pointerEnabled && this.lookMode === 'lock' && !this.pointerLocked) void canvas.requestPointerLock?.();
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!e.repeat) {
        const action = KEY_ACTIONS[e.code];
        if (action) this.emitPress(action);
        this.emitPress('key:' + e.code);
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.pointerEnabled || e.button !== 0 || this.lookMode === 'lock') return;
      this.mouse.dragging = true;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.mouse.dragging) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    const end = () => (this.mouse.dragging = false);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      if (!this.pointerEnabled) return;
      e.preventDefault();
      this.mouse.wheel += Math.sign(e.deltaY);
    }, { passive: false });

    link.onMessage((m) => this.onPhone(m));
    link.onChange((l) => {
      if (!l.peerConnected) this.resetPhone();
    });
  }

  /** True if the phone sent anything in the last 3 s. */
  get phoneActive() {
    return performance.now() - this.phoneSeen < 3000;
  }

  key(code: string) {
    return this.keys.has(code);
  }

  /** Held state of a named phone button, or any of the given keyboard keys. */
  held(id: string, ...codes: string[]) {
    return this.phoneHeld.has(id) || codes.some((c) => this.keys.has(c));
  }

  /** Left stick: WASD + phone left joystick. y = forward. */
  stickL(): Vec2 {
    const kx = (this.key('KeyD') ? 1 : 0) - (this.key('KeyA') ? 1 : 0);
    const ky = (this.key('KeyW') ? 1 : 0) - (this.key('KeyS') ? 1 : 0);
    return clampVec({ x: kx + this.phoneL.x, y: ky + this.phoneL.y });
  }

  /** Right stick: arrow keys + phone right joystick. y = up. */
  stickR(): Vec2 {
    const kx = (this.key('ArrowRight') ? 1 : 0) - (this.key('ArrowLeft') ? 1 : 0);
    const ky = (this.key('ArrowUp') ? 1 : 0) - (this.key('ArrowDown') ? 1 : 0);
    return clampVec({ x: kx + this.phoneR.x, y: ky + this.phoneR.y });
  }

  /** Mouse drag delta (px) and wheel steps since the last call. */
  consumeMouse() {
    const m = { dx: this.mouse.dx, dy: this.mouse.dy, wheel: this.mouse.wheel };
    this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0;
    return m;
  }

  onPress(fn: PressFn) {
    this.pressFns.add(fn);
    return () => this.pressFns.delete(fn);
  }

  onValue(fn: ValueFn) {
    this.valueFns.add(fn);
    return () => this.valueFns.delete(fn);
  }

  private emitPress(id: string) {
    for (const fn of [...this.pressFns]) fn(id);
  }

  private resetPhone() {
    this.phoneHeld.clear();
    this.phoneL = { x: 0, y: 0 };
    this.phoneR = { x: 0, y: 0 };
  }

  private onPhone(m: CtrlMsg) {
    this.phoneSeen = performance.now();
    switch (m.t) {
      case 'axes':
        this.phoneL = { x: m.l[0], y: m.l[1] };
        this.phoneR = { x: m.r[0], y: m.r[1] };
        break;
      case 'btn':
        if (m.down) {
          this.phoneHeld.add(m.id);
          this.emitPress(m.id);
        } else this.phoneHeld.delete(m.id);
        break;
      case 'tap':
        this.emitPress(m.id);
        break;
      case 'val':
        for (const fn of this.valueFns) fn(m.id, m.v);
        break;
    }
  }
}

function clampVec(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  return len > 1 ? { x: v.x / len, y: v.y / len } : v;
}
