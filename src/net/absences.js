/**
 * Les joueurs coupes, vus de chez les autres.
 *
 * Le relais garde la place d'un joueur dont la connexion tombe (AWAY), et la
 * lui rend s'il revient a temps (BACK). Reste a decider ce que font les autres
 * pendant ce temps : ce module tient la liste de ceux qu'on attend, et c'est
 * elle qui gele la partie.
 *
 * Pourquoi geler plutot que continuer : le jeu se joue au handicap. Celui qui
 * est coupe ne peut ni en envoyer ni en recevoir, et pendant ce temps les
 * autres continuent d'empiler des lignes. Trente secondes de ce regime
 * decident la partie a sa place, et son retour n'y change plus rien. Une
 * partie mise en pause pour tout le monde est la seule qui reste la meme pour
 * tout le monde.
 *
 * Aucune horloge ici, aucun DOM : le temps est un parametre, comme dans le
 * moteur. C'est ce qui rend tout ceci verifiable sous `node --test`.
 */

/**
 * Marge accordee au relais, par-dessus le delai de reprise.
 *
 * L'echeance est calculee ici alors que c'est le relais qui tranche : son
 * elimination (ELIMINATED) peut arriver une poignee de secondes apres nos
 * trente. Sans marge, on repartirait juste avant son verdict ; sans echeance
 * du tout, un message perdu gelerait la partie pour toujours. La marge est le
 * filet, le message reste la regle.
 */
export const MARGE_MS = 3000;

/**
 * Note un joueur coupe.
 *
 * @param {Map<string, number>} absences etat courant, jamais modifie
 * @param {string} playerId
 * @param {number} secondes delai annonce par le relais
 * @param {number} maintenant horloge, en millisecondes
 * @returns {Map<string, number>} un nouvel etat
 */
export function noter(absences, playerId, secondes, maintenant) {
  const suite = new Map(absences);
  suite.set(playerId, maintenant + secondes * 1000);
  return suite;
}

/**
 * Oublie un joueur : il est revenu, elimine, ou parti pour de bon.
 *
 * @returns {Map<string, number>} un nouvel etat
 */
export function oublier(absences, playerId) {
  if (!absences.has(playerId)) return absences;
  const suite = new Map(absences);
  suite.delete(playerId);
  return suite;
}

/**
 * Ceux qu'on attend encore, et pour combien de temps.
 *
 * Les echeances depassees sont ignorees : c'est le filet decrit plus haut.
 *
 * @returns {{ playerId: string, reste: number }[]} `reste` en secondes, jamais negatif
 */
export function attendus(absences, maintenant) {
  const liste = [];

  for (const [playerId, echeance] of absences) {
    if (maintenant >= echeance + MARGE_MS) continue;
    liste.push({ playerId, reste: Math.max(0, Math.ceil((echeance - maintenant) / 1000)) });
  }

  return liste;
}

/**
 * Ce qu'on affiche aux autres pendant l'attente.
 *
 * Des pseudos, pas des identifiants : on attend quelqu'un, pas une connexion.
 * Le decompte est celui du plus patient — c'est lui qui dit quand la partie
 * repartira au pire.
 *
 * @param {{ playerId: string, reste: number }[]} liste
 * @param {Record<string, string>} noms pseudos du salon, par identifiant
 */
export function messageAttente(liste, noms = {}) {
  if (liste.length === 0) return '';

  const pseudos = liste.map(({ playerId }) => noms[playerId] ?? 'un joueur');
  const qui = pseudos.length === 1
    ? pseudos[0]
    : `${pseudos.slice(0, -1).join(', ')} et ${pseudos[pseudos.length - 1]}`;
  const reste = Math.max(...liste.map(({ reste: r }) => r));

  return `Connexion perdue : la partie attend ${qui}… ${reste} s`;
}
