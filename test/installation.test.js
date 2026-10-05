/**
 * Tests de l'installation : le bouton du menu, et la liste des fichiers mis en
 * cache par sw.js.
 *
 * Cette liste est la seule chose fragile de tout le dispositif : un module
 * ajoute au jeu et oublie dans sw.js donnerait une application installee qui
 * marche tant qu'il y a du reseau, et tombe en panne le jour ou il n'y en a
 * plus — la panne la plus desagreable qui soit, puisqu'elle ne se voit pas en
 * developpement. D'ou un test qui relit le dossier.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { brancherInstallation, enregistrerServiceWorker } from '../src/view/installation.js';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');

function lire(fichier) {
  return readFileSync(join(racine, fichier), 'utf8');
}

/** Les chemins listes dans FICHIERS, tels qu'ecrits dans sw.js. */
function fichiersDuCache() {
  const liste = /const FICHIERS = \[([\s\S]*?)\];/.exec(lire('sw.js'));
  assert.ok(liste, 'sw.js doit declarer FICHIERS');
  return [...liste[1].matchAll(/'([^']+)'/g)].map(([, chemin]) => chemin);
}

/** Tous les modules du jeu, retrouves sur le disque. */
function modulesDuJeu(dossier = 'src') {
  return readdirSync(join(racine, dossier), { withFileTypes: true }).flatMap((entree) => {
    const chemin = `${dossier}/${entree.name}`;
    if (entree.isDirectory()) return modulesDuJeu(chemin);
    return entree.name.endsWith('.js') ? [chemin] : [];
  });
}

describe('fichiers mis en cache', () => {
  const caches = fichiersDuCache();

  it('couvre tous les modules du jeu', () => {
    for (const module of modulesDuJeu()) {
      assert.ok(caches.includes(module), `${module} manque dans la liste de sw.js`);
    }
  });

  it('couvre tout ce que la page demande', () => {
    const page = lire('index.html');
    const demandes = [...page.matchAll(/(?:href|src)="(?!https?:|data:|#)([^"]+)"/g)]
      .map(([, chemin]) => chemin);

    assert.ok(demandes.length > 0);
    for (const demande of demandes) {
      assert.ok(caches.includes(demande), `${demande} manque dans la liste de sw.js`);
    }
  });

  it('ne liste que des fichiers qui existent', () => {
    for (const fichier of caches) {
      if (fichier === './') continue;
      assert.doesNotThrow(() => lire(fichier), `${fichier} est liste mais absent`);
    }
  });

  it('garde les icones du manifeste', () => {
    const manifeste = JSON.parse(lire('manifest.webmanifest'));
    for (const icone of manifeste.icons) {
      assert.ok(caches.includes(icone.src), `${icone.src} manque dans la liste de sw.js`);
    }
  });

  it("n'emploie que des chemins relatifs, la page vivant sous /tetris/", () => {
    for (const fichier of caches) assert.ok(!fichier.startsWith('/'), fichier);
  });
});

describe('manifeste', () => {
  const manifeste = JSON.parse(lire('manifest.webmanifest'));

  it('demande une fenetre a lui, depuis la racine du jeu', () => {
    assert.equal(manifeste.display, 'standalone');
    assert.equal(manifeste.start_url, './');
    assert.equal(manifeste.scope, './');
  });

  it('porte les deux tailles que Chrome exige, et une icone masquable', () => {
    const tailles = manifeste.icons.map((icone) => icone.sizes);
    assert.ok(tailles.includes('192x192'));
    assert.ok(tailles.includes('512x512'));
    assert.ok(manifeste.icons.some((icone) => icone.purpose === 'maskable'));
  });
});

/** Une fenetre de pacotille : elle retient les ecouteurs et les declenche. */
function fausseFenetre() {
  const ecouteurs = new Map();
  return {
    addEventListener(nom, ecouteur) {
      ecouteurs.set(nom, ecouteur);
    },
    emettre(nom, evenement = {}) {
      return ecouteurs.get(nom)?.(evenement);
    },
    connait: (nom) => ecouteurs.has(nom),
  };
}

function fauxBouton() {
  let clic = null;
  return {
    hidden: true,
    addEventListener(nom, ecouteur) {
      if (nom === 'click') clic = ecouteur;
    },
    cliquer: () => clic?.(),
  };
}

describe('bouton d\'installation', () => {
  it('reste cache tant que le navigateur n\'a rien propose', () => {
    const bouton = fauxBouton();
    brancherInstallation({ bouton, fenetre: fausseFenetre() });
    assert.equal(bouton.hidden, true);
  });

  it('apparait quand le navigateur juge la page installable', () => {
    const bouton = fauxBouton();
    const fenetre = fausseFenetre();
    brancherInstallation({ bouton, fenetre });

    let empeche = false;
    fenetre.emettre('beforeinstallprompt', { preventDefault: () => { empeche = true; } });

    assert.equal(bouton.hidden, false);
    // Sans cela, la banniere du navigateur ferait doublon avec le bouton.
    assert.equal(empeche, true);
  });

  it('ouvre l\'invite au clic, puis se retire', async () => {
    const bouton = fauxBouton();
    const fenetre = fausseFenetre();
    brancherInstallation({ bouton, fenetre });

    let ouvertures = 0;
    fenetre.emettre('beforeinstallprompt', {
      preventDefault() {},
      prompt: async () => { ouvertures += 1; },
    });

    await bouton.cliquer();
    assert.equal(ouvertures, 1);
    assert.equal(bouton.hidden, true);

    // L'invite est consommee : un second clic ne doit pas la rouvrir.
    await bouton.cliquer();
    assert.equal(ouvertures, 1);
  });

  it('se retire quand le jeu est installe par un autre chemin', () => {
    const bouton = fauxBouton();
    const fenetre = fausseFenetre();
    brancherInstallation({ bouton, fenetre });

    fenetre.emettre('beforeinstallprompt', { preventDefault() {} });
    fenetre.emettre('appinstalled');
    assert.equal(bouton.hidden, true);
  });

  it('ne branche rien sans bouton', () => {
    const fenetre = fausseFenetre();
    brancherInstallation({ bouton: null, fenetre });
    assert.equal(fenetre.connait('beforeinstallprompt'), false);
  });
});

describe('enregistrement du service worker', () => {
  it('passe son chemin quand le navigateur n\'en veut pas', async () => {
    assert.equal(await enregistrerServiceWorker({}), null);
  });

  it('demande sw.js, sans passer par le cache du navigateur', async () => {
    const demandes = [];
    const navigateur = {
      serviceWorker: {
        register: async (script, options) => {
          demandes.push([script, options]);
          return 'enregistre';
        },
      },
    };

    assert.equal(await enregistrerServiceWorker(navigateur), 'enregistre');
    assert.deepEqual(demandes, [['sw.js', { updateViaCache: 'none' }]]);
  });

  it('ne fait pas tomber le jeu si l\'enregistrement echoue', async () => {
    const navigateur = { serviceWorker: { register: async () => { throw new Error('refuse'); } } };
    assert.equal(await enregistrerServiceWorker(navigateur), null);
  });
});
