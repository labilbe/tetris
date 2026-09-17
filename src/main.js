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

const transport = createLocalTransport();

const music = createMusic({ src: 'assets/level-up.mp3' });

const ghostCheckbox = document.getElementById('ghost');
const musicCheckbox = document.getElementById('music');

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
let lastTime = null;

/** Envoie une action : en reseau elle repassera par le serveur avant d'etre appliquee. */
function dispatch(action) {
  transport.send(action);
}

transport.onAction((action) => {
  state = reduce(state, action);
  render();
});

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

// L'onglet en arriere-plan gele requestAnimationFrame : on repart d'une base
// propre au retour plutot que de rattraper le temps perdu d'un coup.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) lastTime = null;
});

document.getElementById('toggle').addEventListener('click', () => dispatch({ type: 'togglePause' }));
document.getElementById('restart').addEventListener('click', () => dispatch({ type: 'reset', seed: randomSeed() }));

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

setGhostVisible(readPreference(GHOST_PREFERENCE, false));
setMusicEnabled(readPreference(MUSIC_PREFERENCE, true));

const { seed } = await transport.start();
state = createState(seed);
render();
requestAnimationFrame(loop);
