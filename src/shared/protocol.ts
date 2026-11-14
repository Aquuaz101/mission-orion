// Message protocol shared by the PC game, the phone controller and the local relay.
// Kept tiny on purpose: the phone sends inputs, the PC sends layout + HUD state.

export const LINK_PATH = '/orion-link';

export type ControllerLayout = 'lobby' | 'jupiter' | 'mars' | 'iss';

/** Phone -> PC */
export type CtrlMsg =
  | { t: 'axes'; l: [number, number]; r: [number, number] }
  | { t: 'btn'; id: string; down: boolean }
  | { t: 'val'; id: string; v: number }
  | { t: 'tap'; id: string };

export interface MissionEntry {
  id: string;
  code: string;
  title: string;
  enabled: boolean;
}

export interface HudState {
  objective?: string;
  battery?: number;          // 0..1
  timer?: number | null;     // seconds remaining, null = hidden
  bearing?: number | null;   // radians, relative to rover heading (0 = straight ahead)
  distance?: number | null;  // metres to current waypoint
  prompt?: string | null;    // contextual action label for the big button
  alert?: boolean;
  vals?: Record<string, number>; // slider sync (e.g. focus, exposure)
}

/** PC -> Phone */
export type HostMsg =
  | { t: 'layout'; layout: ControllerLayout; title: string; subtitle?: string; missions?: MissionEntry[] }
  | { t: 'hud'; hud: HudState }
  | { t: 'buzz'; pattern: number | number[] };

/** Relay -> either side */
export type RelayMsg =
  | { t: 'welcome'; pin: string; port: number; addresses: string[] }
  | { t: 'joined'; pin: string }
  | { t: 'peer'; connected: boolean }
  | { t: 'error'; code: 'bad-pin' | 'bad-role' };
