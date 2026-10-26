import type { Pot } from './pot';

export type ProwessId = 'bande' | 'dessus' | 'carambole' | 'teleport' | 'double' | 'bord' | 'sansfilet' | 'mille';

export interface ProwessDef {
  id: ProwessId;
  name: string;
  glyph: string;
  desc: string;
}

/** Prouesses : bonus d'adresse qui s'ajoutent à la main de poker. */
export const PROWESS: Record<ProwessId, ProwessDef> = {
  mille: { id: 'mille', name: 'Dans le mille', glyph: '◎', desc: 'Brique au bout du {k}guide doré{/} du renvoi touchée : {m}+4 Mult{/}' },
  bande: { id: 'bande', name: 'Bande', glyph: '↯', desc: '3 rebonds sur les côtés (murs latéraux, bumpers) avant la brique : {m}+4 Mult{/}' },
  dessus: { id: 'dessus', name: 'Par-dessus', glyph: '⤵', desc: 'Brique touchée par le haut : {m}+4 Mult{/}' },
  carambole: { id: 'carambole', name: 'Carambolage', glyph: '✺', desc: 'Brique touchée après un bumper : {m}+6 Mult{/}' },
  teleport: { id: 'teleport', name: 'Téléport', glyph: '◌', desc: 'Brique touchée après un portail : {m}+8 Mult{/}' },
  double: { id: 'double', name: 'Triplé', glyph: '⚡', desc: 'Au moins 3 briques de la Main en un seul trajet : {m}+3 Mult{/} par brique au-delà de 2 (max +9)' },
  bord: { id: 'bord', name: 'Au bord', glyph: '⟂', desc: 'Encaisser sur le bord de la raquette : {m}+5 Mult{/}' },
  sansfilet: { id: 'sansfilet', name: 'Sans filet', glyph: '★', desc: 'Les 5 briques de la Main en un seul trajet : {x}×1.5 Mult{/}' },
};

export interface ProwessHit {
  id: ProwessId;
  count: number;
  mult?: number;
  xmult?: number;
}

/** Au-delà de ce décalage (|offset| de 0 à 1), l'encaissement est fait sur le bord de la raquette (Au bord, Funambule). */
export const EDGE_CATCH = 0.7;

const PER: Partial<Record<ProwessId, number>> = { mille: 4, bande: 4, dessus: 4, carambole: 6, teleport: 8 };

export function computeProwess(pot: Pot, catchOffset: number | null): ProwessHit[] {
  const hand = pot.bricks;
  const out: ProwessHit[] = [];
  const add = (id: ProwessId, count: number) => {
    if (count > 0 && PER[id]) out.push({ id, count, mult: PER[id]! * count });
  };
  add('mille', hand.filter((b) => b.called).length);
  add('bande', hand.filter((b) => b.sideBounces >= 3 && b.cause !== 'explosion').length);
  add('dessus', hand.filter((b) => b.fromAbove).length);
  add('carambole', hand.filter((b) => b.bumped).length);
  add('teleport', hand.filter((b) => b.ported).length);
  const trips = new Map<number, number>();
  for (const b of hand) trips.set(b.trip, (trips.get(b.trip) ?? 0) + 1);
  const extra = [...trips.values()].reduce((s, n) => s + Math.max(0, n - 2), 0);
  if (extra > 0) out.push({ id: 'double', count: extra, mult: Math.min(9, 3 * extra) });
  if (catchOffset !== null && Math.abs(catchOffset) > EDGE_CATCH) out.push({ id: 'bord', count: 1, mult: 5 });
  if (hand.length >= 5 && trips.size === 1) out.push({ id: 'sansfilet', count: 1, xmult: 1.5 });
  return out;
}
