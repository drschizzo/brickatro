import { isColorless } from './bricks';
import type { Pot, PotBrick } from './pot';

export type FigureId = 'haute' | 'paire' | 'doublepaire' | 'brelan' | 'suite' | 'couleur' | 'full' | 'carre' | 'quinteflush';

export interface FigureDef {
  id: FigureId;
  name: string;
  desc: string;
  chips: number;
  mult: number;
  /** Gain par niveau (Astres). */
  lvlChips: number;
  lvlMult: number;
}

/** Ordre = hiérarchie (de la plus faible à la plus forte). Valeurs reprises de Balatro. */
export const FIGURES: FigureDef[] = [
  { id: 'haute', name: 'Brique haute', desc: 'La brique de plus forte valeur', chips: 5, mult: 1, lvlChips: 10, lvlMult: 1 },
  { id: 'paire', name: 'Paire', desc: '2 briques de même valeur', chips: 10, mult: 2, lvlChips: 15, lvlMult: 1 },
  { id: 'doublepaire', name: 'Double paire', desc: '2 paires', chips: 20, mult: 2, lvlChips: 20, lvlMult: 1 },
  { id: 'brelan', name: 'Brelan', desc: '3 briques de même valeur', chips: 30, mult: 3, lvlChips: 20, lvlMult: 2 },
  { id: 'suite', name: 'Suite', desc: '5 valeurs qui se suivent (ex. 3-4-5-6-7)', chips: 30, mult: 4, lvlChips: 30, lvlMult: 3 },
  { id: 'couleur', name: 'Couleur', desc: '5 briques de la même couleur', chips: 35, mult: 4, lvlChips: 15, lvlMult: 2 },
  { id: 'full', name: 'Full', desc: 'Un brelan + une paire', chips: 40, mult: 4, lvlChips: 25, lvlMult: 2 },
  { id: 'carre', name: 'Carré', desc: '4 briques de même valeur', chips: 60, mult: 7, lvlChips: 30, lvlMult: 3 },
  { id: 'quinteflush', name: 'Quinte flush', desc: 'Une suite de la même couleur', chips: 100, mult: 8, lvlChips: 40, lvlMult: 4 },
];

export const FIGURE_BY_ID = Object.fromEntries(FIGURES.map((f) => [f.id, f])) as Record<FigureId, FigureDef>;

export type FigureLevels = Record<FigureId, number>;
export const newLevels = (): FigureLevels =>
  Object.fromEntries(FIGURES.map((f) => [f.id, 1])) as FigureLevels;

export const figureValue = (f: FigureDef, lvl: number) => ({
  chips: f.chips + (lvl - 1) * f.lvlChips,
  mult: f.mult + (lvl - 1) * f.lvlMult,
});

export const figureIndex = (f: FigureDef | null) => (f ? FIGURES.indexOf(f) : -1);

export interface Evaluation {
  figure: FigureDef | null;
  /** Briques qui "comptent" (comme les cartes qui marquent dans Balatro). Les Pierres comptent toujours. */
  scoring: PotBrick[];
}

/** Description d'une Figure selon les règles (Suite et Couleur à 4 briques en v3). */
export function figureDesc(f: FigureDef, short: boolean): string {
  if (!short) return f.desc;
  if (f.id === 'suite') return '4 valeurs qui se suivent (ex. 3-4-5-6)';
  if (f.id === 'couleur') return '4 briques de la même couleur';
  if (f.id === 'quinteflush') return 'Une suite de 4 de la même couleur';
  return f.desc;
}

/** Plus longue suite de valeurs consécutives (valeurs distinctes triées). */
function straightCards(valued: PotBrick[], need: number): PotBrick[] | null {
  const byVal = new Map<number, PotBrick>();
  for (const b of valued) if (!byVal.has(b.value)) byVal.set(b.value, b);
  const vals = [...byVal.keys()].sort((a, b) => a - b);
  for (let i = vals.length - need; i >= 0; i--) {
    if (vals[i + need - 1] - vals[i] === need - 1) return vals.slice(i, i + need).map((v) => byVal.get(v)!);
  }
  return null;
}

/**
 * Évalue une main de 5 briques max comme une main de poker.
 * short : Suite et Couleur se font avec 4 briques (comme le Joker « Four Fingers » de Balatro).
 */
export function evaluateHand(hand: PotBrick[], chameleon = false, short = false): Evaluation {
  if (!hand.length) return { figure: null, scoring: [] };
  const stones = hand.filter((b) => isColorless(b));
  const valued = hand.filter((b) => !isColorless(b));
  const withStones = (list: PotBrick[]) => [...list, ...stones];
  if (!valued.length) return { figure: FIGURE_BY_ID.haute, scoring: stones };

  const need = short ? 4 : 5;
  const groups = new Map<number, PotBrick[]>();
  for (const b of valued) groups.set(b.value, [...(groups.get(b.value) ?? []), b]);
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length || b[0].value - a[0].value);
  // Caméléon : Feu ≈ Foudre et Eau ≈ Terre (2 familles au lieu de 4 couleurs)
  const fam = (b: PotBrick) => (chameleon ? b.color % 2 : b.color);
  const byColor = new Map<number, PotBrick[]>();
  for (const b of valued) byColor.set(fam(b), [...(byColor.get(fam(b)) ?? []), b]);
  const flushSet = [...byColor.values()].find((l) => l.length >= need) ?? null;
  const straight = straightCards(valued, need);
  const sf = flushSet ? straightCards(flushSet, need) : null;
  // Une suite de 5 garde ses 5 briques
  const withFifth = (cards: PotBrick[]) => {
    const five = straightCards(valued, 5);
    return five && cards.every((c) => five.includes(c)) ? five : cards;
  };
  // À 5 briques, Suite et Couleur prennent toute la Main (dans son ordre)
  const whole = (cards: PotBrick[]) => (short ? withStones(cards) : hand);

  if (sf) return { figure: FIGURE_BY_ID.quinteflush, scoring: whole(withFifth(sf)) };
  if (sorted[0].length >= 4) return { figure: FIGURE_BY_ID.carre, scoring: withStones(sorted[0]) };
  if (sorted[0].length === 3 && sorted[1]?.length >= 2) return { figure: FIGURE_BY_ID.full, scoring: hand };
  if (flushSet) return { figure: FIGURE_BY_ID.couleur, scoring: whole(flushSet) };
  if (straight) return { figure: FIGURE_BY_ID.suite, scoring: whole(withFifth(straight)) };
  if (sorted[0].length === 3) return { figure: FIGURE_BY_ID.brelan, scoring: withStones(sorted[0]) };
  if (sorted[0].length === 2 && sorted[1]?.length === 2) return { figure: FIGURE_BY_ID.doublepaire, scoring: withStones([...sorted[0], ...sorted[1]]) };
  if (sorted[0].length === 2) return { figure: FIGURE_BY_ID.paire, scoring: withStones(sorted[0]) };
  const high = valued.reduce((a, b) => (b.value > a.value ? b : a));
  return { figure: FIGURE_BY_ID.haute, scoring: withStones([high]) };
}

export const evaluate = (pot: Pot) => evaluateHand(pot.bricks, pot.chameleon, pot.short);
