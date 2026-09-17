/**
 * Musique de fond : lecture de assets/korobeiniki.mid.
 *
 * Les navigateurs ne lisent pas le MIDI nativement. Le fichier est donc analyse
 * (src/audio/midi.js) puis joue par un petit synthetiseur Web Audio : onde
 * triangulaire pour les basses, carree pour le reste, et bruit filtre pour la
 * piste rythmique, ecrite tres au-dessus de l'ambitus musical comme c'est
 * l'usage dans ce genre de fichier.
 *
 * Couche locale au meme titre que le rendu : elle observe l'etat du jeu mais ne
 * le modifie jamais, et rien de ce qu'elle fait ne transite par le reseau.
 *
 * Deblocage du son : un navigateur refuse de demarrer l'audio tant que le
 * joueur n'a pas interagi. La regle pratique est que resume() doit partir
 * directement du gestionnaire de l'evenement, sans await avant lui : une
 * attente intercalee (charger le fichier, par exemple) fait sortir l'appel de
 * la tache du geste et le navigateur le refuse. Tout ce qui attend est donc
 * repousse apres resume().
 */

import { STATUS } from '../engine/constants.js';
import { midiToFrequency, parseMidi } from './midi.js';

const LOOKAHEAD_MS = 25; // frequence de reveil du planificateur
const SCHEDULE_AHEAD = 0.3; // on programme les notes jusqu'a 300 ms en avance
const LOOP_GAP = 0.4; // respiration entre deux passages

/** Au-dessus de cette hauteur, la note n'est plus musicale : c'est la rythmique. */
const PERCUSSION_THRESHOLD = 108;

const GESTURES = ['pointerdown', 'keydown', 'touchstart'];

/**
 * @param {object} [options]
 * @param {string} [options.src]
 * @param {number} [options.volume] entre 0 et 1
 */
export function createMusic({ src = 'assets/korobeiniki.mid', volume = 0.5 } = {}) {
  /** @type {AudioContext | null} */
  let context = null;
  let master = null;
  let noiseBuffer = null;
  let timer = null;

  /** @type {import('./midi.js').MidiSong | null} */
  let song = null;
  let loading = null;

  let enabled = false;
  let wanted = false; // la musique devrait-elle jouer, au vu de l'etat du jeu
  let armed = false; // en attente d'un geste pour debloquer le son

  let loopStart = 0; // date de debut du passage en cours, dans l'horloge audio
  let cursor = 0; // prochaine note a programmer

  function loadSong() {
    if (song) return Promise.resolve(song);
    if (!loading) {
      loading = fetch(src)
        .then((response) => {
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
          return response.arrayBuffer();
        })
        .then((buffer) => {
          song = parseMidi(buffer);
          return song;
        })
        .catch((error) => {
          // Sans musique le jeu reste parfaitement jouable : on n'interrompt rien.
          console.warn(`Musique indisponible (${src}) :`, error.message);
          loading = null;
          return null;
        });
    }
    return loading;
  }

  function ensureContext() {
    if (context) return context;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    context = new AudioContextClass();

    // Le fichier monte jusqu'a une dizaine de voix simultanees : sans
    // compresseur, les accords saturent alors que les notes seules sont faibles.
    const compressor = context.createDynamicsCompressor();
    master = context.createGain();
    master.gain.value = volume;
    master.connect(compressor);
    compressor.connect(context.destination);

    const length = Math.floor(context.sampleRate * 0.2);
    noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) channel[i] = Math.random() * 2 - 1;

    return context;
  }

  function playPercussion(note, when) {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;

    const filter = context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;

    const gain = context.createGain();
    const duration = 0.05;
    const peak = (note.velocity / 127) * 0.12;

    gain.gain.setValueAtTime(peak, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(when);
    source.stop(when + duration);
  }

  function playTone(note, when) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    const isBass = note.midi < 55;
    oscillator.type = isBass ? 'triangle' : 'square';
    oscillator.frequency.value = midiToFrequency(note.midi);

    const duration = Math.max(note.duration * 0.9, 0.05);
    const peak = (note.velocity / 127) * (isBass ? 0.22 : 0.1);

    // Rampes exponentielles : une coupure nette produirait un clic audible.
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
  }

  function schedule() {
    if (!song || song.notes.length === 0) return;

    const horizon = context.currentTime + SCHEDULE_AHEAD;
    const loopLength = song.duration + LOOP_GAP;

    while (loopStart + song.notes[cursor].time < horizon) {
      const note = song.notes[cursor];
      const when = loopStart + note.time;
      if (note.midi > PERCUSSION_THRESHOLD) playPercussion(note, when);
      else playTone(note, when);

      cursor++;
      if (cursor === song.notes.length) {
        cursor = 0;
        loopStart += loopLength;
      }
    }
  }

  function startScheduler() {
    if (timer !== null) return;
    schedule();
    timer = setInterval(schedule, LOOKAHEAD_MS);
  }

  function stopScheduler() {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  function disarm() {
    if (!armed) return;
    armed = false;
    for (const type of GESTURES) document.removeEventListener(type, onGesture, true);
  }

  /**
   * Premier geste du joueur : on debloque le contexte audio ici meme, sans rien
   * attendre avant resume(). Le reste (charger le fichier, programmer les
   * notes) se fait ensuite, une fois le son autorise.
   */
  function onGesture() {
    ensureContext();
    context.resume().then(() => {
      if (context.state !== 'running') return; // toujours refuse : on reste arme
      disarm();
      apply();
    });
  }

  function arm() {
    if (armed) return;
    armed = true;
    // En phase de capture : le deblocage ne depend pas des gestionnaires du jeu.
    for (const type of GESTURES) document.addEventListener(type, onGesture, true);
  }

  async function apply() {
    if (!enabled || !wanted) {
      stopScheduler();
      // suspend() gele l'horloge audio : la reprise repart exactement d'ou
      // la musique s'etait arretee, sans recalculer la position dans le morceau.
      if (context && context.state === 'running') await context.suspend();
      return;
    }

    ensureContext();

    if (context.state !== 'running') {
      arm(); // le son reste bloque jusqu'au prochain geste
      await context.resume();
      if (context.state !== 'running') return;
      disarm();
    }

    if (!(await loadSong())) return;
    if (!enabled || !wanted) return; // l'etat a pu changer pendant le chargement

    if (loopStart === 0) loopStart = context.currentTime + 0.1;
    startScheduler();
  }

  return {
    setEnabled(value) {
      enabled = value;
      // Le fichier est charge des l'activation : il n'est ainsi plus dans le
      // chemin critique au moment du geste qui debloque le son.
      if (value) loadSong();
      apply();
    },

    isEnabled() {
      return enabled;
    },

    /**
     * Cale la musique sur l'etat du jeu : elle s'arrete en pause et en fin de
     * partie, et reprend la ou elle en etait.
     * @param {import('../engine/state.js').GameState} state
     */
    sync(state) {
      const next = state.status === STATUS.PLAYING;
      if (next === wanted) return;
      wanted = next;
      apply();
    },
  };
}
