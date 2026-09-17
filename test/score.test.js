/**
 * Tests de la partition. Elle alimente a la fois le synthetiseur du navigateur
 * et le fichier MIDI : une erreur de duree se verrait donc aux deux endroits,
 * et une boucle mal alignee s'entendrait a chaque repetition.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BASS, BASS_BEATS, MELODY, TOTAL_BEATS, toEvents, toFrequency, toMidi } from '../src/audio/score.js';

describe('notes', () => {
  it('convertit les noms en numeros MIDI', () => {
    assert.equal(toMidi('A4'), 69);
    assert.equal(toMidi('C4'), 60);
    assert.equal(toMidi('C5'), 72);
    assert.equal(toMidi('G#4'), 68);
    assert.equal(toMidi('E2'), 40);
  });

  it('donne 440 Hz pour le la du diapason', () => {
    assert.equal(Math.round(toFrequency('A4')), 440);
    assert.equal(Math.round(toFrequency('A5')), 880);
  });

  it('refuse un nom invalide', () => {
    assert.throws(() => toMidi('H4'));
  });
});

describe('partition', () => {
  it('tombe sur un nombre entier de mesures a 4 temps', () => {
    assert.equal(TOTAL_BEATS % 4, 0);
  });

  it('n a que des durees positives', () => {
    for (const [, beats] of MELODY) assert.ok(beats > 0);
  });

  it('aligne la basse sur la duree exacte de la boucle', () => {
    // Sinon la basse decalerait un peu plus a chaque repetition.
    assert.equal(BASS.length * BASS_BEATS, TOTAL_BEATS);
  });
});

describe('deroulement', () => {
  const events = toEvents();

  it('est trie par date', () => {
    for (let i = 1; i < events.length; i++) {
      assert.ok(events[i].beat >= events[i - 1].beat);
    }
  });

  it('tient entierement dans la boucle', () => {
    for (const event of events) {
      assert.ok(event.beat >= 0);
      assert.ok(event.beat + event.beats <= TOTAL_BEATS + 1e-9);
    }
  });

  it('contient les deux voix', () => {
    const voices = new Set(events.map((event) => event.voice));
    assert.deepEqual([...voices].sort(), ['bass', 'melody']);
  });

  it('ne garde que des notes jouables', () => {
    for (const event of events) {
      const pitch = toMidi(event.name);
      assert.ok(pitch > 0 && pitch < 128);
    }
  });
});
