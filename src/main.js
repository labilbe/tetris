/**
 * Cablage : c'est le seul module qui connait a la fois le DOM, l'horloge et le
 * moteur. Il tient la boucle de temps et fait circuler les actions.
 */

import { randomSeed } from './engine/rng.js';
import { createState, reduce, tick } from './engine/state.js';
import { createKeyboardInput } from './input/keyboard.js';
import { createLocalTransport } from './net/transport.js';
import { createRenderer } from './render/canvas.js';
import { createHud } from './render/hud.js';

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
  renderer.draw(state);
  hud.update(state);
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

createKeyboardInput(dispatch);

const { seed } = await transport.start();
state = createState(seed);
render();
requestAnimationFrame(loop);
