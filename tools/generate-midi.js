/**
 * Genere assets/korobeiniki.mid a partir de la partition partagee.
 *
 *   node tools/generate-midi.js
 *
 * Le navigateur ne lit pas le MIDI nativement : en jeu, la meme partition est
 * jouee par synthese Web Audio (src/audio/music.js). Ce fichier existe pour
 * avoir la musique dans un format ouvert, ouvrable par n'importe quel sequenceur.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEMPO_BPM, TOTAL_BEATS, toEvents, toMidi } from '../src/audio/score.js';

const TPQN = 480; // ticks par noire

const CHANNELS = { melody: 0, bass: 1 };
const PROGRAMS = { melody: 80, bass: 38 }; // lead carre, basse synthetique
const VELOCITIES = { melody: 100, bass: 70 };

/** Entier en longueur variable, comme l'exige le format MIDI pour les deltas. */
function variableLength(value) {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

function chunk(id, payload) {
  const header = Buffer.alloc(8);
  header.write(id, 0, 'ascii');
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function build() {
  const microsecondsPerQuarter = Math.round(60000000 / TEMPO_BPM);

  /** @type {{ tick: number, order: number, data: number[] }[]} */
  const midiEvents = [
    {
      tick: 0,
      order: 0,
      data: [
        0xff, 0x51, 0x03,
        (microsecondsPerQuarter >> 16) & 0xff,
        (microsecondsPerQuarter >> 8) & 0xff,
        microsecondsPerQuarter & 0xff,
      ],
    },
    { tick: 0, order: 1, data: [0xc0 | CHANNELS.melody, PROGRAMS.melody] },
    { tick: 0, order: 2, data: [0xc0 | CHANNELS.bass, PROGRAMS.bass] },
  ];

  let order = 3;
  for (const event of toEvents()) {
    const channel = CHANNELS[event.voice];
    const pitch = toMidi(event.name);
    const start = Math.round(event.beat * TPQN);
    // Legerement detache : la note s'arrete un peu avant la suivante.
    const length = Math.max(Math.round(event.beats * TPQN) - 20, 40);

    midiEvents.push({ tick: start, order: order++, data: [0x90 | channel, pitch, VELOCITIES[event.voice]] });
    midiEvents.push({ tick: start + length, order: order++, data: [0x80 | channel, pitch, 0] });
  }

  // Tri par date, puis par ordre d'insertion pour rester deterministe.
  midiEvents.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const bytes = [];
  let previous = 0;
  for (const event of midiEvents) {
    bytes.push(...variableLength(event.tick - previous), ...event.data);
    previous = event.tick;
  }

  const end = Math.round(TOTAL_BEATS * TPQN);
  bytes.push(...variableLength(Math.max(end - previous, 0)), 0xff, 0x2f, 0x00);

  const header = Buffer.alloc(6);
  header.writeUInt16BE(0, 0); // format 0 : piste unique
  header.writeUInt16BE(1, 2);
  header.writeUInt16BE(TPQN, 4);

  return Buffer.concat([chunk('MThd', header), chunk('MTrk', Buffer.from(bytes))]);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'assets', 'korobeiniki.mid');
mkdirSync(dirname(target), { recursive: true });
const file = build();
writeFileSync(target, file);
console.log(`Ecrit ${target} (${file.length} octets, ${TOTAL_BEATS} temps a ${TEMPO_BPM} bpm)`);
