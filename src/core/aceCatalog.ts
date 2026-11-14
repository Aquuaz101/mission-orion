/**
 * Every line ACE can speak, in generation priority order (used by scripts/gen-audio.mjs, not by the game).
 * Priority 1 = heard by every player in the main path; 3 = optional hints.
 */
import { ACE_LINES } from './aceLines';
import { voiceId } from './voiceId';
import * as mars from '../missions/mars/script';
import * as jup from '../missions/jupiter/script';

export interface CatalogLine { id: string; text: string; mood: 'normal' | 'alert'; priority: 1 | 2 | 3; where: string }

type L = string | { text: string; mood?: 'normal' | 'alert' };

export function aceCatalog(): CatalogLine[] {
  const out: CatalogLine[] = [];
  const seen = new Set<string>();
  const add = (priority: 1 | 2 | 3, where: string, ...lines: L[]) => {
    for (const l of lines) {
      const text = typeof l === 'string' ? l : l.text;
      const mood = typeof l === 'string' ? 'normal' : l.mood ?? 'normal';
      const id = voiceId(text);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, text, mood, priority, where });
    }
  };
  const M = mars.LINES;

  // 1 · main path
  add(1, 'menu', ACE_LINES.welcome1, ACE_LINES.welcome2, ACE_LINES.welcome3, ACE_LINES.keyboard, ACE_LINES.phoneLinked, ACE_LINES.pairing);
  add(1, 'mars', ...mars.briefingLines('device'), ...mars.briefingLines('phone'), M.intro, M.start);
  for (const s of Object.values(mars.SAMPLES)) add(1, 'mars', ...s.collected);
  add(1, 'mars', M.next, ...M.emergency, ...M.aresReveal, M.latched, ...M.recovering, M.restored, M.sample3, ...M.wrap);
  add(1, 'mars-rescue', M.stormHit, M.twoMin, M.oneMin, M.thirty);
  add(1, 'jupiter', ...jup.briefingLines('device'), ...jup.briefingLines('phone'));
  for (const o of jup.OBJECTIVES) add(1, 'jupiter', o.start, ...o.success);
  add(1, 'jupiter', ...jup.WRAP_UP, jup.LOCKED);

  // 2 · frequent situational lines
  add(2, 'mars', M.stormFact, M.mmrtg, M.speedNote, M.sand, { text: M.fail, mood: 'alert' }, { text: M.retry, mood: 'alert' }, M.lowBatt, M.ridgeClose, M.steep, M.aresNear, M.linked);
  add(2, 'jupiter', ...Object.values(jup.HINTS));
  // 3 · rare
  add(3, 'menu', ACE_LINES.voiceOn);
  return out;
}
