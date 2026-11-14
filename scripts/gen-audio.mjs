#!/usr/bin/env node
/**
 * Generate MISSION: ORION's audio with ElevenLabs, then ship it as static files (the game stays offline).
 *
 *   ELEVENLABS_API_KEY=...  npm run gen:audio            # voice first, then sound effects, then music
 *   npm run gen:audio -- --dry                            # list every line + character count, no API calls
 *   npm run gen:audio -- --only=voice|sfx|music           # one category
 *   npm run gen:audio -- --voice=<voice_id>               # different ACE voice (default: Daniel, British)
 *   npm run gen:audio -- --force                          # regenerate files that already exist
 *
 * The key can also live in .env.local (ELEVENLABS_API_KEY=...), which is git-ignored.
 * Generation is in priority order and checks the remaining credits before each request, so on the free
 * plan it stops cleanly when the quota runs out and reports exactly what is still missing. Re-running
 * later only generates what is missing. Anything missing keeps its built-in fallback in the game.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const API = 'https://api.elevenlabs.io/v1';

// Daniel: a calm, refined British male voice from ElevenLabs' default set (usable on the free plan).
const VOICE_ID = args.voice || process.env.ACE_VOICE_ID || 'onwK4e9ZLuTAKqWW03F9';
const TTS_MODEL = args.model || 'eleven_multilingual_v2';

const ACE_DIR = path.join(ROOT, 'public/audio/ace');
const SFX_DIR = path.join(ROOT, 'public/audio/sfx');

/** Sound effects in priority order. loop = seamless loop (beds / motors). */
const SFX = [
  { name: 'amb_storm', dur: 10, loop: true, text: 'Violent dust storm on a desert planet, roaring wind, fine sand blasting against a metal hull, continuous, loopable, no music' },
  { name: 'braam', dur: 4, text: 'Cinematic movie trailer braam, huge low distorted brass hit with deep sub boom and long dark tail' },
  { name: 'impact', dur: 2, text: 'Cinematic deep impact hit, big taiko drum and sub boom, short reverb tail' },
  { name: 'rover_motor', dur: 5, loop: true, text: 'Electric rover drive motors running steadily, smooth gear whine and low mechanical hum, loopable, no voices' },
  { name: 'rover_gravel', dur: 5, loop: true, text: 'Heavy rover wheels rolling slowly over gravel and fine sand, crunching and grinding, loopable' },
  { name: 'amb_mars', dur: 12, loop: true, text: 'Thin lonely wind across an empty rocky alien desert, soft howl, sparse, eerie, loopable, no music' },
  { name: 'riser', dur: 3, text: 'Cinematic tension riser, rising whoosh and strings building to a sudden peak' },
  { name: 'latch_clank', dur: 1.5, text: 'Heavy steel clamp locking shut, mechanical clank and latch, metallic ring' },
  { name: 'alarm', dur: 2.5, text: 'Spacecraft emergency alarm, urgent two-tone electronic klaxon, sci-fi' },
  { name: 'rover_drill', dur: 2, text: 'Robotic rotary percussive drill coring into hard rock, grinding' },
  { name: 'rover_servo', dur: 1.5, text: 'Robotic arm servo motors moving smoothly, precise mechanical whir' },
  { name: 'winch', dur: 2, text: 'Small electric winch spooling out steel cable, ratcheting mechanism' },
  { name: 'whoosh', dur: 1.5, text: 'Deep cinematic whoosh transition, camera pulling away fast into the sky' },
  { name: 'scope_shutter', dur: 1, text: 'Scientific camera shutter click followed by a short electronic sensor readout chirp' },
  { name: 'scope_lock', dur: 0.8, text: 'Clean sci-fi target lock confirmation, two quick rising beeps' },
  { name: 'radio_in', dur: 0.5, text: 'Very short radio transmission open click with soft squelch' },
  { name: 'radio_out', dur: 0.5, text: 'Very short radio transmission close click' },
  { name: 'amb_space', dur: 12, loop: true, text: 'Deep space station ambience, calm low drone and soft electronic hum, loopable' },
  { name: 'success', dur: 1.5, text: 'Bright sci-fi mission success chime, short and uplifting' },
  { name: 'ui_click', dur: 0.5, text: 'Crisp futuristic user interface click' },
  { name: 'ui_confirm', dur: 0.7, text: 'Futuristic user interface confirm sound, short rising tone' },
  { name: 'ui_back', dur: 0.5, text: 'Futuristic user interface back sound, short falling tone' },
  { name: 'ui_hover', dur: 0.5, text: 'Very soft subtle futuristic interface tick' },
];

/** Music (needs a paid ElevenLabs plan). */
const MUSIC = [
  { name: 'music_tension', ms: 90000, text: 'Tense cinematic action score for a rescue mission on Mars, driving low string ostinato in C minor, taiko drums, rising urgency, orchestral and synth hybrid, no vocals, loopable' },
  { name: 'music_menu', ms: 90000, text: 'Epic but restrained cinematic main menu theme for a space exploration game, slow heroic synth pads and low strings in D minor, wide and atmospheric, no vocals, loopable' },
  { name: 'music_mars', ms: 90000, text: 'Ambient exploration music on Mars, lonely wide synth drones and soft piano notes in A minor, slow, mysterious, no drums, no vocals, loopable' },
  { name: 'music_rescue', ms: 90000, text: 'Heroic high-stakes rescue score, pounding drums, soaring strings and brass, determined, cinematic, no vocals, loopable' },
  { name: 'music_triumph', ms: 30000, text: 'Short triumphant orchestral swell resolving to a major chord, relief and awe, cinematic, no vocals' },
  { name: 'music_jupiter', ms: 90000, text: 'Ethereal ambient space music for observing Jupiter through a telescope, shimmering pads in E lydian, calm wonder, no drums, no vocals, loopable' },
];

// ───────────────────────────────────────────── helpers
function loadKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  for (const f of ['.env.local', '.env']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, 'utf8').match(/^\s*ELEVENLABS_API_KEY\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1].trim();
  }
  return null;
}
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); };

class QuotaError extends Error {}

async function call(key, url, body) {
  const res = await fetch(`${API}${url}`, { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(body) });
  if (res.ok) return Buffer.from(await res.arrayBuffer());
  const text = await res.text();
  if (res.status === 401 && /quota|credit|limit/i.test(text)) throw new QuotaError(text);
  if (res.status === 402 || res.status === 429 || /quota_exceeded|insufficient|credits/i.test(text)) throw new QuotaError(text);
  throw new Error(`${res.status} ${text.slice(0, 300)}`);
}

async function remaining(key) {
  try {
    const res = await fetch(`${API}/user/subscription`, { headers: { 'xi-api-key': key } });
    if (!res.ok) return null;
    const s = await res.json();
    return { left: s.character_limit - s.character_count, limit: s.character_limit, tier: s.tier };
  } catch { return null; }
}

// ───────────────────────────────────────────── main
const vite = await createServer({ root: ROOT, configFile: false, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
let catalog;
try {
  catalog = (await vite.ssrLoadModule('/src/core/aceCatalog.ts')).aceCatalog();
} finally {
  await vite.close();
}

const totalChars = catalog.reduce((s, l) => s + l.text.length, 0);
if (args.dry) {
  for (const l of catalog) console.log(`P${l.priority} ${l.id} [${l.where}${l.mood === 'alert' ? ', alert' : ''}] ${l.text}`);
  console.log(`\n${catalog.length} lines · ${totalChars} characters (P1: ${catalog.filter((l) => l.priority === 1).reduce((s, l) => s + l.text.length, 0)})`);
  console.log(`${SFX.length} sound effects · ${MUSIC.length} music tracks (music needs a paid plan)`);
  process.exit(0);
}

const key = loadKey();
if (!key) {
  console.error('No ElevenLabs API key. Set ELEVENLABS_API_KEY in your environment or in .env.local, then re-run.');
  process.exit(1);
}

const only = args.only;
const report = { voice: { done: [], missing: [] }, sfx: { done: [], missing: [] }, music: { done: [], missing: [] }, stoppedBy: null };
let stopped = false;
const stop = (why) => { stopped = true; report.stoppedBy = why; console.log(`\n■ Stopped: ${why}`); };

const sub = await remaining(key);
if (sub) console.log(`ElevenLabs plan: ${sub.tier} · ${sub.left} of ${sub.limit} credits left`);

// 1 · ACE voice
if (!only || only === 'voice') {
  const man = readJson(path.join(ACE_DIR, 'manifest.json'), { lines: {} });
  man.voice = VOICE_ID; man.model = TTS_MODEL;
  for (const l of catalog) {
    const file = `${l.id}.mp3`, dest = path.join(ACE_DIR, file);
    if (!args.force && fs.existsSync(dest)) { man.lines[l.id] = file; report.voice.done.push(l.id); continue; }
    if (stopped) { report.voice.missing.push(l); continue; }
    const left = await remaining(key);
    if (left && left.left < l.text.length + 5) { stop(`out of credits (${left.left} left, next line needs ${l.text.length})`); report.voice.missing.push(l); continue; }
    try {
      const alert = l.mood === 'alert';
      const audio = await call(key, `/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
        text: l.text,
        model_id: TTS_MODEL,
        voice_settings: { stability: alert ? 0.38 : 0.55, similarity_boost: 0.8, style: alert ? 0.35 : 0.12, use_speaker_boost: true, speed: alert ? 1.04 : 0.98 },
      });
      fs.mkdirSync(ACE_DIR, { recursive: true });
      fs.writeFileSync(dest, audio);
      man.lines[l.id] = file;
      report.voice.done.push(l.id);
      console.log(`✔ voice ${l.id}  ${l.text.slice(0, 70)}`);
      writeJson(path.join(ACE_DIR, 'manifest.json'), man); // save progress after every line
    } catch (e) {
      if (e instanceof QuotaError) { stop(`ElevenLabs quota: ${e.message.slice(0, 160)}`); report.voice.missing.push(l); }
      else { console.log(`✘ voice ${l.id}: ${e.message}`); report.voice.missing.push(l); }
    }
  }
  writeJson(path.join(ACE_DIR, 'manifest.json'), man);
}

// 2 · sound effects
if (!only || only === 'sfx') {
  const man = readJson(path.join(SFX_DIR, 'manifest.json'), { files: {} });
  for (const s of SFX) {
    const file = `${s.name}.mp3`, dest = path.join(SFX_DIR, file);
    if (!args.force && fs.existsSync(dest)) { man.files[s.name] = file; report.sfx.done.push(s.name); continue; }
    if (stopped) { report.sfx.missing.push(s.name); continue; }
    try {
      const audio = await call(key, '/sound-generation?output_format=mp3_44100_128', { text: s.text, duration_seconds: s.dur, prompt_influence: 0.55, ...(s.loop ? { loop: true, model_id: 'eleven_text_to_sound_v2' } : {}) });
      fs.mkdirSync(SFX_DIR, { recursive: true });
      fs.writeFileSync(dest, audio);
      man.files[s.name] = file;
      report.sfx.done.push(s.name);
      console.log(`✔ sfx ${s.name}`);
      writeJson(path.join(SFX_DIR, 'manifest.json'), man);
    } catch (e) {
      if (e instanceof QuotaError) { stop(`ElevenLabs quota: ${e.message.slice(0, 160)}`); report.sfx.missing.push(s.name); }
      else { console.log(`✘ sfx ${s.name}: ${e.message}`); report.sfx.missing.push(s.name); }
    }
  }
  writeJson(path.join(SFX_DIR, 'manifest.json'), man);
}

// 3 · music (paid plans)
if (!only || only === 'music') {
  const man = readJson(path.join(SFX_DIR, 'manifest.json'), { files: {} });
  for (const m of MUSIC) {
    const file = `${m.name}.mp3`, dest = path.join(SFX_DIR, file);
    if (!args.force && fs.existsSync(dest)) { man.files[m.name] = file; report.music.done.push(m.name); continue; }
    if (stopped) { report.music.missing.push(m.name); continue; }
    try {
      const audio = await call(key, '/music?output_format=mp3_44100_128', { prompt: m.text, music_length_ms: m.ms });
      fs.writeFileSync(dest, audio);
      man.files[m.name] = file;
      report.music.done.push(m.name);
      console.log(`✔ music ${m.name}`);
      writeJson(path.join(SFX_DIR, 'manifest.json'), man);
    } catch (e) {
      report.music.missing.push(m.name);
      if (e instanceof QuotaError) stop(`ElevenLabs quota: ${e.message.slice(0, 160)}`);
      else { console.log(`✘ music ${m.name}: ${e.message.slice(0, 200)}`); if (/paid|plan|subscription|forbidden|403/i.test(e.message)) { stop('music generation needs a paid ElevenLabs plan'); } }
    }
  }
  writeJson(path.join(SFX_DIR, 'manifest.json'), man);
}

// ───────────────────────────────────────────── report
const missingChars = report.voice.missing.reduce((s, l) => s + l.text.length, 0);
const summary = {
  generatedAt: new Date().toISOString(),
  voice: VOICE_ID,
  voiceLines: `${report.voice.done.length} / ${catalog.length}`,
  voiceMissing: report.voice.missing.map((l) => `P${l.priority} [${l.where}] ${l.text}`),
  voiceMissingChars: missingChars,
  sfx: `${report.sfx.done.length} / ${SFX.length}`,
  sfxMissing: report.sfx.missing,
  music: `${report.music.done.length} / ${MUSIC.length}`,
  musicMissing: report.music.missing,
  stoppedBy: report.stoppedBy,
};
writeJson(path.join(ROOT, 'public/audio/report.json'), summary);
console.log(`\nACE voice lines: ${summary.voiceLines}${missingChars ? ` (missing ${missingChars} chars → browser voice fallback)` : ''}`);
console.log(`Sound effects:   ${summary.sfx}${report.sfx.missing.length ? ` (missing → synthesised fallback: ${report.sfx.missing.join(', ')})` : ''}`);
console.log(`Music:           ${summary.music}${report.music.missing.length ? ' (missing → procedural score)' : ''}`);
console.log('Report: public/audio/report.json');
