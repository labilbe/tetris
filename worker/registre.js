/**
 * Le registre des parties : quelles parties ont eu lieu, et ou.
 *
 * Un seul objet pour tout le relais. Sans lui, relire un journal supposerait de
 * se souvenir du code du salon — ce qui marche quand on vient de jouer, et pas
 * du tout trois jours plus tard, c'est-a-dire exactement quand on en a besoin.
 *
 * Il ne contient que des resumes : le salon, le moment, les pseudos presents, et
 * l'issue. Le detail vit dans le journal du salon concerne.
 */

import { DurableObject } from 'cloudflare:workers';

/** Au-dela, les plus anciennes s'effacent : rien ne s'accumule sans fin. */
const PARTIES_GARDEES = 20;

export class Registre extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS parties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        salon TEXT NOT NULL,
        partie INTEGER NOT NULL,
        debut INTEGER NOT NULL,
        fin INTEGER,
        joueurs TEXT NOT NULL,
        issue TEXT
      )
    `);
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'POST') {
      const { action, salon, partie, joueurs, issue } = await request.json();

      if (action === 'debut') {
        this.ctx.storage.sql.exec(
          'INSERT INTO parties (salon, partie, debut, joueurs) VALUES (?, ?, ?, ?)',
          salon, partie, Date.now(), JSON.stringify(joueurs ?? []),
        );
        this.elaguer();
      } else if (action === 'fin') {
        this.ctx.storage.sql.exec(
          'UPDATE parties SET fin = ?, issue = ? WHERE salon = ? AND partie = ?',
          Date.now(), issue ?? null, salon, partie,
        );
      }

      return new Response(null, { status: 204 });
    }

    const lignes = [...this.ctx.storage.sql.exec(
      'SELECT salon, partie, debut, fin, joueurs, issue FROM parties ORDER BY id DESC LIMIT ?',
      Number(url.searchParams.get('limite') ?? PARTIES_GARDEES),
    )];

    return Response.json(lignes.map((l) => ({
      salon: l.salon,
      partie: l.partie,
      debut: new Date(l.debut).toISOString(),
      fin: l.fin ? new Date(l.fin).toISOString() : null,
      joueurs: JSON.parse(l.joueurs),
      issue: l.issue,
      journal: `/journal?salon=${encodeURIComponent(l.salon)}&partie=${l.partie}`,
    })));
  }

  /** Ne garde que les dernieres parties. */
  elaguer() {
    this.ctx.storage.sql.exec(
      'DELETE FROM parties WHERE id <= (SELECT MAX(id) FROM parties) - ?',
      PARTIES_GARDEES,
    );
  }
}
