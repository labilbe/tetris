/**
 * Les adversaires artificiels, branches sur le relais.
 *
 * Chacun ouvre **sa propre WebSocket**, exactement comme le ferait un
 * navigateur de plus. Le relais ne les distingue pas d'une page ouverte, et
 * c'est tout l'interet : ce qu'on exerce ainsi, c'est la vraie chaine — salon,
 * handicap, multiplex, eliminations — et non une maquette a cote du jeu. C'etait
 * deja la vertu des anciens bots, qui etaient de vrais clients.
 *
 * La decision et le pilotage vivent dans bots.js, purs et testes. Ce fichier n'a
 * que les connexions et le temps.
 */

import { createBotPilot, PLAFOND_BOTS } from './bots.js';
import { BOT_NAMES, CLIENT, SERVER, decode, encode } from './protocol.js';

/**
 * @param {{ url: string, code: string, adresse?: number, delai?: number,
 *           alea?: () => number }} options
 */
export function createBotClients({ url, code, adresse, delai, alea = Math.random }) {
  /** @type {{ pilote: ReturnType<typeof createBotPilot>, socket: WebSocket }[]} */
  const clients = [];

  // Les prenoms sont pris a la suite depuis un rang tire au sort : distincts a
  // coup sur, pour qu'on les distingue dans le multiplex, et pas toujours les
  // memes d'une partie a l'autre.
  const depart = Math.floor(alea() * BOT_NAMES.length);

  function brancher(client) {
    const { pilote, socket } = client;

    socket.addEventListener('open', () => {
      socket.send(encode({ type: CLIENT.JOIN, room: code, name: pilote.name }));
    });

    socket.addEventListener('message', (event) => {
      const message = decode(event.data);
      if (!message) return;

      // Le pilote ne connait que le depart et le handicap : tout le reste — le
      // salon, les verdicts — ne le concerne pas, il joue jusqu'a perdre.
      if (message.type === SERVER.START || message.type === SERVER.ACTION) {
        pilote.receive(message);
      }
    });
  }

  return {
    count() {
      return clients.length;
    },

    complet() {
      return clients.length >= PLAFOND_BOTS;
    },

    /**
     * Ajoute un adversaire : un pilote, une connexion.
     *
     * @returns {boolean} vrai si un adversaire a ete ajoute
     */
    ajouter() {
      if (clients.length >= PLAFOND_BOTS) return false;

      const index = clients.length;
      const pilote = createBotPilot({
        id: `bot-${index + 1}`,
        name: BOT_NAMES[(depart + index) % BOT_NAMES.length],
        adresse,
        delai,
        alea,
      });

      const client = {
        pilote,
        socket: new WebSocket(`${url}?salon=${encodeURIComponent(code)}`),
      };
      clients.push(client);
      brancher(client);
      return true;
    },

    /**
     * Fait avancer les adversaires et emet ce qu'ils produisent.
     *
     * Appele depuis la boucle de rendu : ils vivent sur la meme image que le
     * jeu, sans seconde horloge, et gelent avec elle si l'onglet passe en
     * arriere-plan — ce qui est le comportement souhaitable.
     *
     * `gele` les met en attente avec la partie, sans les faire taire : voir
     * leur `step`.
     */
    tick(nowMs, gele = false) {
      for (const { pilote, socket } of clients) {
        if (socket.readyState !== WebSocket.OPEN) continue;
        for (const { message } of pilote.step(nowMs, gele)) socket.send(encode(message));
      }
    },

    close() {
      for (const { socket } of clients) socket.close();
      clients.length = 0;
    },
  };
}
