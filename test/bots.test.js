/**
 * Tests des adversaires artificiels.
 *
 * Le temps leur etant passe en parametre, tout se joue ici en temps simule :
 * les tests sont instantanes et reproductibles, ce que l'ancien pilote — avec
 * son `setInterval` et son `performance.now()` — ne permettait pas.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STATUS } from '../src/engine/constants.js';
import { createState } from '../src/engine/state.js';
import { PLAFOND_BOTS, createBotPilot, createBotTeam } from '../src/net/bots.js';
import { BOT_NAMES, CLIENT, SERVER } from '../src/net/protocol.js';
import { decodeBoard } from '../src/net/snapshot.js';

const GRAINE = 4242;

/** Un hasard reproductible : les tests ne doivent dependre de rien. */
function aleaFixe(depart = 1) {
  let graine = depart;
  return () => {
    graine = (graine * 1103515245 + 12345) & 0x7fffffff;
    return graine / 0x7fffffff;
  };
}

/** Un pilote demarre, pret a jouer. */
function pilote(options = {}) {
  const bot = createBotPilot({ id: 'bot-1', name: 'Nina', alea: aleaFixe(), ...options });
  bot.demarrer(GRAINE);
  return bot;
}

/** Fait tourner un pilote et rassemble tout ce qu'il emet. */
function jouer(bot, { pas = 16, images = 100, depart = 1000 } = {}) {
  const messages = [];
  for (let i = 0; i < images; i += 1) {
    messages.push(...bot.step(depart + i * pas));
  }
  return messages;
}

const duType = (messages, type) => messages.filter((m) => m.message.type === type);

describe('un adversaire artificiel', () => {
  it('ne joue pas avant d avoir recu la graine', () => {
    const bot = createBotPilot({ id: 'bot-1', name: 'Nina', alea: aleaFixe() });
    assert.deepEqual(bot.step(1000), []);
  });

  it('demarre sur la graine de l arbitre', () => {
    const bot = createBotPilot({ id: 'bot-1', name: 'Nina', alea: aleaFixe() });
    bot.receive({ type: SERVER.START, seed: GRAINE, playerId: 'bot-1' });

    // La graine est ce qui donne a tous la meme suite de pieces : un bot parti
    // sur celle de l'arbitre doit voir exactement le plateau d'un joueur.
    assert.deepEqual(bot.state(), createState(GRAINE));
  });

  it('ne joue pas la meme partie sur une autre graine', () => {
    const un = createBotPilot({ id: 'bot-1', name: 'Nina', alea: aleaFixe() });
    const deux = createBotPilot({ id: 'bot-1', name: 'Nina', alea: aleaFixe() });
    un.receive({ type: SERVER.START, seed: 1, playerId: 'bot-1' });
    deux.receive({ type: SERVER.START, seed: 2, playerId: 'bot-1' });

    assert.notDeepEqual(un.state(), deux.state());
  });

  it('agit, et signe ses messages de son identifiant', () => {
    const messages = jouer(pilote());
    assert.ok(messages.length > 0, 'le bot n a rien emis');
    for (const m of messages) assert.equal(m.from, 'bot-1');
  });

  it('joue de facon reproductible a graine et hasard fixes', () => {
    // Deux pilotes identiques doivent faire exactement la meme partie.
    const un = JSON.stringify(jouer(pilote()));
    const deux = JSON.stringify(jouer(pilote()));
    assert.equal(un, deux);
  });

  it('respecte le delai entre deux actions', () => {
    // Une action toutes les 80 ms : de quoi voir jouer, pas de quoi saturer.
    const messages = jouer(pilote({ delai: 80 }), { pas: 16, images: 100 });
    const actions = duType(messages, CLIENT.ACTION);
    const ecran = 100 * 16;
    assert.ok(actions.length <= ecran / 80 + 1, `trop d actions : ${actions.length}`);
  });

  it('emet un instantane de plateau lisible', () => {
    const messages = jouer(pilote());
    const plateaux = duType(messages, CLIENT.BOARD);

    assert.ok(plateaux.length > 0, 'aucun instantane');
    // Le canal est decoratif, mais il doit rester decodable par le voisin.
    assert.ok(decodeBoard(plateaux[0].message.board));
  });

  it('espace les instantanes comme un joueur humain', () => {
    const messages = jouer(pilote({ boardMs: 200 }), { pas: 16, images: 100 });
    const plateaux = duType(messages, CLIENT.BOARD);
    assert.ok(plateaux.length <= (100 * 16) / 200 + 1, `trop d instantanes : ${plateaux.length}`);
  });
});

describe('le handicap', () => {
  it('encaisse celui d un autre joueur', () => {
    const bot = pilote();
    const avant = bot.state();

    bot.receive({
      type: SERVER.ACTION,
      playerId: 'humain',
      action: { type: 'garbage', columns: [0, 1, 2, 3] },
    });

    assert.notEqual(bot.state(), avant, 'le handicap n a rien change');
  });

  it('ne se penalise jamais lui-meme', () => {
    const bot = pilote();
    const avant = bot.state();

    bot.receive({
      type: SERVER.ACTION,
      playerId: 'bot-1',
      action: { type: 'garbage', columns: [0, 1, 2] },
    });

    assert.equal(bot.state(), avant);
  });

  it('ignore les actions des autres qui ne sont pas des handicaps', () => {
    // Personne ne simule le plateau d un autre : seul le handicap traverse.
    const bot = pilote();
    const avant = bot.state();

    bot.receive({ type: SERVER.ACTION, playerId: 'humain', action: { type: 'hardDrop' } });
    assert.equal(bot.state(), avant);
  });

  it('ignore l attente et les verdicts', () => {
    const bot = pilote();
    const avant = bot.state();

    // Il joue jusqu a perdre : c est l hote qui tient les comptes.
    for (const type of [SERVER.WAITING, SERVER.ELIMINATED, SERVER.FINISHED, SERVER.LEFT]) {
      bot.receive({ type });
    }
    assert.equal(bot.state(), avant);
  });
});

describe('la defaite', () => {
  it('est annoncee une seule fois, et rien ne suit', () => {
    const bot = pilote();

    // Un deluge de handicaps finit par remplir le plateau.
    for (let i = 0; i < 40; i += 1) {
      bot.receive({
        type: SERVER.ACTION,
        playerId: 'humain',
        action: { type: 'garbage', columns: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
      });
    }

    const messages = jouer(bot, { images: 200 });
    const defaites = duType(messages, CLIENT.OVER);

    assert.equal(bot.state().status, STATUS.OVER);
    assert.equal(defaites.length, 1, 'la defaite doit etre annoncee une seule fois');
    assert.equal(bot.fini(), true);

    // Plus rien apres : un bot elimine n a plus de plateau a montrer.
    assert.deepEqual(bot.step(999_999), []);
  });
});

describe('l equipe', () => {
  it('se monte vide par defaut', () => {
    const equipe = createBotTeam();
    assert.deepEqual(equipe.ids(), []);
    assert.deepEqual(equipe.joins(), []);
  });

  it('presente chaque adversaire au salon', () => {
    const equipe = createBotTeam({ count: 3, alea: aleaFixe() });
    const joins = equipe.joins();

    assert.equal(joins.length, 3);
    for (const { from, message } of joins) {
      assert.equal(message.type, CLIENT.JOIN);
      assert.ok(equipe.ids().includes(from));
      assert.ok(BOT_NAMES.includes(message.name));
    }
  });

  it('donne un prenom distinct a chacun', () => {
    // Sinon le multiplex annoncerait deux fois le meme nom.
    const equipe = createBotTeam({ count: PLAFOND_BOTS, alea: aleaFixe() });
    const noms = equipe.joins().map((j) => j.message.name);
    assert.equal(new Set(noms).size, noms.length);
  });

  it('donne un identifiant distinct a chacun', () => {
    const equipe = createBotTeam({ count: PLAFOND_BOTS, alea: aleaFixe() });
    assert.equal(new Set(equipe.ids()).size, PLAFOND_BOTS);
  });

  it('accepte un adversaire de plus jusqu au plafond', () => {
    const equipe = createBotTeam({ alea: aleaFixe() });

    for (let i = 0; i < PLAFOND_BOTS; i += 1) {
      assert.ok(equipe.ajouter(), `refus au rang ${i}`);
    }

    // Ils tournent dans l onglet de l hote : au-dela, sa partie saccade.
    assert.equal(equipe.complet(), true);
    assert.equal(equipe.ajouter(), null);
    assert.equal(equipe.count(), PLAFOND_BOTS);
  });

  it('ne depasse pas le plafond a la creation', () => {
    const equipe = createBotTeam({ count: 99, alea: aleaFixe() });
    assert.equal(equipe.count(), PLAFOND_BOTS);
  });

  it('fait avancer tout le monde d un seul appel', () => {
    const equipe = createBotTeam({ count: 3, alea: aleaFixe() });
    for (const id of equipe.ids()) {
      equipe.receive(id, { type: SERVER.START, seed: GRAINE, playerId: id });
    }

    const emetteurs = new Set();
    for (let i = 0; i < 60; i += 1) {
      for (const { from } of equipe.step(1000 + i * 16)) emetteurs.add(from);
    }

    assert.deepEqual([...emetteurs].sort(), [...equipe.ids()].sort());
  });

  it('achemine le handicap au bon adversaire', () => {
    const equipe = createBotTeam({ count: 2, alea: aleaFixe() });
    for (const id of equipe.ids()) {
      equipe.receive(id, { type: SERVER.START, seed: GRAINE, playerId: id });
    }

    const [un, deux] = equipe.ids();
    const avantDeux = equipe.pilote(deux).state();

    equipe.receive(un, {
      type: SERVER.ACTION,
      playerId: 'humain',
      action: { type: 'garbage', columns: [0, 1, 2, 3] },
    });

    // Seul le destinataire est touche.
    assert.equal(equipe.pilote(deux).state(), avantDeux);
  });

  it('accepte un identifiant inconnu sans broncher', () => {
    const equipe = createBotTeam({ count: 1, alea: aleaFixe() });
    assert.doesNotThrow(() => equipe.receive('fantome', { type: SERVER.START, seed: GRAINE }));
  });
});
