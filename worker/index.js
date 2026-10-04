/**
 * Point d'entree du relais.
 *
 * Deux chemins, et rien d'autre : une connexion de jeu, qu'on confie au Durable
 * Object du salon demande ; et la lecture du journal, reservee a qui detient le
 * secret.
 */

import { DEFAULT_ROOM, cleanRoom } from '../src/net/protocol.js';

export { Salon } from './salon.js';
export { Registre } from './registre.js';

/**
 * Le jeton de lecture du journal vaut-il celui qu'on attend ?
 *
 * Sans secret configure, personne ne lit : un journal ouvert par defaut
 * exposerait les pseudos et les horaires de jeu a qui devine un code de salon.
 * Il se pose une fois, par `npx wrangler secret put JOURNAL_SECRET`.
 */
function autorise(url, env) {
  const attendu = env.JOURNAL_SECRET;
  if (!attendu) return false;

  const donne = url.searchParams.get('jeton') ?? '';
  // Comparaison a temps constant : la difference est infime ici, mais elle ne
  // coute rien et evite d'avoir a se demander si elle comptait.
  if (donne.length !== attendu.length) return false;

  let ecart = 0;
  for (let i = 0; i < attendu.length; i += 1) {
    ecart |= donne.charCodeAt(i) ^ attendu.charCodeAt(i);
  }
  return ecart === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/journal') {
      if (!autorise(url, env)) {
        return new Response('Jeton absent ou invalide.\n', { status: 403 });
      }

      // Sans salon, c'est le registre : la liste des parties recentes, pour
      // retrouver celle qu'on cherche sans se souvenir de son code.
      const demande = url.searchParams.get('salon');
      if (!demande) {
        const registre = env.REGISTRE.get(env.REGISTRE.idFromName('global'));
        return registre.fetch(new Request(url.toString()));
      }

      const code = cleanRoom(demande) || DEFAULT_ROOM;
      const salon = env.SALONS.get(env.SALONS.idFromName(code));
      const interne = new URL(`https://salon/${encodeURIComponent(code)}`);
      interne.searchParams.set('journal', '1');
      const partie = url.searchParams.get('partie');
      if (partie) interne.searchParams.set('partie', partie);

      return salon.fetch(new Request(interne.toString()));
    }

    // Une visite ordinaire : utile pour verifier d'un navigateur que le relais
    // est en vie, sans avoir a ouvrir le jeu.
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(
        'Relais de salons Tetris. Connectez-vous en WebSocket : wss://<hote>/?salon=CODE\n',
        { headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    }

    // Le code est nettoye ici, une fois pour toutes : c'est lui qui nomme le
    // Durable Object, et deux ecritures du meme code doivent mener au meme
    // salon. Sans cela, « essai » et « ESSAI » seraient deux parties.
    const code = cleanRoom(url.searchParams.get('salon') ?? '') || DEFAULT_ROOM;
    const salon = env.SALONS.get(env.SALONS.idFromName(code));

    return salon.fetch(new Request(`https://salon/${encodeURIComponent(code)}`, request));
  },
};
