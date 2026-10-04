/**
 * Adresse du relais de jeu.
 *
 * C'est la seule chose que ce projet heberge : un Worker Cloudflare qui reunit
 * les joueurs d'un meme salon (voir worker/). La page, elle, reste un paquet de
 * fichiers statiques servis par GitHub Pages.
 *
 * L'adresse est surchargeable par `?relais=wss://…` : c'est ce qui permet
 * d'essayer un relais local (`npx wrangler dev`) sans toucher au code, et de
 * depanner sans redeployer la page.
 */

/** Le relais en service. */
export const RELAIS_DEFAUT = 'wss://tetris-relais.labilbe.workers.dev';

/**
 * L'adresse a utiliser, selon l'URL puis le defaut.
 *
 * Le protocole est verifie : une page servie en https ne peut pas ouvrir une
 * connexion ws://, le navigateur la tenant pour du contenu mixte. Autant le
 * refuser tout de suite que laisser attendre une connexion qui n'aboutira pas.
 */
export function relaisUrl(recherche = '', https = false) {
  const demande = new URLSearchParams(recherche).get('relais');
  if (!demande) return RELAIS_DEFAUT;

  const propre = demande.trim();
  if (!/^wss?:\/\//.test(propre)) return RELAIS_DEFAUT;
  if (https && propre.startsWith('ws://')) return RELAIS_DEFAUT;

  return propre.replace(/\/+$/, '');
}
