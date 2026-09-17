/**
 * Lecteur de fichier MIDI (Standard MIDI File, formats 0 et 1).
 *
 * Les navigateurs ne lisent pas le MIDI : ce module traduit le fichier en une
 * liste de notes datees en secondes, que le synthetiseur Web Audio joue ensuite
 * (src/audio/music.js). Aucune dependance, et rien de specifique au navigateur :
 * il tourne aussi sous Node, ce qui le rend testable sur le vrai fichier.
 */

const HEADER = 0x4d546864; // "MThd"
const TRACK = 0x4d54726b; // "MTrk"

const DEFAULT_TEMPO = 500000; // microsecondes par noire, soit 120 bpm

/**
 * @typedef {{ time: number, duration: number, midi: number, velocity: number, channel: number }} MidiNote
 * @typedef {{ notes: MidiNote[], duration: number, division: number, format: number, trackCount: number }} MidiSong
 */

class Reader {
  constructor(view) {
    this.view = view;
    this.pos = 0;
  }

  uint8() {
    return this.view.getUint8(this.pos++);
  }

  uint16() {
    const value = this.view.getUint16(this.pos);
    this.pos += 2;
    return value;
  }

  uint32() {
    const value = this.view.getUint32(this.pos);
    this.pos += 4;
    return value;
  }

  /** Entier en longueur variable : 7 bits utiles par octet, bit de poids fort = suite. */
  variableLength() {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.uint8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error('Entier de longueur variable trop long');
  }
}

/** Lit une piste et renvoie ses evenements dates en ticks absolus. */
function readTrack(reader, end) {
  const events = [];
  let tick = 0;
  let runningStatus = 0;

  while (reader.pos < end) {
    tick += reader.variableLength();

    let status = reader.view.getUint8(reader.pos);
    if (status < 0x80) {
      // Status courant omis : on reprend celui du message precedent.
      status = runningStatus;
      if (!status) throw new Error('Status courant absent en debut de piste');
    } else {
      reader.pos++;
      runningStatus = status;
    }

    if (status === 0xff) {
      const type = reader.uint8();
      const length = reader.variableLength();
      if (type === 0x51 && length === 3) {
        const a = reader.uint8();
        const b = reader.uint8();
        const c = reader.uint8();
        events.push({ tick, kind: 'tempo', microsecondsPerQuarter: (a << 16) | (b << 8) | c });
      } else {
        reader.pos += length;
      }
      // Les meta-evenements n'entretiennent pas le status courant.
      runningStatus = 0;
      continue;
    }

    if (status === 0xf0 || status === 0xf7) {
      reader.pos += reader.variableLength();
      runningStatus = 0;
      continue;
    }

    const command = status & 0xf0;
    const channel = status & 0x0f;

    switch (command) {
      case 0x80: {
        const midi = reader.uint8();
        reader.uint8();
        events.push({ tick, kind: 'off', channel, midi });
        break;
      }
      case 0x90: {
        const midi = reader.uint8();
        const velocity = reader.uint8();
        // Une note-on de velocite nulle est un note-off deguise.
        events.push({ tick, kind: velocity === 0 ? 'off' : 'on', channel, midi, velocity });
        break;
      }
      case 0xa0:
      case 0xb0:
      case 0xe0:
        reader.pos += 2;
        break;
      case 0xc0:
      case 0xd0:
        reader.pos += 1;
        break;
      default:
        throw new Error(`Message MIDI inconnu : 0x${status.toString(16)}`);
    }
  }

  reader.pos = end;
  return events;
}

/**
 * Convertit les ticks en secondes en suivant les changements de tempo.
 * @param {{tick: number, microsecondsPerQuarter: number}[]} tempoChanges tries par tick
 * @param {number} division ticks par noire
 */
function createTimeline(tempoChanges, division) {
  // Points d'ancrage : (tick, seconde, tempo en vigueur a partir de la).
  const anchors = [{ tick: 0, seconds: 0, microsecondsPerQuarter: DEFAULT_TEMPO }];

  for (const change of tempoChanges) {
    const last = anchors[anchors.length - 1];
    if (change.tick === last.tick) {
      last.microsecondsPerQuarter = change.microsecondsPerQuarter;
      continue;
    }
    const elapsed = ((change.tick - last.tick) / division) * (last.microsecondsPerQuarter / 1e6);
    anchors.push({
      tick: change.tick,
      seconds: last.seconds + elapsed,
      microsecondsPerQuarter: change.microsecondsPerQuarter,
    });
  }

  return (tick) => {
    let anchor = anchors[0];
    for (const candidate of anchors) {
      if (candidate.tick > tick) break;
      anchor = candidate;
    }
    return anchor.seconds + ((tick - anchor.tick) / division) * (anchor.microsecondsPerQuarter / 1e6);
  };
}

/**
 * @param {ArrayBuffer} buffer contenu du fichier .mid
 * @returns {MidiSong}
 */
export function parseMidi(buffer) {
  const reader = new Reader(new DataView(buffer));

  if (reader.uint32() !== HEADER) throw new Error('En-tete MThd absent : ce n est pas un fichier MIDI');
  const headerLength = reader.uint32();
  const format = reader.uint16();
  const trackCount = reader.uint16();
  const division = reader.uint16();
  reader.pos += headerLength - 6; // en-tete plus long que prevu : on ignore le surplus

  if (division & 0x8000) throw new Error('Division SMPTE non geree');
  if (division === 0) throw new Error('Division nulle');

  const events = [];
  for (let index = 0; index < trackCount && reader.pos < reader.view.byteLength; index++) {
    if (reader.uint32() !== TRACK) throw new Error(`En-tete MTrk absent pour la piste ${index}`);
    const length = reader.uint32();
    events.push(...readTrack(reader, reader.pos + length));
  }

  // Tri stable par tick : l'ordre d'origine departage les evenements simultanes.
  const indexed = events.map((event, order) => ({ event, order }));
  indexed.sort((a, b) => a.event.tick - b.event.tick || a.order - b.order);

  const tempoChanges = indexed
    .filter(({ event }) => event.kind === 'tempo')
    .map(({ event }) => ({ tick: event.tick, microsecondsPerQuarter: event.microsecondsPerQuarter }));

  const toSeconds = createTimeline(tempoChanges, division);

  /** @type {MidiNote[]} */
  const notes = [];
  /** @type {Map<string, {tick: number, velocity: number}[]>} */
  const pending = new Map();

  for (const { event } of indexed) {
    if (event.kind === 'on') {
      const key = `${event.channel}:${event.midi}`;
      if (!pending.has(key)) pending.set(key, []);
      pending.get(key).push({ tick: event.tick, velocity: event.velocity });
      continue;
    }
    if (event.kind !== 'off') continue;

    const key = `${event.channel}:${event.midi}`;
    const stack = pending.get(key);
    if (!stack || stack.length === 0) continue; // note-off orphelin : ignore
    const start = stack.shift();
    const time = toSeconds(start.tick);
    notes.push({
      time,
      duration: Math.max(toSeconds(event.tick) - time, 0.02),
      midi: event.midi,
      velocity: start.velocity,
      channel: event.channel,
    });
  }

  notes.sort((a, b) => a.time - b.time);

  const lastTick = indexed.length === 0 ? 0 : indexed[indexed.length - 1].event.tick;
  const duration = Math.max(
    toSeconds(lastTick),
    ...notes.map((note) => note.time + note.duration),
    0,
  );

  return { notes, duration, division, format, trackCount };
}

/** Frequence en hertz d'un numero de note MIDI (69 = la 440). */
export function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}
