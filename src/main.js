/**
 * Cablage : c'est le seul module qui connait a la fois le DOM, l'horloge et le
 * moteur. Il tient la boucle de temps et fait circuler les actions.
 */

import { createMusic } from './audio/music.js';
import { randomSeed } from './engine/rng.js';
import { createState, reduce, tick } from './engine/state.js';
import { createKeyboardInput } from './input/keyboard.js';
import { createLocalTransport } from './net/transport.js';
import { createRenderer } from './render/canvas.js';
import { createHud } from './render/hud.js';
import { readPreference, writePreference } from './view/preferences.js';

const renderer = createRenderer({
  board: document.getElementById('board'),
  next: document.getElementById('next'),
});

const hud = createHud({
  score: document.getElementById('score'),
  lines: document.getElementById('lines'),
  level: document.getElementById('level'),
  toggle: document.getElementById('toggle'),
  overlay: document.getElementById('overlay'),
  overlayText: document.getElementById('overlay-text'),
});

const music = createMusic();

const ghostCheckbox = document.getElementById('ghost');
const musicCheckbox = document.getElementById('music');
const musicStatus = document.getElementById('music-status');
const menu = document.getElementById('menu');

const GHOST_PREFERENCE = 'tetris.ghost';
const MUSIC_PREFERENCE = 'tetris.music';

function setGhostVisible(visible) {
  renderer.setGhostVisible(visible);
  ghostCheckbox.checked = visible;
  writePreference(GHOST_PREFERENCE, visible);
  render();
}

function setMusicEnabled(enabled) {
  music.setEnabled(enabled);
  musicCheckbox.checked = enabled;
  writePreference(MUSIC_PREFERENCE, enabled);
  updateMusicStatus();
}

/**
 * Affiche l'etat du son quand il ne joue pas. Un navigateur qui bloque l'audio
 * le fait silencieusement : sans ce retour, le blocage est indiscernable d'un
 * bug, aussi bien pour le joueur que pour le diagnostic.
 */
function updateMusicStatus() {
  const status = music.getStatus();
  let text = '';

  if (status.enabled && !status.scheduling) {
    if (status.contextState === 'running' && status.notes === 0) {
      text = 'Chargement de la musique…';
    } else if (status.contextState !== 'running') {
      // Le navigateur exige un geste avant d'autoriser le son : sans ce
      // message, le silence initial passe pour une panne.
      text = '▶ Appuyez sur une touche, ou cliquez ici, pour activer le son';
    }
  }

  if (status.lastError) text += ` (${status.lastError})`;

  if (text === musicStatus.textContent) return;
  musicStatus.textContent = text;
  musicStatus.hidden = text === '';
}

/** @type {import('./engine/state.js').GameState} */
let state;
/** @type {ReturnType<typeof createLocalTransport> | null} */
let transport = null;
let lastTime = null;
let looping = false;

/** Envoie une action : en reseau elle repassera par le serveur avant d'etre appliquee. */
function dispatch(action) {
  if (!transport) return; // encore au menu : il n'y a pas de partie a piloter
  transport.send(action);
}

function render() {
  if (!state) return; // avant le demarrage du transport, il n'y a rien a dessiner
  renderer.draw(state);
  hud.update(state);
  music.sync(state);
  updateMusicStatus();
}

function loop(time) {
  // Premiere frame : pas de delta de reference, on se contente d'amorcer.
  const delta = lastTime === null ? 0 : time - lastTime;
  lastTime = time;

  state = tick(state, delta);
  render();

  requestAnimationFrame(loop);
}

/**
 * Demarre une partie depuis le menu.
 *
 * Le clic qui declenche cette fonction est aussi le geste que le navigateur
 * exige pour autoriser le son : c'est pour cela que la musique part en meme
 * temps que la partie, sans rien demander de plus au joueur.
 *
 * @param {'solo'} mode le multijoueur attend son serveur
 */
async function startGame(mode) {
  music.unlock();

  menu.hidden = true;

  // Le mode choisit le transport, et rien d'autre : le reste du jeu ignore
  // s'il joue en solo ou en reseau.
  transport = createLocalTransport();
  transport.onAction((action) => {
    state = reduce(state, action);
    render();
  });

  const { seed } = await transport.start();
  state = createState(seed);
  lastTime = null;
  render();

  if (!looping) {
    looping = true;
    requestAnimationFrame(loop);
  }
}

// L'onglet en arriere-plan gele requestAnimationFrame : on repart d'une base
// propre au retour plutot que de rattraper le temps perdu d'un coup.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) lastTime = null;
});

document.getElementById('toggle').addEventListener('click', () => dispatch({ type: 'togglePause' }));
document.getElementById('restart').addEventListener('click', () => dispatch({ type: 'reset', seed: randomSeed() }));

ghostCheckbox.addEventListener('change', () => setGhostVisible(ghostCheckbox.checked));
musicCheckbox.addEventListener('change', () => setMusicEnabled(musicCheckbox.checked));

// Deblocage explicite : le clic est le geste que les navigateurs acceptent le
// plus surement pour autoriser l'audio.
musicStatus.addEventListener('click', () => {
  music.unlock();
  updateMusicStatus();
});

createKeyboardInput({
  onGameAction: dispatch,
  // Les actions locales restent ici : les envoyer au transport les diffuserait
  // aux autres joueurs, ce qui n'aurait aucun sens pour un reglage personnel.
  onViewAction: (action) => {
    if (action.type === 'toggleGhost') setGhostVisible(!renderer.isGhostVisible());
    if (action.type === 'toggleMusic') setMusicEnabled(!music.isEnabled());
  },
});

document.getElementById('play-solo').addEventListener('click', () => startGame('solo'));

setGhostVisible(readPreference(GHOST_PREFERENCE, false));
setMusicEnabled(readPreference(MUSIC_PREFERENCE, true));
