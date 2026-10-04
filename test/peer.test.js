/**
 * Tests du transport pair-a-pair, sans navigateur ni WebRTC.
 *
 * `joinRoom` et `selfId` etant injectes dans le transport, un faux maillage de
 * quarante lignes suffit a monter plusieurs joueurs dans un seul process. C'est
 * ce qui permet d'eprouver ici l'election, le salon, le handicap et les verdicts
 * — tout ce que le navigateur ne ferait que transporter.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createPeerTransport } from '../src/net/peer.js';
import { SERVER } from '../src/net/protocol.js';

/** Observation : assez pour que le faux maillage se soit annonce. */
const SETTLE = 5;
const RESPIRE = 40;

const delai = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * Un faux maillage Trystero : des membres qui s'echangent des messages en
 * memoire. Les arrivees sont annoncees sur une micro-tache, comme le vrai, pour
 * que les ecouteurs soient en place quand elles tombent.
 */
function creerMaillage() {
  /** @type {Map<string, Map<string, object>>} */
  const salons = new Map();

  function membres(code) {
    if (!salons.has(code)) salons.set(code, new Map());
    return salons.get(code);
  }

  return {
    /** La fonction joinRoom a injecter dans le transport d'un joueur donne. */
    pour(selfId) {
      return (_config, code) => {
        const gens = membres(code);
        const moi = { actions: new Map() };
        gens.set(selfId, moi);

        queueMicrotask(() => {
          for (const [autreId, autre] of gens) {
            if (autreId === selfId) continue;
            moi.salle?.onPeerJoin?.(autreId);
            autre.salle?.onPeerJoin?.(selfId);
          }
        });

        // Comme la bibliotheque : onPeerJoin et onPeerLeave s'assignent.
        moi.salle = {
          onPeerJoin: null,
          onPeerLeave: null,
          /**
           * Exactement la forme de la bibliotheque vendue (0.25) : un objet, un
           * `onMessage` qu'on **assigne**, et un destinataire passe en option
           * `{ target }`. Un faux plus commode que le vrai ne prouverait rien.
           */
          makeAction(nom) {
            const canal = {
              onMessage: null,
              send(donnees, options = {}) {
                const to = options.target;
                const cibles = to ? [to] : [...gens.keys()].filter((id) => id !== selfId);
                for (const cible of cibles) {
                  gens.get(cible)?.actions.get(nom)?.onMessage?.(donnees, selfId);
                }
                return Promise.resolve();
              },
            };
            moi.actions.set(nom, canal);
            return canal;
          },
          getPeers: () => [...gens.keys()].filter((id) => id !== selfId),
          leave() {
            gens.delete(selfId);
            for (const [autreId, autre] of gens) {
              if (autreId !== selfId) autre.salle?.onPeerLeave?.(selfId);
            }
          },
        };

        return moi.salle;
      };
    },
  };
}

/** Monte un joueur : son transport, et tout ce qu'il a entendu. */
function joueur(maillage, selfId, { code = 'SALON', name = selfId, seed = () => 99 } = {}) {
  const statuts = [];
  const actions = [];
  const plateaux = [];

  const transport = createPeerTransport({
    code,
    name,
    seed,
    joinRoom: maillage.pour(selfId),
    selfId,
    settleMs: SETTLE,
    seulMs: 10_000,
  });

  transport.onStatus((s) => statuts.push(s));
  transport.onAction((action, meta) => actions.push({ action, meta }));
  transport.onBoard((playerId, board) => plateaux.push({ playerId, board }));

  // start() ne se resout qu'au depart de la partie : on ne l'attend pas ici.
  const partie = transport.start();
  partie.catch(() => {});

  return { selfId, transport, statuts, actions, plateaux, partie };
}

/** Le dernier statut d'un genre donne. */
function dernier(statuts, kind) {
  return [...statuts].reverse().find((s) => s.kind === kind);
}

describe('rendez-vous et election', () => {
  it('annonce la recherche du salon avant toute chose', async () => {
    const maillage = creerMaillage();
    const a = joueur(maillage, 'a');

    const cherche = dernier(a.statuts, 'seeking');
    assert.ok(cherche, 'aucune recherche annoncee');
    assert.match(cherche.message, /SALON/);

    a.transport.close();
  });

  it('designe le meme arbitre chez tous les joueurs', async () => {
    const maillage = creerMaillage();
    const c = joueur(maillage, 'c');
    const a = joueur(maillage, 'a');
    const b = joueur(maillage, 'b');
    await delai(RESPIRE);

    // Le plus petit identifiant, et lui seul.
    assert.equal(a.transport.estHote(), true);
    assert.equal(b.transport.estHote(), false);
    assert.equal(c.transport.estHote(), false);

    for (const j of [a, b, c]) j.transport.close();
  });

  it('fait converger le salon chez tout le monde', async () => {
    const maillage = creerMaillage();
    const a = joueur(maillage, 'a', { name: 'Ali' });
    const b = joueur(maillage, 'b', { name: 'Bea' });
    await delai(RESPIRE);

    for (const j of [a, b]) {
      const attente = dernier(j.statuts, 'waiting');
      assert.ok(attente, `${j.selfId} n a pas vu le salon`);
      assert.equal(attente.players, 2);
      assert.deepEqual([...attente.names].sort(), ['Ali', 'Bea']);
    }

    for (const j of [a, b]) j.transport.close();
  });

  it('cede l arbitrage a un plus petit identifiant', async () => {
    const maillage = creerMaillage();
    const m = joueur(maillage, 'm');
    await delai(RESPIRE);
    assert.equal(m.transport.estHote(), true);

    // Abdication : elle ne peut survenir qu'avant le depart.
    const a = joueur(maillage, 'a');
    await delai(RESPIRE);

    assert.equal(m.transport.estHote(), false);
    assert.equal(a.transport.estHote(), true);

    for (const j of [m, a]) j.transport.close();
  });
});

describe('depart de la partie', () => {
  it('donne la meme graine a tous et son identifiant a chacun', async () => {
    const maillage = creerMaillage();
    const a = joueur(maillage, 'a', { seed: () => 4242 });
    const b = joueur(maillage, 'b');
    await delai(RESPIRE);

    b.transport.begin();
    const [ouvA, ouvB] = await Promise.all([a.partie, b.partie]);

    assert.equal(ouvA.seed, 4242);
    assert.equal(ouvB.seed, 4242);
    assert.equal(ouvA.playerId, 'a');
    assert.equal(ouvB.playerId, 'b');

    for (const j of [a, b]) j.transport.close();
  });

  it('refuse de partir a un seul joueur', async () => {
    const maillage = creerMaillage();
    const a = joueur(maillage, 'a');
    await delai(RESPIRE);

    a.transport.begin();
    await delai(RESPIRE);

    const erreur = dernier(a.statuts, 'error');
    assert.ok(erreur, 'aucune erreur annoncee');
    assert.match(erreur.message, /au moins 2/);

    a.transport.close();
  });

  it('laisse n importe quel present lancer la partie', async () => {
    const maillage = creerMaillage();
    const a = joueur(maillage, 'a');
    const b = joueur(maillage, 'b');
    await delai(RESPIRE);

    // Ce n'est pas l'hote qui lance : ce sont les presents qui decident.
    b.transport.begin();
    await Promise.all([a.partie, b.partie]);

    assert.ok(dernier(a.statuts, 'start'));
    assert.ok(dernier(b.statuts, 'start'));

    for (const j of [a, b]) j.transport.close();
  });
});

describe('actions', () => {
  it('applique une touche immediatement et ne l envoie a personne', async () => {
    const maillage = creerMaillage();
    const a = joueur(maillage, 'a');
    const b = joueur(maillage, 'b');
    await delai(RESPIRE);
    b.transport.begin();
    await Promise.all([a.partie, b.partie]);

    a.actions.length = 0;
    b.actions.length = 0;
    a.transport.send({ type: 'move', dx: -1 });

    // Echo local, synchrone : c'est tout le gain du pair-a-pair.
    assert.equal(a.actions.length, 1);
    assert.deepEqual(a.actions[0].action, { type: 'move', dx: -1 });
    assert.equal(a.actions[0].meta.self, true);

    // Personne d'autre ne simule notre plateau : rien ne part.
    await delai(RESPIRE);
    assert.equal(b.actions.length, 0);

    for (const j of [a, b]) j.transport.close();
  });

  it('envoie le handicap aux autres, et a eux seuls', async () => {
    const maillage = creerMaillage();
    const a = joueur(maillage, 'a');
    const b = joueur(maillage, 'b');
    const c = joueur(maillage, 'c');
    await delai(RESPIRE);
    a.transport.begin();
    await Promise.all([a.partie, b.partie, c.partie]);

    for (const j of [a, b, c]) j.actions.length = 0;
    a.transport.send({ type: 'garbage', columns: [1, 4] });
    await delai(RESPIRE);

    // L'emetteur le recoit avec self:true — main.js s'en sert pour ne pas se
    // penaliser lui-meme.
    assert.equal(a.actions.length, 1);
    assert.equal(a.actions[0].meta.self, true);

    for (const j of [b, c]) {
      assert.equal(j.actions.length, 1);
      assert.deepEqual(j.actions[0].action, { type: 'garbage', columns: [1, 4] });
      assert.equal(j.actions[0].meta.self, false);
      assert.equal(j.actions[0].meta.playerId, 'a');
    }

    for (const j of [a, b, c]) j.transport.close();
  });

  it('porte les instantanes de plateau a ceux qui regardent', async () => {
    const maillage = creerMaillage();
    const a = joueur(maillage, 'a');
    const b = joueur(maillage, 'b');
    await delai(RESPIRE);
    a.transport.begin();
    await Promise.all([a.partie, b.partie]);

    a.transport.sendBoard('xxxx');
    await delai(RESPIRE);

    assert.deepEqual(b.plateaux, [{ playerId: 'a', board: 'xxxx' }]);
    // On ne se regarde pas soi-meme : le plateau est sous les yeux.
    assert.deepEqual(a.plateaux, []);

    for (const j of [a, b]) j.transport.close();
  });
});

describe('verdicts', () => {
  it('declare vainqueur le dernier en jeu', async () => {
    const maillage = creerMaillage();
    const a = joueur(maillage, 'a');
    const b = joueur(maillage, 'b');
    await delai(RESPIRE);
    a.transport.begin();
    await Promise.all([a.partie, b.partie]);

    a.transport.reportGameOver();
    await delai(RESPIRE);

    for (const j of [a, b]) {
      const fin = dernier(j.statuts, 'finished');
      assert.ok(fin, `${j.selfId} n a pas vu le verdict`);
      assert.equal(fin.winner, 'b');
      assert.equal(fin.self, j.selfId === 'b');
    }

    for (const j of [a, b]) j.transport.close();
  });

  it('annonce l elimination et le compte des survivants', async () => {
    const maillage = creerMaillage();
    const a = joueur(maillage, 'a');
    const b = joueur(maillage, 'b');
    const c = joueur(maillage, 'c');
    await delai(RESPIRE);
    a.transport.begin();
    await Promise.all([a.partie, b.partie, c.partie]);

    b.transport.reportGameOver();
    await delai(RESPIRE);

    const vu = dernier(c.statuts, 'eliminated');
    assert.equal(vu.playerId, 'b');
    assert.equal(vu.remaining, 2);
    assert.equal(vu.self, false);
    assert.equal(dernier(b.statuts, 'eliminated').self, true);

    for (const j of [a, b, c]) j.transport.close();
  });

  it('refuse un verdict qui ne vient pas de l arbitre', async () => {
    const maillage = creerMaillage();
    const a = joueur(maillage, 'a');
    const b = joueur(maillage, 'b');
    const c = joueur(maillage, 'c');
    await delai(RESPIRE);
    a.transport.begin();
    await Promise.all([a.partie, b.partie, c.partie]);

    // b n'est pas l'arbitre : il ne peut pas se declarer vainqueur chez c.
    const faux = maillage.pour('b')(null, 'SALON');
    const faussaire = faux.makeAction('jeu');
    faussaire.send(JSON.stringify({ type: SERVER.FINISHED, winner: 'b' }), { target: 'c' });
    await delai(RESPIRE);

    assert.equal(dernier(c.statuts, 'finished'), undefined);

    for (const j of [a, b, c]) j.transport.close();
  });
});

describe('departs', () => {
  it('arrete la partie quand l arbitre s en va', async () => {
    const maillage = creerMaillage();
    const a = joueur(maillage, 'a');
    const b = joueur(maillage, 'b');
    const c = joueur(maillage, 'c');
    await delai(RESPIRE);
    a.transport.begin();
    await Promise.all([a.partie, b.partie, c.partie]);

    // Sans arbitre, plus de verdict possible : mieux vaut le dire que laisser
    // la partie continuer sans fin.
    a.transport.close();
    await delai(RESPIRE);

    for (const j of [b, c]) {
      const fin = dernier(j.statuts, 'closed');
      assert.ok(fin, `${j.selfId} n a pas ete prevenu`);
      assert.match(fin.message, /hôte/);
    }

    for (const j of [b, c]) j.transport.close();
  });

  it('vaut elimination quand un invite s en va en pleine partie', async () => {
    const maillage = creerMaillage();
    const a = joueur(maillage, 'a');
    const b = joueur(maillage, 'b');
    const c = joueur(maillage, 'c');
    await delai(RESPIRE);
    a.transport.begin();
    await Promise.all([a.partie, b.partie, c.partie]);

    b.transport.close();
    await delai(RESPIRE);

    const vu = dernier(c.statuts, 'eliminated');
    assert.equal(vu.playerId, 'b');
    assert.equal(vu.remaining, 2);

    for (const j of [a, c]) j.transport.close();
  });

  it('fait baisser le compte quand un invite part avant le depart', async () => {
    const maillage = creerMaillage();
    const a = joueur(maillage, 'a', { name: 'Ali' });
    const b = joueur(maillage, 'b', { name: 'Bea' });
    await delai(RESPIRE);
    assert.equal(dernier(a.statuts, 'waiting').players, 2);

    b.transport.close();
    await delai(RESPIRE);

    const attente = dernier(a.statuts, 'waiting');
    assert.equal(attente.players, 1);
    assert.deepEqual(attente.names, ['Ali']);

    a.transport.close();
  });
});
