/**
 * Korobeiniki : chanson populaire russe de 1861, dans le domaine public, et
 * melodie reprise comme theme de Tetris.
 *
 * C'est la melodie traditionnelle qui est notee ici, avec une basse simple
 * ecrite pour ce projet. Ce n'est pas une transcription de l'arrangement Game
 * Boy, qui appartient a son editeur.
 *
 * Source unique : ce fichier alimente a la fois le synthetiseur du navigateur
 * (src/audio/music.js) et le generateur de fichier MIDI (tools/generate-midi.js).
 * Les durees sont en temps (1 = une noire).
 */

export const TEMPO_BPM = 150;

/** Silence : note a null. */
const A = [
  ['E5', 1], ['B4', 0.5], ['C5', 0.5], ['D5', 1], ['C5', 0.5], ['B4', 0.5],
  ['A4', 1], ['A4', 0.5], ['C5', 0.5], ['E5', 1], ['D5', 0.5], ['C5', 0.5],
  ['B4', 1.5], ['C5', 0.5], ['D5', 1], ['E5', 1],
  ['C5', 1], ['A4', 1], ['A4', 2],
];

const B = [
  [null, 0.5], ['D5', 1], ['F5', 0.5], ['A5', 1], ['G5', 0.5], ['F5', 0.5],
  ['E5', 1.5], ['C5', 0.5], ['E5', 1], ['D5', 0.5], ['C5', 0.5],
  ['B4', 1], ['B4', 0.5], ['C5', 0.5], ['D5', 1], ['E5', 1],
  ['C5', 1], ['A4', 1], ['A4', 2],
];

/** Section en tenues longues, de caractere plus large. */
const C = [
  ['E5', 2], ['C5', 2], ['D5', 2], ['B4', 2],
  ['C5', 2], ['A4', 2], ['G#4', 2], ['B4', 2],
  ['E5', 2], ['C5', 2], ['D5', 2], ['B4', 2],
  ['C5', 1], ['E5', 1], ['A5', 2], ['G#5', 4],
];

export const MELODY = [...A, ...B, ...C];

/** Une fondamentale toutes les deux noires, harmonisation en mi mineur. */
export const BASS = [
  'E2', 'E2', 'A2', 'A2', 'E2', 'E2', 'B2', 'E2',
  'D3', 'D3', 'C3', 'C3', 'B2', 'B2', 'E2', 'E2',
  'E2', 'C3', 'D3', 'B2', 'C3', 'A2', 'G#2', 'B2',
  'E2', 'C3', 'D3', 'B2', 'C3', 'E2', 'A2', 'E2',
];

export const BASS_BEATS = 2;

/** Duree d'une boucle complete, en temps. */
export const TOTAL_BEATS = MELODY.reduce((total, [, beats]) => total + beats, 0);

const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Nom de note anglo-saxon vers numero MIDI (C4 = 60, A4 = 69). */
export function toMidi(name) {
  const match = /^([A-G])(#|b?)(-?\d)$/.exec(name);
  if (!match) throw new Error(`Note invalide : ${name}`);
  const [, letter, accidental, octave] = match;
  const offset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return (Number(octave) + 1) * 12 + SEMITONES[letter] + offset;
}

export function toFrequency(name) {
  return 440 * 2 ** ((toMidi(name) - 69) / 12);
}

/**
 * Deroule la partition en evenements dates, en temps depuis le debut de boucle.
 * @returns {{ beat: number, name: string, beats: number, voice: 'melody'|'bass' }[]}
 */
export function toEvents() {
  const events = [];

  let beat = 0;
  for (const [name, beats] of MELODY) {
    if (name) events.push({ beat, name, beats, voice: 'melody' });
    beat += beats;
  }

  BASS.forEach((name, index) => {
    const start = index * BASS_BEATS;
    if (start < TOTAL_BEATS) {
      events.push({ beat: start, name, beats: BASS_BEATS, voice: 'bass' });
    }
  });

  return events.sort((a, b) => a.beat - b.beat);
}
