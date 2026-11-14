/** Every mission module implements this. App owns the lifecycle. */
export interface Mission {
  /** Runs briefing → gameplay → report. Resolves when the player leaves the mission. */
  start(): Promise<MissionExit>;
  setPaused(paused: boolean): void;
  /** Leave the mission immediately (pause menu: restart / abort). */
  abort(exit: MissionExit): void;
  /** Free GPU/DOM resources. Safe to call more than once. */
  dispose(): void;
}

export type MissionExit = { to: 'select' } | { to: 'mission'; id: string } | { to: 'restart' };
