/**
 * Point d'entree du relais.
 *
 * Il ne fait qu'une chose : lire le code du salon et confier la connexion au
 * Durable Object qui porte ce nom. Un salon par objet, et deux parties ne se
 * connaissent donc jamais.
 */

import { DEFAULT_ROOM, cleanRoom } from '../src/net/protocol.js';

export { Salon } from './salon.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
