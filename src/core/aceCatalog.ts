/**
 * Every line ACE can speak, in generation priority order (used by scripts/gen-audio.mjs, not by the game).
 * Priority 1 = heard by every player in the main path; 3 = optional hints.
 * `tone` is an ElevenLabs v4 emotion cue (sent as a [bracket] tag, never spoken or shown).
 * ACE's register: calm, dry and precise (think JARVIS); under pressure the tension is controlled, not panicked.
 */
import { ACE_LINES } from './aceLines';
import { voiceId } from './voiceId';
import * as mars from '../missions/mars/script';
import * as jup from '../missions/jupiter/script';
import * as iss from '../missions/iss/script';

/** Delivery groups → voice settings in the generator. */
export type Delivery = 'calm' | 'tense' | 'urgent' | 'warm';
export interface CatalogLine { id: string; text: string; mood: 'normal' | 'alert'; priority: 1 | 2 | 3; where: string; tone: string; delivery: Delivery }

type L = string | { text: string; mood?: 'normal' | 'alert' };

export function aceCatalog(): CatalogLine[] {
  const out: CatalogLine[] = [];
  const seen = new Set<string>();
  const add = (priority: 1 | 2 | 3, where: string, tone: string, delivery: Delivery, ...lines: L[]) => {
    for (const l of lines) {
      const text = typeof l === 'string' ? l : l.text;
      const mood = typeof l === 'string' ? 'normal' : l.mood ?? 'normal';
      const id = voiceId(text);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, text, mood, priority, where, tone, delivery });
    }
  };
  const M = mars.LINES;
  const S = mars.SAMPLES;

  // 1 · main path
  add(1, 'menu', 'warm, quietly confident', 'warm', ACE_LINES.welcome1);
  add(1, 'menu', 'calm', 'calm', ACE_LINES.welcome2, ACE_LINES.welcome3, ACE_LINES.keyboard, ACE_LINES.phoneLinked, ACE_LINES.pairing);
  add(1, 'mars', 'calm, a hint of awe', 'calm', ...mars.briefingLines('device').slice(0, 2));
  add(1, 'mars', 'calm', 'calm', mars.briefingLines('device')[2], mars.briefingLines('phone')[2], M.intro, M.start);
  add(1, 'mars', 'pleased, curious', 'warm', S.igneous.collected[0], S.hematite.collected[0], S.sedimentary.collected[0]);
  add(1, 'mars', 'calm, fascinated', 'calm', ...S.igneous.collected.slice(1), ...S.hematite.collected.slice(1), ...S.sedimentary.collected.slice(1));
  add(1, 'mars', 'calm', 'calm', M.next);
  // the rescue: controlled tension building to relief
  add(1, 'mars-rescue', 'serious, alert', 'tense', M.emergency[0], M.emergency[1]);
  add(1, 'mars-rescue', 'serious, focused', 'tense', M.emergency[2]);
  add(1, 'mars-rescue', 'tense, dry understatement', 'tense', M.emergency[3]);
  add(1, 'mars-rescue', 'tense, controlled', 'tense', M.stormHit);
  add(1, 'mars-rescue', 'tense, low voice', 'tense', M.aresReveal[0]);
  add(1, 'mars-rescue', 'focused, dry', 'tense', M.aresReveal[1]);
  add(1, 'mars-rescue', 'tense', 'tense', M.twoMin);
  add(1, 'mars-rescue', 'urgent, controlled', 'urgent', M.oneMin);
  add(1, 'mars-rescue', 'urgent, intense', 'urgent', M.thirty);
  add(1, 'mars-rescue', 'relieved, exhales, then focused', 'warm', M.latched);
  add(1, 'mars-rescue', 'hopeful, quiet', 'warm', M.recovering[0]);
  add(1, 'mars-rescue', 'calm, reflective', 'calm', M.recovering[1]);
  add(1, 'mars-rescue', 'proud, warm', 'warm', M.restored);
  add(1, 'mars', 'calm', 'calm', M.sample3);
  add(1, 'mars', 'warm, satisfied', 'warm', M.wrap[0]);
  add(1, 'mars', 'calm, reflective', 'calm', M.wrap[1]);
  add(1, 'jupiter', 'calm, a hint of wonder', 'calm', ...jup.briefingLines('device').slice(0, 2));
  add(1, 'jupiter', 'calm', 'calm', jup.briefingLines('device')[2], jup.briefingLines('phone')[2]);
  for (const o of jup.OBJECTIVES) {
    add(1, 'jupiter', 'calm', 'calm', o.start);
    add(1, 'jupiter', 'pleased, fascinated', 'warm', o.success[0]);
    add(1, 'jupiter', 'calm, fascinated', 'calm', ...o.success.slice(1));
  }
  add(1, 'jupiter', 'warm, satisfied', 'warm', jup.WRAP_UP[0]);
  add(1, 'jupiter', 'calm', 'calm', ...jup.WRAP_UP.slice(1));
  add(1, 'jupiter', 'dry', 'calm', jup.LOCKED);

  // ISS spacewalk
  const I = iss.L;
  add(1, 'iss', 'calm, welcoming', 'calm', ...iss.briefingLines('device'), iss.briefingLines('phone')[2]);
  add(1, 'iss', 'calm, focused', 'calm', I.boot);
  add(1, 'iss', 'quiet awe', 'warm', I.hatch, I.orbitFact);
  add(1, 'iss', 'calm', 'calm', I.q1, I.q2, I.q3, I.q4, I.arrive, I.torqueIntro, I.connIntro, I.translating);
  add(1, 'iss', 'approving, warm', 'warm', I.tetherOk, I.railsOk, I.footOk, I.seqOk, I.torqueDone, I.connDone, I.powerUp);
  add(1, 'iss', 'calm, helpful', 'calm', I.torqueMiss, I.connWrong);
  add(1, 'iss', 'serious, alert', 'tense', I.debris1);
  add(1, 'iss', 'urgent, controlled', 'urgent', I.debris2, I.q6, I.impact);
  add(1, 'iss', 'focused, tense', 'tense', I.returnOk, I.shieldOk);
  add(1, 'iss', 'relieved, exhales', 'warm', I.hatchClose);
  add(1, 'iss', 'warm, reflective', 'calm', I.wrap1, I.wrap2);
  add(2, 'iss', 'firm, dry', 'tense', ...Object.values(I.wrong).map((t) => ({ text: t, mood: 'alert' as const })));

  // 2 · frequent situational lines
  add(2, 'mars', 'calm, informative', 'calm', M.stormFact, M.mmrtg, M.speedNote, M.sand, M.steep, M.aresNear, M.linked);
  add(2, 'mars-rescue', 'grave, quiet', 'tense', { text: M.fail, mood: 'alert' });
  add(2, 'mars-rescue', 'determined', 'tense', { text: M.retry, mood: 'alert' });
  add(2, 'mars-rescue', 'tense', 'tense', M.lowBatt);
  add(2, 'mars-rescue', 'encouraging, tense', 'tense', M.ridgeClose);
  add(2, 'jupiter', 'calm, helpful', 'calm', ...Object.values(jup.HINTS));
  // 3 · rare
  add(3, 'menu', 'dry', 'calm', ACE_LINES.voiceOn);
  return out;
}
