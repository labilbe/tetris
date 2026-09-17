/**
 * Preferences locales du joueur (affichage, son).
 *
 * Elles n'ont rien a faire dans l'etat du moteur : ce sont des reglages propres
 * a ce navigateur, qui ne doivent jamais etre synchronises avec un adversaire.
 * localStorage peut lever (navigation privee, stockage bloque) : dans ce cas le
 * reglage marche quand meme, il ne survit simplement pas au rechargement.
 */

/**
 * @param {string} key
 * @param {boolean} fallback valeur si rien n'est enregistre ou si le stockage est inaccessible
 */
export function readPreference(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === 'true';
  } catch {
    return fallback;
  }
}

export function writePreference(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Sans stockage, le reglage reste valable pour la session en cours.
  }
}
