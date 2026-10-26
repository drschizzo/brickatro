/**
 * Test de référence : des runs complets joués par le bot du banc, à graine fixe.
 * Le moteur est déterministe : toute différence de résultat signale un changement de règles.
 * Après un changement VOULU des règles : `npx vitest run -u` pour réenregistrer la référence.
 * La physique est chaotique : un écart d'un bit dans les calculs flottants change la partie. La référence est
 * enregistrée sur macOS ARM (Apple Silicon) et ne se vérifie que sur cette architecture (la CI de test tourne sur macOS).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Bot, SKILLS, type BotConfig, type RunRecord } from '../bench/bot';

const BASE: Omit<BotConfig, 'skill' | 'shop'> = {
  deck: 'rouge', stake: 0, riskMargin: 0.15, maxAnte: 8, assistDeg: null, wall: null,
  plan: { discount: 0.8 }, ruleset: 'v3',
};

/** Résumé lisible d'un run (le hash couvre tout le reste). */
const digest = (r: RunRecord) => ({
  seed: r.seed, won: r.won, ante: r.ante, wall: r.wallIdx, bestHand: r.bestHand,
  cashes: r.cashes.length, total: r.cashes.reduce((s, c) => s + c.total, 0), relics: r.relics.join(','),
});

function play(cfg: Partial<BotConfig>, seeds: number[]) {
  const recs = seeds.map((s) => new Bot({ ...BASE, skill: SKILLS.moyen, shop: 'greedy', ...cfg }, s).playRun());
  return { runs: recs.map(digest), hash: createHash('sha256').update(JSON.stringify(recs)).digest('hex').slice(0, 16) };
}

describe('runs de référence (bot moyen, boutique greedy)', () => {
  it('règles v3', () => {
    expect(play({}, [1, 7920, 15839, 23758])).toMatchSnapshot();
  });

  it('règles classic', () => {
    expect(play({ ruleset: 'classic' }, [1, 7920])).toMatchSnapshot();
  });

  it('Reliques de comportement (Pinceau, Voisinage, Maçon fou, Mitose, Pacte)', () => {
    expect(play({ relics: ['pinceau', 'voisinage', 'macon', 'mitose', 'pacte'] }, [3, 11])).toMatchSnapshot();
  });

  it('Reliques diverses (Démolisseur, Inflation, Souffleur, Siamoise, Filet)', () => {
    expect(play({ relics: ['demolisseur', 'inflation', 'souffleur', 'siamoise', 'filet'], tools: ['echange', 'trait'] }, [5, 13])).toMatchSnapshot();
  });

  it('Défausses, Outils et Runes offertes', () => {
    expect(play({ relics: ['grandmenage', 'minimaliste'], gift: 'r-scission', deck: 'recycle' }, [17])).toMatchSnapshot();
  });

  it('pose en Filons (blocs) et règle « première brique »', () => {
    expect(play({ ruleset: 'classic', wall: { style: 'mixed', order: 0.6, lookahead: 20 }, head: { shardRate: 0.5, mode: 'first' } }, [19])).toMatchSnapshot();
  });
});
