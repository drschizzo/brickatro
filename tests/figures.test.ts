import { describe, expect, it } from 'vitest';
import { evaluateHand as evalGlobal, setShortFigures } from '../src/rules/figures';
import { pb } from './helpers';

const evaluateHand = (hand: ReturnType<typeof pb>[], chameleon = false, short = false) => {
  setShortFigures(short);
  return evalGlobal(hand, chameleon);
};
const fig = (hand: ReturnType<typeof pb>[], short = false, chameleon = false) => evaluateHand(hand, chameleon, short).figure?.id ?? null;

describe('evaluateHand (Suite / Couleur à 5)', () => {
  it('reconnaît les mains de poker', () => {
    expect(fig([])).toBeNull();
    expect(fig([pb(3)])).toBe('haute');
    expect(fig([pb(3), pb(3, 1)])).toBe('paire');
    expect(fig([pb(3), pb(3, 1), pb(5), pb(5, 2)])).toBe('doublepaire');
    expect(fig([pb(3), pb(3, 1), pb(3, 2)])).toBe('brelan');
    expect(fig([pb(3), pb(4, 1), pb(5, 2), pb(6), pb(7, 3)])).toBe('suite');
    expect(fig([pb(1), pb(4), pb(5), pb(6), pb(9)])).toBe('couleur');
    expect(fig([pb(3), pb(3, 1), pb(3, 2), pb(5), pb(5, 2)])).toBe('full');
    expect(fig([pb(3), pb(3, 1), pb(3, 2), pb(3, 3)])).toBe('carre');
    expect(fig([pb(3), pb(4), pb(5), pb(6), pb(7)])).toBe('quinteflush');
  });

  it('ne fait pas de Suite ni de Couleur à 4', () => {
    expect(fig([pb(3), pb(4, 1), pb(5, 2), pb(6)])).toBe('haute');
    expect(fig([pb(1), pb(4), pb(5), pb(9)])).toBe('haute');
  });

  it('les Pierres comptent toujours mais n\'ont ni couleur ni valeur', () => {
    const stone = pb(0, 0, { enh: 'pierre' });
    const ev = evaluateHand([pb(3), pb(3, 1), stone]);
    expect(ev.figure?.id).toBe('paire');
    expect(ev.scoring).toContain(stone);
  });

  it('Caméléon : Feu ≈ Foudre', () => {
    const hand = [pb(1, 0), pb(4, 2), pb(5, 0), pb(6, 2), pb(9, 0)];
    expect(fig(hand)).toBe('haute');
    expect(fig(hand, false, true)).toBe('couleur');
  });
});

describe('evaluateHand (Suite / Couleur à 4, règles v3)', () => {
  it('Suite et Couleur à 4', () => {
    expect(fig([pb(3), pb(4, 1), pb(5, 2), pb(6)], true)).toBe('suite');
    expect(fig([pb(1), pb(4), pb(5), pb(9)], true)).toBe('couleur');
    expect(fig([pb(3), pb(4), pb(5), pb(6), pb(9, 1)], true)).toBe('quinteflush');
  });

  it('une Suite de 5 garde ses 5 briques', () => {
    const hand = [pb(3), pb(4, 1), pb(5, 2), pb(6), pb(7, 3)];
    expect(evaluateHand(hand, false, true).scoring).toHaveLength(5);
  });

  it('les autres Figures ne changent pas', () => {
    expect(fig([pb(3), pb(3, 1), pb(3, 2), pb(5), pb(5, 2)], true)).toBe('full');
    expect(fig([pb(3), pb(3, 1)], true)).toBe('paire');
  });
});
