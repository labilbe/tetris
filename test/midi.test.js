/**
 * Tests du lecteur MIDI, sur un fichier fabrique ici (pour les cas precis du
 * format) et sur la bande-son reelle du jeu (pour verifier qu'elle est jouable).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { midiToFrequency, parseMidi } from '../src/audio/midi.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function toArrayBuffer(bytes) {
  return Uint8Array.from(bytes).buffer;
}

function chunk(id, payload) {
  const header = [...id].map((character) => character.charCodeAt(0));
  const length = payload.length;
  return [...header, (length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff, ...payload];
}

/** Fichier minimal : une noire a 120 bpm, division 96. */
function buildSimpleFile(trackBytes) {
  return toArrayBuffer([
    ...chunk('MThd', [0, 0, 0, 1, 0, 96]),
    ...chunk('MTrk', trackBytes),
  ]);
}

describe('frequences', () => {
  it('place le la du diapason a 440 Hz', () => {
    assert.equal(Math.round(midiToFrequency(69)), 440);
    assert.equal(Math.round(midiToFrequency(81)), 880);
    assert.equal(Math.round(midiToFrequency(57)), 220);
  });
});

describe('lecture du format', () => {
  it('apparie note-on et note-off', () => {
    const song = parseMidi(buildSimpleFile([
      0x00, 0x90, 60, 100, // note on immediate
      0x60, 0x80, 60, 0, // note off une noire plus tard (96 ticks)
      0x00, 0xff, 0x2f, 0x00,
    ]));

    assert.equal(song.notes.length, 1);
    assert.equal(song.notes[0].midi, 60);
    assert.equal(song.notes[0].velocity, 100);
    assert.equal(song.notes[0].time, 0);
    // 120 bpm par defaut : une noire dure une demi-seconde.
    assert.ok(Math.abs(song.notes[0].duration - 0.5) < 1e-9);
  });

  it('traite une note-on de velocite nulle comme une note-off', () => {
    const song = parseMidi(buildSimpleFile([
      0x00, 0x90, 64, 80,
      0x60, 0x90, 64, 0,
      0x00, 0xff, 0x2f, 0x00,
    ]));

    assert.equal(song.notes.length, 1);
    assert.ok(Math.abs(song.notes[0].duration - 0.5) < 1e-9);
  });

  it('gere le status courant omis', () => {
    const song = parseMidi(buildSimpleFile([
      0x00, 0x90, 60, 100,
      0x00, 62, 100, // meme status : deuxieme note sans repeter 0x90
      0x60, 0x80, 60, 0,
      0x00, 0x80, 62, 0,
      0x00, 0xff, 0x2f, 0x00,
    ]));

    assert.equal(song.notes.length, 2);
    assert.deepEqual(song.notes.map((note) => note.midi).sort(), [60, 62]);
  });

  it('suit les changements de tempo', () => {
    // 60 bpm : la noire passe a une seconde.
    const song = parseMidi(buildSimpleFile([
      0x00, 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40,
      0x00, 0x90, 60, 100,
      0x60, 0x80, 60, 0,
      0x00, 0xff, 0x2f, 0x00,
    ]));

    assert.ok(Math.abs(song.notes[0].duration - 1) < 1e-9);
  });

  it('ignore un note-off orphelin', () => {
    const song = parseMidi(buildSimpleFile([
      0x00, 0x80, 60, 0,
      0x00, 0xff, 0x2f, 0x00,
    ]));

    assert.equal(song.notes.length, 0);
  });

  it('refuse un fichier qui n en est pas un', () => {
    assert.throws(() => parseMidi(toArrayBuffer([1, 2, 3, 4, 5, 6, 7, 8])));
  });
});

describe('bande-son du jeu', () => {
  const file = readFileSync(join(root, 'assets', 'korobeiniki.mid'));
  const song = parseMidi(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));

  it('se lit entierement', () => {
    assert.equal(song.format, 1);
    assert.ok(song.trackCount > 0);
    assert.ok(song.notes.length > 100);
  });

  it('dure plusieurs dizaines de secondes', () => {
    assert.ok(song.duration > 10, `duree inattendue : ${song.duration}`);
    assert.ok(song.duration < 600);
  });

  it('ne produit que des notes jouables', () => {
    for (const note of song.notes) {
      assert.ok(note.duration > 0);
      assert.ok(note.time >= 0);
      assert.ok(note.midi >= 0 && note.midi < 128);
      assert.ok(note.velocity > 0 && note.velocity < 128);
    }
  });

  it('rend les notes triees par date', () => {
    for (let i = 1; i < song.notes.length; i++) {
      assert.ok(song.notes[i].time >= song.notes[i - 1].time);
    }
  });

  it('tient dans la duree annoncee', () => {
    for (const note of song.notes) {
      assert.ok(note.time + note.duration <= song.duration + 1e-6);
    }
  });
});
