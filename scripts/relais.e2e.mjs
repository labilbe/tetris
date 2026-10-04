/**
 * Essai de bout en bout du relais, sans navigateur.
 *
 * Deux vrais clients WebSocket dans un seul processus, contre le vrai Worker.
 * C'est ce qui manquait cruellement a la version pair-a-pair du jeu : on ne
 * pouvait l'eprouver qu'entre deux machines, une hypothese a la fois.
 *
 * Il ne fait pas partie de `npm test`, qui doit rester instantane et sans rien a
 * lancer. Ici il faut le relais en face :
 *
 *   npm run relais          # dans un terminal
 *   npm run test:relais     # dans un autre
 */

const URL_RELAIS = process.env.RELAIS ?? 'ws://127.0.0.1:8787';
const SALON = `E2E${Math.floor(Math.random() * 9000 + 1000)}`;

const attendre = (ms) => new Promise((r) => { setTimeout(r, ms); });

let echecs = 0;
function verifier(condition, texte) {
  if (!condition) echecs += 1;
  console.log(`${condition ? '  ok  ' : 'ECHEC '} ${texte}`);
}

/** Un joueur : sa connexion, et tout ce qu'il a entendu. */
function joueur(nom) {
  const ws = new WebSocket(`${URL_RELAIS}/?salon=${SALON}`);
  const recus = [];

  ws.addEventListener('message', (event) => recus.push(JSON.parse(event.data)));

  const pret = new Promise((resolve) => {
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'join', room: SALON, name: nom }));
      resolve();
    });
  });

  return {
    nom,
    ws,
    recus,
    pret,
    envoyer: (message) => ws.send(JSON.stringify(message)),
    dernier: (type) => [...recus].reverse().find((m) => m.type === type),
    combien: (type) => recus.filter((m) => m.type === type).length,
  };
}

const a = joueur('Ali');
const b = joueur('Bea');
await Promise.all([a.pret, b.pret]);
await attendre(400);

console.log(`Salon ${SALON} sur ${URL_RELAIS}\n`);

// Le salon se forme chez les deux, avec les deux pseudos.
verifier(a.dernier('waiting')?.players === 2, 'Ali voit deux joueurs');
verifier(b.dernier('waiting')?.players === 2, 'Bea voit deux joueurs');
verifier(
  a.dernier('waiting')?.names.join() === 'Ali,Bea',
  `les pseudos sont annonces : ${JSON.stringify(a.dernier('waiting')?.names)}`,
);

// Le depart, demande par celui qui n'est pas arrive le premier : la partie doit
// commencer chez les DEUX. C'est precisement ce qui echouait en pair-a-pair.
b.envoyer({ type: 'begin' });
await attendre(400);

const departA = a.dernier('start');
const departB = b.dernier('start');
verifier(Boolean(departA) && Boolean(departB), 'la partie demarre chez les deux');
verifier(departA?.seed === departB?.seed, `meme graine (${departA?.seed})`);
verifier(departA?.playerId !== departB?.playerId, 'chacun recoit son propre identifiant');

// Le handicap s'applique aux AUTRES : celui qui efface les lignes ne se
// penalise pas lui-meme.
const avant = a.combien('action');
a.envoyer({ type: 'action', action: { type: 'garbage', columns: [1, 4] } });
await attendre(300);
verifier(b.dernier('action')?.action.columns.join() === '1,4', 'Bea recoit le handicap d Ali');
verifier(a.combien('action') === avant, 'Ali ne se penalise pas lui-meme');

// Le canal decoratif : opaque, et jamais renvoye a son emetteur.
const avantPlateau = a.combien('board');
a.envoyer({ type: 'board', board: 'xxxx' });
await attendre(300);
verifier(b.dernier('board')?.board === 'xxxx', 'Bea voit le plateau d Ali');
verifier(a.combien('board') === avantPlateau, 'Ali ne recoit pas son propre plateau');

// Le verdict : le dernier en jeu l'emporte, et tout le monde l'apprend.
a.envoyer({ type: 'over' });
await attendre(300);
verifier(a.dernier('finished')?.winner === departB?.playerId, 'Ali perd, Bea l emporte');
verifier(b.dernier('finished')?.winner === departB?.playerId, 'Bea recoit le meme verdict');

a.ws.close();
b.ws.close();

console.log(`\n${echecs === 0 ? 'Tout est passe.' : `${echecs} echec(s).`}`);
process.exit(echecs === 0 ? 0 : 1);
