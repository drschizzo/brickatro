import { describe, expect, it } from 'vitest';
import { newLevels } from '../src/rules/figures';
import { Pot } from '../src/rules/pot';
import { RELIC_BY_ID, type RelicInstance } from '../src/rules/relics';
import { computeScore, type RunView } from '../src/rules/scoring';
import { pb } from './helpers';

const RUN: RunView = { money: 0, deckSize: 40, relicCount: 0, lancersLeft: 2, secoussesLeft: 1, discardsLeft: 0, lastLancer: false };

function score(bricks: ReturnType<typeof pb>[], relicIds: string[] = [], tweak: (p: Pot) => void = () => {}) {
  const pot = new Pot();
  for (const b of bricks) pot.addBrick(b);
  tweak(pot);
  const relics: RelicInstance[] = relicIds.map((id) => ({ def: RELIC_BY_ID[id], counter: 0 }));
  return computeScore({ pot, relics, levels: newLevels(), catchOffset: null, ballSpeed: 13, run: { ...RUN, relicCount: relics.length }, roll: null });
}

describe('computeScore', () => {
  it('Main vide : 0', () => {
    expect(score([]).total).toBe(0);
  });

  it('Paire : (10 + valeurs) × 2', () => {
    const r = score([pb(7), pb(7, 1)]);
    expect(r.figure?.id).toBe('paire');
    expect(r.chips).toBe(10 + 7 + 7);
    expect(r.mult).toBe(2);
    expect(r.total).toBe(48);
  });

  it('les améliorations des briques s\'appliquent', () => {
    expect(score([pb(5), pb(5, 1, { enh: 'bonus' })]).chips).toBe(10 + 5 + 5 + 30);
    expect(score([pb(5), pb(5, 1, { enh: 'mult' })]).mult).toBe(6);
    expect(score([pb(5), pb(5, 1, { enh: 'verre' })]).mult).toBe(4);
    expect(score([pb(5), pb(5, 1, { edition: 'holo' })]).mult).toBe(12);
  });

  it('les Reliques s\'appliquent de gauche à droite', () => {
    // Pyromane : +6 Mult par Feu qui compte (2 ici), puis Kamikaze ×2
    const r = score([pb(4, 0), pb(4, 0)], ['pyromane', 'kamikaze']);
    expect(r.mult).toBe((2 + 12) * 2);
    // Ordre inverse : ×2 avant +12
    expect(score([pb(4, 0), pb(4, 0)], ['kamikaze', 'pyromane']).mult).toBe(2 * 2 + 12);
  });

  it('Reflet copie la Relique à sa droite', () => {
    const r = score([pb(4), pb(4, 1)], ['reflet', 'kamikaze']);
    expect(r.mult).toBe(2 * 2 * 2);
  });

  it('relances : Écho relance la première brique qui compte', () => {
    const r = score([pb(6), pb(6, 1)], ['echo']);
    expect(r.chips).toBe(10 + 6 + 6 + 6);
  });

  it('Série : ×(1 + 0,2 par renvoi)', () => {
    const r = score([pb(6), pb(6, 1)], [], (p) => { p.streak = 3; });
    expect(r.mult).toBe(Math.round(2 * 1.6 * 100) / 100);
  });

  it('Éclats : Jetons en plus', () => {
    const r = score([pb(6), pb(6, 1)], [], (p) => { p.shards = 2; p.shardChips = 7; });
    expect(r.chips).toBe(10 + 12 + 7);
  });

  it('Boss : La Cloche annule la Main sans la valeur imposée', () => {
    const pot = new Pot();
    pot.addBrick(pb(6));
    pot.addBrick(pb(6, 1));
    const r = computeScore({ pot, relics: [], levels: newLevels(), catchOffset: null, ballSpeed: 13, run: RUN, roll: null, rules: { requiredValue: 9 } });
    expect(r.blocked).toMatch(/Cloche/);
    expect(r.total).toBe(0);
  });

  it('chaque Relique de score produit un résultat fini', () => {
    const hand = [pb(3, 0, { star: true }), pb(3, 2, { enh: 'or' }), pb(4, 2, { cause: 'explosion' }), pb(10, 1, { fromAbove: true }), pb(5, 3, { enh: 'verre' })];
    for (const id of Object.keys(RELIC_BY_ID)) {
      const r = score(hand, [id], (p) => { p.rebounds = 3; p.streak = 2; p.edgeRebounds = 1; p.twinHits = 1; p.airBalls = 1; p.shakes = 1; });
      expect(Number.isFinite(r.total), id).toBe(true);
      expect(r.total, id).toBeGreaterThan(0);
    }
  });
});
