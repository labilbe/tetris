/**
 * Cablage : c'est le seul module qui connait a la fois le DOM, l'horloge et le
 * moteur. Il tient la boucle de temps et fait circuler les actions.
 */

import { createMusic } from './audio/music.js';
import { STATUS } from './engine/constants.js';
import { randomSeed } from './engine/rng.js';
import { createState, reduce, tick } from './engine/state.js';
import { createKeyboardInput } from './input/keyboard.js';
import { createLocalTransport, createWebSocketTransport } from './net/transport.js';
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
  toMenu: document.getElementById('to-menu'),
});

const music = createMusic();

const ghostCheckbox = document.getElementById('ghost');
const musicCheckbox = document.getElementById('music');
const menu = document.getElementById('menu');
const menuError = document.getElementById('menu-error');
const waiting = document.getElementById('waiting');
const waitingText = document.getElementById('waiting-text');
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
/** Resultat d'une partie en reseau : 'won', 'lost', ou null tant qu'elle dure. */
let outcome = null;
let overReported = false;

/** Envoie une action : en reseau elle repassera par le serveur avant d'etre appliquee. */
function dispatch(action) {
  if (!transport) return; // encore au menu : il n'y a pas de partie a piloter
  if (outcome) return; // la partie en reseau est jouee, le verdict est tombe
  transport.send(action);
}

function render() {
  if (!state) return; // avant le demarrage du transport, il n'y a rien a dessiner
  renderer.draw(state);
  hud.update(state, outcome);
  // Le verdict arrete la musique comme le ferait une fin de partie.
  music.sync(outcome ? { ...state, status: STATUS.OVER } : state);

  // Sa propre defaite met fin a la partie des deux joueurs : on la signale une
  // seule fois, le serveur designant le perdant au premier signalement recu.
  if (state.status === STATUS.OVER && !overReported && transport) {
    overReported = true;
    transport.reportGameOver();
  }
}

function loop(time) {
  // Premiere frame : pas de delta de reference, on se contente d'amorcer.
  const delta = lastTime === null ? 0 : time - lastTime;
  lastTime = time;

  // Pas de partie en cours (menu, attente, verdict tombe) : le temps ne doit
  // pas avancer, sinon les pieces tomberaient derriere l'ecran affiche.
  if (state && transport && !outcome) {
    state = tick(state, delta);
    render();
  }

  requestAnimationFrame(loop);
}

/** Adresse du serveur de jeu, sur la machine qui sert la page. */
function serverUrl() {
  return `ws://${location.hostname}:1985`;
}

/** Messages du serveur qui concernent l'attente et la connexion, pas le jeu. */
function onNetworkStatus(status) {
  switch (status.kind) {
    case 'waiting':
      waitingText.textContent = `En attente d'un adversaire… (${status.players}/${status.capacity})`;
      break;
    case 'finished':
      // Le premier joueur a perdre met fin a la partie des deux.
      outcome = status.self ? 'lost' : 'won';
      render();
      break;
    case 'left':
      // Une fois le verdict tombe, le depart de l'adversaire est normal : il
      // ne doit pas effacer le resultat affiche.
      if (!outcome) showMenu("L'adversaire a quitté la partie.");
      break;
    case 'closed':
      if (state) showMenu('La connexion au serveur a été perdue.');
      break;
    default:
      break;
  }
}

function showMenu(message = '') {
  if (transport) {
    transport.close();
    transport = null;
  }
  state = undefined;
  outcome = null;
  overReported = false;
  // Sans cela, « Perdu » resterait affiche sous le menu.
  document.getElementById('overlay').hidden = true;
  waiting.hidden = true;
  menu.hidden = false;
  menuError.textContent = message;
  menuError.hidden = message === '';
}

/**
 * Demarre une partie depuis le menu.
 *
 * Le clic qui declenche cette fonction est aussi le geste que le navigateur
 * exige pour autoriser le son : c'est pour cela que la musique part en meme
 * temps que la partie, sans rien demander de plus au joueur.
 *
 * @param {'solo' | 'multi'} mode
 */
async function startGame(mode) {
  music.unlock();

  menu.hidden = true;
  menuError.hidden = true;
  outcome = null;
  overReported = false;

  // Le mode choisit le transport, et rien d'autre : le reste du jeu ignore
  // s'il joue en solo ou en reseau.
  transport = mode === 'multi'
    ? createWebSocketTransport(serverUrl())
    : createLocalTransport();

  if (mode === 'multi') {
    waiting.hidden = false;
    waitingText.textContent = 'Connexion au serveur…';
    transport.onStatus(onNetworkStatus);
  }

  transport.onAction((action, meta) => {
    // Les actions de l'adversaire arrivent par le meme canal : elles ne doivent
    // pas piloter notre plateau. Son propre plateau viendra a l'etape suivante.
    if (!meta.self) return;
    state = reduce(state, action);
    render();
  });

  const pending = transport;
  let seed;
  try {
    ({ seed } = await transport.start());
  } catch (error) {
    if (transport === pending) showMenu(error.message);
    return;
  }

  waiting.hidden = true;
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
document.getElementById('play-multi').addEventListener('click', () => startGame('multi'));
document.getElementById('waiting-cancel').addEventListener('click', () => showMenu());
document.getElementById('to-menu').addEventListener('click', () => showMenu());

window.addEventListener('resize', fitToViewport);
fitToViewport();

// Valeurs par defaut pour un nouveau joueur : un choix deja enregistre l'emporte.
setGhostVisible(readPreference(GHOST_PREFERENCE, true));
setMusicEnabled(readPreference(MUSIC_PREFERENCE, true));
