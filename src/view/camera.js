/**
 * La camera du multiplex : qui regarde-t-on, et jusqu'a quand.
 *
 * Fonctions pures sur un etat minuscule, comme le moteur : aucune horloge lue
 * ici, aucun DOM. L'appelant fournit l'instant et la liste des adversaires, ce
 * qui rend la politique de cadrage testable image par image.
 *
 * Elle ne decide que de l'affichage : se tromper de plan ne change rien a la
 * partie.
 */

/**
 * Hauteur de pile a partir de laquelle un joueur est « en difficulte ».
 *
 * Quatorze rangees sur vingt : la pile depasse les deux tiers du plateau, il
 * reste de quoi poser deux ou trois pieces. C'est le moment ou son plateau
 * devient interessant a regarder.
 */
export const DANGER = 14;

/** Duree d'un plan quand personne n'est en difficulte. */
export const ROTATION_MS = 5000;

/**
 * @typedef {{ id: string, hauteur: number, vivant: boolean }} Rival
 * @typedef {{ mode: 'auto' | 'manuel', focus: string | null, depuis: number }} Camera
 */

/** @returns {Camera} */
export function createCamera() {
  return { mode: 'auto', focus: null, depuis: 0 };
}

const vivants = (rivaux) => rivaux.filter((rival) => rival.vivant);

function plan(camera, focus, maintenant) {
  // Rester sur le meme joueur ne relance pas le chronometre du plan : sans
  // cela, une rotation ne partirait jamais.
  if (focus === camera.focus) return camera;
  return { ...camera, focus, depuis: maintenant };
}

/**
 * Choisit le plan courant.
 *
 * En manuel, on respecte le choix du joueur tant qu'il tient debout ; on ne le
 * ramene en automatique que si celui qu'il regardait quitte la partie, parce
 * qu'il n'y a alors plus rien a respecter.
 *
 * En automatique, la difficulte prime sur la rotation : un plateau qui monte
 * est ce qu'il y a de plus interessant a suivre, et il garde l'antenne tant
 * qu'il est en danger. Sinon les plans s'enchainent au rythme fixe, comme une
 * camera qui fait le tour des tables.
 *
 * @param {Camera} camera
 * @param {Rival[]} rivaux
 * @param {number} maintenant
 * @returns {Camera}
 */
export function cadrer(camera, rivaux, maintenant) {
  const enJeu = vivants(rivaux);
  if (enJeu.length === 0) return { ...camera, focus: null };

  const suivi = enJeu.find((rival) => rival.id === camera.focus) ?? null;

  if (camera.mode === 'manuel') {
    if (suivi) return camera;
    // Celui qu'on regardait est sorti : l'automatique reprend la main.
    return plan({ ...camera, mode: 'auto' }, enJeu[0].id, maintenant);
  }

  const endanger = enJeu
    .filter((rival) => rival.hauteur >= DANGER)
    .sort((a, b) => b.hauteur - a.hauteur);

  if (endanger.length > 0) return plan(camera, endanger[0].id, maintenant);

  if (suivi && maintenant - camera.depuis < ROTATION_MS) return camera;

  // Le plan suivant dans l'ordre d'arrivee : la rotation reste previsible.
  const index = suivi ? enJeu.findIndex((rival) => rival.id === suivi.id) : -1;
  return plan(camera, enJeu[(index + 1) % enJeu.length].id, maintenant);
}

/**
 * Passe au joueur suivant ou precedent, a la demande. Regarder ailleurs est
 * une intention : la camera passe en manuel et y reste.
 *
 * @param {Camera} camera
 * @param {Rival[]} rivaux
 * @param {1 | -1} sens
 * @param {number} maintenant
 * @returns {Camera}
 */
export function viser(camera, rivaux, sens, maintenant) {
  const enJeu = vivants(rivaux);
  if (enJeu.length === 0) return { ...camera, mode: 'manuel', focus: null };

  // Sans plan courant (personne ne regardait), on entre par un bout ou l'autre
  // de la liste selon le sens demande.
  const index = enJeu.findIndex((rival) => rival.id === camera.focus);
  const suivant = index === -1
    ? (sens === 1 ? 0 : enJeu.length - 1)
    : (index + sens + enJeu.length) % enJeu.length;

  return { mode: 'manuel', focus: enJeu[suivant].id, depuis: maintenant };
}

/** Rend la main a la realisation automatique. */
export function automatique(camera, maintenant) {
  return { ...camera, mode: 'auto', depuis: maintenant };
}
