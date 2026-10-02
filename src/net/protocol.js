/**
 * Protocole du jeu en reseau, partage par le client et le serveur.
 *
 * La partie ne se joue qu'avec des actions et une graine : c'est le moteur
 * deterministe qui rend cela possible : a partir de la meme graine et de la
 * meme suite d'actions, deux machines obtiennent le meme plateau.
 *
 * Un second canal, BOARD, transporte des instantanes de plateau. Il ne sert
 * qu'a regarder les autres jouer, jamais a decider de quoi que ce soit : le
 * perdre ou le fausser ne change aucune partie. C'est ce qui l'autorise a
 * cotoyer le canal d'actions sans le contaminer.
 *
 * Ce fichier est la seule definition de ce vocabulaire, pour que les deux cotes
 * ne puissent pas diverger.
 */

/** Messages du client vers le serveur. */
export const CLIENT = {
  JOIN: 'join', // { type, room, name }
  BEGIN: 'begin', // { type } — lancer la partie sans attendre le salon plein
  ACTION: 'action', // { type, action }
  BOARD: 'board', // { type, board } — instantane pour les spectateurs
  OVER: 'over', // { type } — j'ai perdu
};

/** Messages du serveur vers le client. */
export const SERVER = {
  WAITING: 'waiting', // { type, room, players, min, names }
  START: 'start', // { type, room, seed, playerId, players, names }
  ACTION: 'action', // { type, playerId, action }
  BOARD: 'board', // { type, playerId, board }
  ELIMINATED: 'eliminated', // { type, playerId, remaining }
  FINISHED: 'finished', // { type, winner } — le dernier en jeu l'emporte
  LEFT: 'left', // { type, playerId }
  ERROR: 'error', // { type, message }
};

/** Longueur maximale d'un pseudo : de quoi se reconnaitre, pas de quoi pavoiser. */
export const NAME_MAX = 16;

/**
 * Nettoie un pseudo recu. Il vient d'un inconnu et finira affiche chez les
 * autres joueurs : on le ramene a du texte court et sans surprise, et on ne
 * laisse jamais passer une chaine vide.
 */
export function cleanName(raw, fallback = 'Joueur') {
  if (typeof raw !== 'string') return fallback;
  // Les caracteres de controle n'ont rien a faire dans un pseudo, et les
  // espaces multiples servent surtout a se fabriquer un nom invisible.
  const propre = raw.replace(/\s+/g, ' ').replace(/[\p{C}]/gu, '').trim().slice(0, NAME_MAX);
  return propre || fallback;
}

/**
 * Noms proposes a qui n'en a pas.
 *
 * Des fleuves et des villes de Russie, clin d'oeil a Moscou ou le jeu est ne.
 * Aucun n'est un prenom d'adversaire artificiel (server/bot.js) : dans le
 * multiplex, on doit pouvoir distinguer d'un coup d'oeil un humain d'une IA.
 */
const NOMS = [
  'Volga', 'Neva', 'Oural', 'Baikal', 'Angara', 'Ienissei',
  'Amour', 'Irtych', 'Kama', 'Oka', 'Don', 'Ladoga',
  'Onega', 'Taiga', 'Toundra', 'Kazan', 'Omsk', 'Tomsk',
  'Perm', 'Samara', 'Novgorod', 'Souzdal', 'Rostov', 'Vladimir',
];

/**
 * Un pseudo tire au sort, pour le joueur dont on ne peut pas connaitre la
 * machine.
 *
 * C'est le cas de tout invite du reseau local : le nom d'une machine distante
 * n'est pas resolvable depuis le serveur — ni par DNS inverse, ni par NetBIOS,
 * ni par mDNS — et deviner donnerait un faux nom, ce qui vaut moins que pas de
 * nom du tout.
 *
 * Reste qu'un champ vide ne vaut rien non plus : tout le monde s'appellerait
 * « Joueur », numerote les uns derriere les autres, et la camera annoncerait
 * « Joueur 3 » sans que personne ne se reconnaisse. Un nom quelconque mais
 * distinct rend le multiplex lisible, et le joueur le remplace s'il veut.
 *
 * @param {() => number} alea source du hasard, injectable pour les tests
 */
export function randomName(alea = Math.random) {
  const rang = Math.min(NOMS.length - 1, Math.max(0, Math.floor(alea() * NOMS.length)));
  return NOMS[rang];
}

/**
 * Il faut au moins deux joueurs pour une partie. Il n'y a pas de maximum : le
 * salon accueille qui veut, et ce sont les presents qui decident du depart.
 */
export const MIN_PLAYERS = 2;

export const DEFAULT_ROOM = 'partie';

export function encode(message) {
  return JSON.stringify(message);
}

/**
 * Analyse un message recu. Renvoie null plutot que de lever : un pair peut
 * toujours envoyer n'importe quoi, et cela ne doit pas tuer la partie.
 */
export function decode(raw) {
  try {
    const message = JSON.parse(raw);
    return message && typeof message.type === 'string' ? message : null;
  } catch {
    return null;
  }
}
