/**
 * Stable id for a spoken line: FNV-1a of the normalised text. The audio generator
 * (scripts/gen-audio.mjs) uses the same function, so editing a line's text simply
 * makes it fall back to the browser voice until the audio is regenerated.
 */
export function voiceId(text: string) {
  const s = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
