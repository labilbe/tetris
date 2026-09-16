/**
 * Generateur pseudo-aleatoire a graine (xorshift32).
 *
 * Il est purement fonctionnel : tirer un nombre ne modifie rien, il renvoie la
 * valeur ET le generateur suivant. C'est ce qui permet a deux machines partant
 * de la meme graine de voir exactement la meme sequence de pieces, et de rejouer
 * une partie depuis son debut pour la reconciliation reseau.
 */

/** @typedef {{ seed: number }} Rng */

/**
 * @param {number} seed graine initiale (0 est remplace par 1, xorshift y reste bloque)
 * @returns {Rng}
 */
export function createRng(seed) {
  const normalized = seed >>> 0;
  return { seed: normalized === 0 ? 1 : normalized };
}

/**
 * Tire un flottant dans [0, 1).
 * @param {Rng} rng
 * @returns {{ rng: Rng, value: number }}
 */
export function nextRandom(rng) {
  let x = rng.seed;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return { rng: { seed: x }, value: x / 0x100000000 };
}

/**
 * Melange une copie du tableau (Fisher-Yates) sans toucher a l'original.
 * @template T
 * @param {readonly T[]} items
 * @param {Rng} rng
 * @returns {{ rng: Rng, items: T[] }}
 */
export function shuffle(items, rng) {
  const out = items.slice();
  let current = rng;
  for (let i = out.length - 1; i > 0; i--) {
    const draw = nextRandom(current);
    current = draw.rng;
    const j = Math.floor(draw.value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return { rng: current, items: out };
}

/** Graine aleatoire, a utiliser uniquement en solo : en reseau elle vient du serveur. */
export function randomSeed() {
  return (Math.random() * 0x100000000) >>> 0;
}
