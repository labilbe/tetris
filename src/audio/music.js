/**
 * Musique de fond : Korobeiniki, synthetisee en direct par le navigateur.
 *
 * Pourquoi pas le fichier MIDI ? Aucun navigateur ne lit le MIDI nativement ;
 * le jouer supposerait d'embarquer un synthetiseur et une banque de sons. La
 * partition tenant en quelques dizaines de notes, on la joue directement avec
 * Web Audio : deux oscillateurs, un carre pour la melodie et un triangle pour
 * la basse. assets/korobeiniki.mid est genere depuis la meme partition.
 *
 * Couche locale au meme titre que le rendu : elle observe l'etat du jeu mais ne
 * le modifie jamais, et rien de ce qu'elle fait ne transite par le reseau.
 */

import { STATUS } from '../engine/constants.js';
import { TEMPO_BPM, TOTAL_BEATS, toEvents, toFrequency } from './score.js';

const SECONDS_PER_BEAT = 60 / TEMPO_BPM;
const LOOKAHEAD_MS = 25; // frequence de reveil du planificateur
const SCHEDULE_AHEAD = 0.2; // on programme les notes jusqu'a 200 ms en avance
const LEGATO = 0.92; // part de la duree reellement tenue, le reste detache les notes

/**
 * @param {object} [options]
 * @param {number} [options.volume] entre 0 et 1
 */
export function createMusic({ volume = 0.18 } = {}) {
  const events = toEvents();
  const loopSeconds = TOTAL_BEATS * SECONDS_PER_BEAT;

  /** @type {AudioContext | null} */
  let context = null;
  let master = null;
  let timer = null;

  let enabled = false;
  let wanted = false; // la musique devrait-elle jouer, au vu de l'etat du jeu
  let waitingForGesture = false;

  let loopStart = 0; // date de debut de la boucle en cours, dans l'horloge audio
  let cursor = 0; // prochaine note a programmer

  function ensureContext() {
    if (context) return context;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = volume;
    master.connect(context.destination);
    loopStart = context.currentTime + 0.1;
    return context;
  }

  function playTone(event, when) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = event.voice === 'bass' ? 'triangle' : 'square';
    oscillator.frequency.value = toFrequency(event.name);

    const duration = event.beats * SECONDS_PER_BEAT * LEGATO;
    const peak = event.voice === 'bass' ? 0.5 : 0.32;

    // Rampes exponentielles : une coupure nette produirait un clic audible.
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
  }

  function schedule() {
    const horizon = context.currentTime + SCHEDULE_AHEAD;
    while (loopStart + events[cursor].beat * SECONDS_PER_BEAT < horizon) {
      const event = events[cursor];
      playTone(event, loopStart + event.beat * SECONDS_PER_BEAT);
      cursor++;
      if (cursor === events.length) {
        cursor = 0;
        loopStart += loopSeconds; // boucle sans couture
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

  function startOnFirstGesture() {
    if (waitingForGesture) return;
    waitingForGesture = true;
    const resume = () => {
      waitingForGesture = false;
      document.removeEventListener('pointerdown', resume);
      document.removeEventListener('keydown', resume);
      if (enabled && wanted) apply();
    };
    document.addEventListener('pointerdown', resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
  }

  async function apply() {
    if (!enabled || !wanted) {
      stopScheduler();
      // suspend() gele l'horloge audio : la reprise repart exactement d'ou
      // la musique s'etait arretee, sans recalculer la position dans la boucle.
      if (context && context.state === 'running') await context.suspend();
      return;
    }

    ensureContext();
    await context.resume();

    // Sans geste prealable du joueur, le navigateur laisse le contexte suspendu.
    if (context.state !== 'running') {
      startOnFirstGesture();
      return;
    }

    startScheduler();
  }

  return {
    setEnabled(value) {
      enabled = value;
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
