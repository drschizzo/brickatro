import type { Rng } from '../core/rng';

export type BrickColor = 0 | 1 | 2 | 3;
export const COLOR_NAMES = ['Feu', 'Eau', 'Foudre', 'Terre'] as const;
export const COLOR_TAGS = ['feu', 'eau', 'foudre', 'terre'] as const;
export const colorText = (c: BrickColor) => `{${COLOR_TAGS[c]}}${COLOR_NAMES[c]}{/}`;

export type Enh = 'none' | 'verre' | 'or' | 'acier' | 'bombe' | 'chance' | 'pierre' | 'bonus' | 'mult' | 'mimic' | 'reine' | 'fuyarde' | 'pinata' | 'joker';
export type Edition = 'none' | 'metal' | 'holo' | 'poly';

/** Une "carte" du deck : une brique persistante que le joueur fait évoluer pendant le run. */
export interface BrickCard {
  uid: number;
  color: BrickColor;
  /** Valeur 1 à 10 (affichée sur la brique). */
  value: number;
  enh: Enh;
  edition: Edition;
}

export const ENH: Record<Enh, { name: string; desc: string; code: number }> = {
  none: { name: 'Brique', desc: '{c}+Jetons{/} égaux à sa valeur', code: 0 },
  verre: { name: 'Verre', desc: '{x}×2 Mult{/}, 1 chance sur 4 de se briser définitivement', code: 1 },
  or: { name: 'Or', desc: '{g}+$2{/} à l\'encaissement', code: 2 },
  acier: { name: 'Acier', desc: 'Résiste à 1 coup. {x}×1.5 Mult{/}', code: 3 },
  bombe: { name: 'Bombe', desc: 'Explose et casse les briques voisines (en croix)', code: 4 },
  chance: { name: 'Chance', desc: '1 sur 4 : {m}+20 Mult{/}. 1 sur 12 : {g}+$10{/}', code: 5 },
  pierre: { name: 'Pierre', desc: '{c}+50 Jetons{/}, sans couleur ni valeur, compte toujours', code: 6 },
  bonus: { name: 'Bonus', desc: '{c}+30 Jetons{/} supplémentaires', code: 7 },
  mult: { name: 'Mult', desc: '{m}+4 Mult{/}', code: 8 },
  // Briques vivantes (codes 13+ : 9 à 12 sont les blocs du shader)
  mimic: { name: 'Mimic', desc: 'Sa {k}valeur change{/} à chaque renvoi sur la raquette : casse-la au bon moment', code: 13 },
  reine: { name: 'Reine', desc: 'À chaque Lancer, elle {k}pond une brique{/} de sa couleur à côté d\'elle', code: 14 },
  fuyarde: { name: 'Fuyarde', desc: 'Au 1er coup, elle {k}s\'enfuit{/} ailleurs sur le mur. Attrapée : {c}+40 Jetons{/}', code: 15 },
  joker: { name: 'Joker', desc: 'En entrant dans la Main, prend la {k}valeur et la couleur{/} qui l\'arrangent le plus', code: 5 },
  pinata: { name: 'Piñata', desc: 'Résiste à {k}3 coups{/}. Cassée : {g}+$3{/} et une {k}balle bonus{/}', code: 16 },
};

/** Briques vivantes : elles bougent, changent ou se multiplient sur le mur. */
export const LIVING: Enh[] = ['mimic', 'reine', 'fuyarde', 'pinata'];

export const EDITION: Record<Edition, { name: string; desc: string; code: number }> = {
  none: { name: '', desc: '', code: 0 },
  metal: { name: 'Métal', desc: '{c}+50 Jetons{/}', code: 1 },
  holo: { name: 'Holo', desc: '{m}+10 Mult{/}', code: 2 },
  poly: { name: 'Polychrome', desc: '{x}×1.5 Mult{/}', code: 3 },
};

let uidSeq = 1;
export const newCard = (color: BrickColor, value: number, enh: Enh = 'none', edition: Edition = 'none'): BrickCard => ({
  uid: uidSeq++, color, value, enh, edition,
});
export const cloneCard = (c: BrickCard): BrickCard => ({ ...c, uid: uidSeq++ });

/** Une brique sans couleur ne compte pas pour les Figures de couleur. */
export const isColorless = (c: { enh: Enh }) => c.enh === 'pierre';

export function cardLabel(c: BrickCard) {
  const parts = c.enh === 'pierre' ? [] : [`{k}${c.value}{/} ${colorText(c.color)}`];
  if (c.enh !== 'none') parts.push(`{k}${ENH[c.enh].name}{/}`);
  if (c.edition !== 'none') parts.push(`{k}${EDITION[c.edition].name}{/}`);
  return parts.join(' ');
}

export function cardDesc(c: BrickCard) {
  const d: string[] = [];
  if (c.enh !== 'none') d.push(`${ENH[c.enh].name} : ${ENH[c.enh].desc}`);
  if (c.edition !== 'none') d.push(`${EDITION[c.edition].name} : ${EDITION[c.edition].desc}`);
  return d.join('<br>') || ENH.none.desc;
}

/** Brique aléatoire enrichie (packs de briques). */
export function randomFancyCard(rng: Rng, colors: BrickColor[]): BrickCard {
  const enhs: Enh[] = ['verre', 'or', 'acier', 'bombe', 'chance', 'pierre', 'bonus', 'mult', 'bonus', 'mult', 'chance', ...LIVING];
  const r = rng.next();
  const edition: Edition = r < 0.06 ? 'poly' : r < 0.16 ? 'holo' : r < 0.3 ? 'metal' : 'none';
  return newCard(rng.pick(colors), 1 + rng.int(10), rng.pick(enhs), edition);
}
