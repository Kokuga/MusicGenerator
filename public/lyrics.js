// Aide à l'écriture des paroles : balises de structure, syllabes, durée estimée.

export const SECTION_TAGS = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro', 'Instrumental'];

// Débit de chant moyen : environ 1,5 syllabe par temps.
const SYLLABLES_PER_BEAT = 1.5;
const VOWEL_GROUP = /[aeiouyàâäéèêëîïôöùûüÿœæ]+/g;

// Insère « [Tag] » sur sa propre ligne à la position du curseur.
export function insertTag(textarea, tag) {
  const { value, selectionStart: pos } = textarea;
  const before = value.slice(0, pos);
  const after = value.slice(pos);
  const prefix = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const insert = `${prefix}[${tag}]\n`;
  textarea.value = before + insert + after;
  textarea.selectionStart = textarea.selectionEnd = pos + insert.length;
  textarea.focus();
  textarea.dispatchEvent(new Event('input'));
}

// Estimation approximative (français / anglais) : groupes de voyelles, « e » muet final retiré.
export function countSyllables(line) {
  let total = 0;
  for (const word of line.toLowerCase().match(/[a-zà-ÿœæ']+/g) ?? []) {
    let n = (word.match(VOWEL_GROUP) ?? []).length;
    if (n > 1 && /[^aeiouy](e|es|ent)$/.test(word)) n--;
    total += Math.max(n, 1);
  }
  return total;
}

// Lignes chantées = lignes non vides hors balises [..].
export function analyzeLyrics(text, bpm, duration) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !/^\[.*\]$/.test(l));
  const counts = lines.map(countSyllables);
  const syllables = counts.reduce((a, b) => a + b, 0);
  const singSeconds = bpm > 0 ? Math.round(syllables / (SYLLABLES_PER_BEAT * bpm / 60)) : 0;
  let warning = '';
  if (lines.length && singSeconds > duration * 0.85) {
    warning = 'paroles probablement trop longues pour la durée : allongez le morceau ou coupez des couplets';
  } else if (lines.length && singSeconds < duration * 0.25) {
    warning = 'beaucoup de place pour l\'instrumental : ajoutez des paroles si vous voulez plus de chant';
  }
  return { lines: lines.length, syllables, maxLine: Math.max(0, ...counts), singSeconds, warning };
}
