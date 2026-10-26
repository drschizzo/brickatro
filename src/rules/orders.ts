import type { Rng } from '../core/rng';
import { COLOR_NAMES, COLOR_TAGS, isColorless, type BrickCard, type BrickColor } from './bricks';
import type { FigureDef } from './figures';
import type { PotBrick } from './pot';

/**
 * Commandes : à chaque Mur, 2 Figures précises sont demandées (une facile, une difficile).
 * Une Main qui en remplit une rapporte de l'argent et ×1,5 Mult. Elles sont tirées à partir des briques
 * réellement posées sur le mur, pour être toujours réalisables. Elles remplacent les Filons :
 * l'objectif est dit en clair au lieu d'être suggéré par la pose.
 */
export type OrderKind = 'paire' | 'brelan' | 'couleur' | 'suite' | 'full' | 'carre';

export interface Order {
  kind: OrderKind;
  value?: number;
  color?: BrickColor;
  money: number;
  done: boolean;
}

export const ORDER_XMULT = 1.5;

export function orderLabel(o: Order): string {
  const v = o.value ? ` de {k}${o.value}{/}` : '';
  switch (o.kind) {
    case 'paire': return `Paire${v}`;
    case 'brelan': return `Brelan${v}`;
    case 'carre': return `Carré${v}`;
    case 'full': return 'Full';
    case 'suite': return 'Suite';
    case 'couleur': return `Couleur {${COLOR_TAGS[o.color!]}}${COLOR_NAMES[o.color!]}{/}`;
  }
}

const sameValue = (scoring: PotBrick[], n: number, value?: number) => {
  const counts = new Map<number, number>();
  for (const b of scoring) if (!isColorless(b)) counts.set(b.value, (counts.get(b.value) ?? 0) + 1);
  return [...counts.entries()].some(([v, k]) => k >= n && (value === undefined || v === value));
};

/** La Main (Figure + briques qui comptent) remplit-elle la Commande ? Une Figure plus forte qui la contient compte. */
export function fulfills(o: Order, figure: FigureDef | null, scoring: PotBrick[]): boolean {
  if (!figure) return false;
  switch (o.kind) {
    case 'paire': return sameValue(scoring, 2, o.value);
    case 'brelan': return sameValue(scoring, 3, o.value);
    case 'carre': return figure.id === 'carre' && sameValue(scoring, 4, o.value);
    case 'full': return figure.id === 'full';
    case 'suite': return figure.id === 'suite' || figure.id === 'quinteflush';
    case 'couleur': return (figure.id === 'couleur' || figure.id === 'quinteflush') && scoring.some((b) => b.color === o.color);
  }
}

/** Tire 2 Commandes réalisables avec les briques du mur. */
export function rollOrders(rng: Rng, wall: BrickCard[], ante: number, short: boolean): Order[] {
  const cards = wall.filter((c) => !isColorless(c));
  const byValue = new Map<number, number>();
  const byColor = [0, 0, 0, 0];
  for (const c of cards) {
    byValue.set(c.value, (byValue.get(c.value) ?? 0) + 1);
    byColor[c.color]++;
  }
  const values = (n: number) => [...byValue.entries()].filter(([, k]) => k >= n).map(([v]) => v);
  const easy: Order[] = [];
  for (const v of values(2)) easy.push({ kind: 'paire', value: v, money: 2, done: false });
  if (ante >= 3) for (const v of values(3)) easy.push({ kind: 'brelan', value: v, money: 3, done: false });
  const hard: Order[] = [];
  const need = short ? 4 : 5;
  byColor.forEach((n, c) => n >= need + 1 && hard.push({ kind: 'couleur', color: c as BrickColor, money: 4, done: false }));
  const vs = [...byValue.keys()].sort((a, b) => a - b);
  if (vs.some((v) => [...Array(need).keys()].every((k) => byValue.has(v + k)))) hard.push({ kind: 'suite', money: 4, done: false });
  if (values(3).length && values(2).length >= 2) hard.push({ kind: 'full', money: 5, done: false });
  for (const v of values(4)) hard.push({ kind: 'carre', value: v, money: 6, done: false });
  const out: Order[] = [];
  if (easy.length) out.push(rng.pick(easy));
  if (hard.length) out.push(rng.pick(hard));
  return out;
}
