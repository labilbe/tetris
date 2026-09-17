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
  resume: document.getElementById('resume'),
  restart: document.getElementById('restart'),
});

const music = createMusic();

const ghostCheckbox = document.getElementById('ghost');
const musicCheckbox = document.getElementById('music');
const menu = document.getElementById('menu');
const game = document.querySelector('.game');

/**
 * Met le jeu a l'echelle de la place disponible.
 *
 * La taille du plateau est fixe (10 x 20 cases de 30 px) ; sur un ecran court
 * — un portable en mise a l'echelle Windows, par exemple — la boite depasserait
 * et le bas serait coupe. On la reduit donc plutot que de la rogner.
 */
function fitToViewport() {
  // offsetWidth et offsetHeight sont des mesures de mise en page : la
  // transformation ne les affecte pas, donc pas de boucle de retroaction.
  const { offsetWidth: width, offsetHeight: height } = game;
  if (!width || !height) return;

  const marge = 16;
  const fit = Math.min(
    1,
    (window.innerWidth - marge) / width,
    (window.innerHeight - marge) / height,
  );
  game.style.setProperty('--fit', fit);
}

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
document.getElementById('resume').addEventListener('click', () => dispatch({ type: 'resume' }));

ghostCheckbox.addEventListener('change', () => setGhostVisible(ghostCheckbox.checked));
musicCheckbox.addEventListener('change', () => setMusicEnabled(musicCheckbox.checked));

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

window.addEventListener('resize', fitToViewport);
fitToViewport();

// Valeurs par defaut pour un nouveau joueur : un choix deja enregistre l'emporte.
setGhostVisible(readPreference(GHOST_PREFERENCE, true));
setMusicEnabled(readPreference(MUSIC_PREFERENCE, true));
