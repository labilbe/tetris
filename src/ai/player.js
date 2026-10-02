/**
 * L'adversaire artificiel : ou poser la piece en cours.
 *
 * Fonctions pures sur un etat de jeu, comme le moteur et la camera : pas
 * d'horloge, pas de reseau, et pas d'autre hasard que celui qu'on lui passe.
 * C'est le pilote (server/bot.js) qui tient le temps et la connexion ; ici on ne
 * fait que juger des plateaux, ce qui rend la politique de jeu testable coup par
 * coup.
 *
 * Elle ne triche pas, et c'est tout l'interet : elle ne voit que son propre
 * etat, et n'agit que par les actions d'un joueur au clavier — tourner,
 * deplacer, lacher. Ce qu'elle exerce est donc exactement le chemin d'un humain,
 * serveur et handicap compris, et pas une simulation a cote du jeu.
 */

import { COLS, ROWS } from '../engine/constants.js';
import { clearLines, collides, merge } from '../engine/state.js';

/**
 * Poids de l'evaluation d'un plateau. Ce sont les quatre mesures classiques,
 * qui suffisent a jouer correctement sans anticiper au-dela de la piece en
 * cours : la hauteur dit le danger, les trous disent le degat irreparable, les
 * bosses disent la difficulte a venir, et les lignes disent le gain.
 *
 * Les trous pesent lourd parce qu'ils sont les seuls degats qu'on ne repare pas
 * en jouant bien : une case couverte le reste jusqu'a ce que la rangee s'efface.
 * Dans cette version du jeu ils pesent meme un peu plus qu'ailleurs, le handicap
 * tombant du haut et coiffant les puits.
 */
export const POIDS = {
  hauteur: -0.51,
  lignes: 0.76,
  trous: -0.36,
  bosses: -0.18,
};

/** Hauteur de chaque colonne, en rangees. */
function hauteurs(grid) {
  const out = new Array(COLS).fill(0);
  for (let x = 0; x < COLS; x++) {
    let y = 0;
    while (y < ROWS && grid[y][x] === null) y++;
    out[x] = ROWS - y;
  }
  return out;
}

/** Cases vides coiffees par une case pleine : le degat qu'on ne repare pas. */
function trous(grid, cols) {
  let total = 0;
  for (let x = 0; x < COLS; x++) {
    for (let y = ROWS - cols[x]; y < ROWS; y++) {
      if (grid[y][x] === null) total++;
    }
  }
  return total;
}

/** Denivele cumule entre colonnes voisines : un relief plat se rejoue mieux. */
function bosses(cols) {
  let total = 0;
  for (let x = 0; x < COLS - 1; x++) total += Math.abs(cols[x] - cols[x + 1]);
  return total;
}

/**
 * Note un plateau deja joue. Plus la note est haute, plus la position est
 * jouable ; les valeurs n'ont pas d'unite, seules leurs comparaisons comptent.
 *
 * @param {(string|null)[][]} grid plateau APRES pose et effacement
 * @param {number} lignes lignes effacees par la pose
 */
export function evaluer(grid, lignes) {
  const cols = hauteurs(grid);
  const total = cols.reduce((somme, h) => somme + h, 0);

  return POIDS.hauteur * total
    + POIDS.lignes * lignes
    + POIDS.trous * trous(grid, cols)
    + POIDS.bosses * bosses(cols);
}

/** Rotation d'une matrice carree, dans le meme sens que le moteur. */
function tourner(cells) {
  const taille = cells.length;
  const out = Array.from({ length: taille }, () => new Array(taille).fill(0));
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) out[x][taille - 1 - y] = cells[y][x];
  }
  return out;
}

const empreinte = (cells) => cells.map((row) => row.join('')).join('/');

/**
 * Les orientations distinctes d'une piece.
 *
 * La comparaison porte sur la matrice et non sur la forme, comme dans le moteur :
 * le O n'a donc qu'un seul etat, mais un S en a quatre — la meme forme occupant
 * d'autres cases de sa matrice une fois remise a l'endroit. Les deux etats d'un S
 * se posent au meme endroit, la chute rattrapant le decalage : le doublon coute
 * une evaluation, il ne fausse rien.
 */
export function formes(cells) {
  const vues = new Map();
  let forme = cells;
  for (let i = 0; i < 4; i++) {
    const cle = empreinte(forme);
    if (!vues.has(cle)) vues.set(cle, forme);
    forme = tourner(forme);
  }
  return [...vues.values()];
}

export const memeForme = (a, b) => empreinte(a) === empreinte(b);

/**
 * Tous les endroits ou la piece en cours peut se poser, notes.
 *
 * On n'y verifie pas que la colonne visee est *atteignable* : glisser une piece
 * sous un surplomb demanderait de simuler les rotations avec leurs decalages, et
 * le jeu en cree justement avec les blocs de handicap. Le pilote tranche
 * autrement, et plus simplement : s'il pousse deux fois sans que rien ne bouge,
 * il lache la piece la ou elle est. Une piece mal posee de temps en temps est un
 * defaut d'IA, pas un blocage.
 *
 * @param {import('../engine/state.js').GameState} state
 * @returns {{ cells: number[][], x: number, y: number, lignes: number, note: number }[]}
 */
export function placements(state) {
  const out = [];

  for (const cells of formes(state.current.cells)) {
    // La piece deborde de sa matrice : x va plus a gauche que la colonne 0.
    for (let x = 1 - cells.length; x < COLS; x++) {
      const depart = { ...state.current, cells, x };
      if (collides(state.grid, depart)) continue;

      let chute = 0;
      while (!collides(state.grid, depart, 0, chute + 1)) chute++;
      const pose = { ...depart, y: depart.y + chute };

      const { grid, cleared } = clearLines(merge(state.grid, pose));
      out.push({ cells, x, y: pose.y, lignes: cleared, note: evaluer(grid, cleared) });
    }
  }

  return out;
}

/**
 * Choisit ou poser la piece.
 *
 * L'adresse est une probabilite de bien jouer, et elle sert a l'essai du jeu
 * plus qu'au jeu lui-meme : une IA parfaite ne meurt jamais, ne monte jamais sa
 * pile et ne laisse donc jamais voir ni la camera qui se porte sur un joueur en
 * difficulte, ni une elimination, ni une victoire. A 1 elle joue son meilleur
 * coup ; en dessous, elle se trompe pour de bon — un placement au hasard, avec
 * les trous que cela creuse.
 *
 * @param {import('../engine/state.js').GameState} state
 * @param {{ adresse?: number, alea?: () => number }} options
 * @returns {ReturnType<typeof placements>[number] | null} null quand rien ne tient
 */
export function choisir(state, { adresse = 1, alea = Math.random } = {}) {
  const liste = placements(state);
  if (liste.length === 0) return null;

  if (alea() < adresse) {
    return liste.reduce((meilleur, place) => (place.note > meilleur.note ? place : meilleur));
  }
  return liste[Math.floor(alea() * liste.length)];
}

/**
 * L'action a emettre maintenant pour se rapprocher du placement vise.
 *
 * Une seule action a la fois, et relue a chaque fois depuis l'etat courant : le
 * plateau bouge sous la piece — la gravite la fait descendre, un handicap la
 * remonte — et une sequence calculee d'avance se trouverait fausse a la
 * troisieme touche.
 *
 * La rotation passe avant le deplacement parce que le moteur la decale au besoin
 * pour la faire tenir (wall kick) : viser la colonne d'abord, ce serait la
 * perdre juste apres.
 *
 * @param {import('../engine/state.js').GameState} state
 * @param {ReturnType<typeof choisir>} cible
 * @returns {{ type: string, dx?: number }}
 */
export function prochaineAction(state, cible) {
  // Plus rien ne tient : lacher reste la seule facon d'avancer, et la defaite
  // sera prononcee par le moteur, pas devinee ici.
  if (!cible) return { type: 'hardDrop' };

  if (!memeForme(state.current.cells, cible.cells)) return { type: 'rotate' };
  if (state.current.x !== cible.x) return { type: 'move', dx: state.current.x < cible.x ? 1 : -1 };
  return { type: 'hardDrop' };
}
