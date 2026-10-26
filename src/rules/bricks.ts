import type { Rng } from '../core/rng';
import type { Brick } from '../sim/world';
import { BOMB_DELAY, CROSS, RING, type BreakInfo, type EffectApi, type Offset } from './effects';
import type { ScoreAcc } from './scoring';

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

/** Contexte d'un déclenchement au scoring (relances comprises). */
export interface EnhScoreCtx {
  /** Suffixe d'étiquette (« (relance) »). */
  tag: string;
  /** Relique Midas : l'Or donne aussi ×1.5. */
  midas: boolean;
  /** Hasard (null = aperçu : pas de tirage). */
  roll: (() => number) | null;
}

/**
 * Une amélioration de brique : texte, rendu, et tous ses effets au même endroit.
 * Ajouter une amélioration = ajouter une entrée ici (et son motif dans le shader de briques).
 */
export interface EnhDef {
  name: string;
  desc: string;
  /** Motif du shader de briques (9 à 12 sont les blocs). */
  code: number;
  /** Coups pour la casser (1 par défaut). */
  hp?: number;
  /** À chaque déclenchement au scoring, après ses Jetons de valeur. */
  score?: (acc: ScoreAcc, ctx: EnhScoreCtx) => void;
  /** Chance de se briser définitivement à l'encaissement. */
  shatter?: number;
  /** Brique vivante (malédiction « Mur vivant », packs). */
  living?: boolean;
  /** La brique casse (Main ou Éclat). */
  onBreak?: (api: EffectApi, info: BreakInfo) => void;
  /** Premier coup encaissé sans casser. */
  onDamaged?: (api: EffectApi, brick: Brick) => void;
  /** Renvoi sur la raquette (pour chaque brique de ce type sur le mur). */
  onRebound?: (api: EffectApi, brick: Brick, card: BrickCard) => void;
  /** Début d'un Lancer (pour chaque brique de ce type sur le mur). */
  onLaunch?: (api: EffectApi, brick: Brick) => void;
}

const BONUS_CHIPS = 30;
const MULT_BONUS = 4;
const GLASS_X = 2;
const GLASS_SHATTER = 0.25;
const STEEL_X = 1.5;
const GOLD_MONEY = 2;
const MIDAS_X = 1.5;
const LUCK_MULT = 20;
const LUCK_P = 0.25;
const JACKPOT = 10;
const JACKPOT_P = 1 / 12;
const STONE_CHIPS = 50;
const FLEE_CHIPS = 40;
const PINATA_MONEY = 3;
const PINATA_HITS = 3;
/** La Reine pond d'abord à côté d'elle, puis au-dessus / en dessous, puis en diagonale. */
const EGG_SLOTS: readonly Offset[] = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];

export const ENH: Record<Enh, EnhDef> = {
  none: { name: 'Brique', desc: '{c}+Jetons{/} égaux à sa valeur', code: 0 },
  verre: {
    name: 'Verre', desc: `{x}×${GLASS_X} Mult{/}, 1 chance sur ${1 / GLASS_SHATTER} de se briser définitivement`, code: 1,
    score: (acc, { tag }) => acc.xmult(GLASS_X, `Verre ×${GLASS_X}${tag}`), shatter: GLASS_SHATTER,
  },
  or: {
    name: 'Or', desc: `{g}+$${GOLD_MONEY}{/} à l'encaissement`, code: 2,
    score: (acc, { tag, midas }) => {
      acc.money(GOLD_MONEY, `Or +$${GOLD_MONEY}${tag}`);
      if (midas) acc.xmult(MIDAS_X, `Midas ×${MIDAS_X}${tag}`);
    },
  },
  acier: {
    name: 'Acier', desc: `Résiste à 1 coup. {x}×${STEEL_X} Mult{/}`, code: 3, hp: 2,
    score: (acc, { tag }) => acc.xmult(STEEL_X, `Acier ×${STEEL_X}${tag}`),
  },
  bombe: {
    name: 'Bombe', desc: 'Explose et casse les briques voisines (en croix)', code: 4,
    onBreak: (api, info) => {
      info.bomb = true;
      const big = api.run.relics.some((r) => r.def.bigBomb);
      for (const id of api.around(info.brick, big ? RING : CROSS)) api.explode(id, BOMB_DELAY);
    },
  },
  chance: {
    name: 'Chance', desc: `1 sur ${1 / LUCK_P} : {m}+${LUCK_MULT} Mult{/}. 1 sur ${1 / JACKPOT_P} : {g}+$${JACKPOT}{/}`, code: 5,
    score: (acc, { tag, roll }) => {
      if (!roll) return;
      if (roll() < LUCK_P) acc.mult(LUCK_MULT, `Chance ! +${LUCK_MULT} Mult${tag}`);
      if (roll() < JACKPOT_P) acc.money(JACKPOT, `Jackpot ! +$${JACKPOT}${tag}`);
    },
  },
  pierre: { name: 'Pierre', desc: `{c}+${STONE_CHIPS} Jetons{/}, sans couleur ni valeur, compte toujours`, code: 6 },
  bonus: {
    name: 'Bonus', desc: `{c}+${BONUS_CHIPS} Jetons{/} supplémentaires`, code: 7,
    score: (acc, { tag }) => acc.chips(BONUS_CHIPS, `Bonus +${BONUS_CHIPS}${tag}`),
  },
  mult: {
    name: 'Mult', desc: `{m}+${MULT_BONUS} Mult{/}`, code: 8,
    score: (acc, { tag }) => acc.mult(MULT_BONUS, `+${MULT_BONUS} Mult${tag}`),
  },
  // Briques vivantes (codes 13+ : 9 à 12 sont les blocs du shader)
  mimic: {
    name: 'Mimic', desc: 'Sa {k}valeur change{/} à chaque renvoi sur la raquette : casse-la au bon moment', code: 13, living: true,
    onRebound: (api, brick) => {
      api.patchCard(brick, { value: 1 + api.run.rng.int(10) });
      api.morphed([brick.id]);
    },
  },
  reine: {
    name: 'Reine', desc: 'À chaque Lancer, elle {k}pond une brique{/} de sa couleur à côté d\'elle', code: 14, living: true,
    onLaunch: (api, q) => {
      const free = new Set(api.freeSlots());
      const slot = api.around(q, EGG_SLOTS).find((id) => free.has(id));
      if (slot === undefined) return;
      api.spawnTemp(slot, q.color, 1 + api.run.rng.int(10));
      api.spawned([slot]);
    },
  },
  fuyarde: {
    name: 'Fuyarde', desc: `Au 1er coup, elle {k}s'enfuit{/} ailleurs sur le mur. Attrapée : {c}+${FLEE_CHIPS} Jetons{/}`, code: 15, hp: 2, living: true,
    score: (acc, { tag }) => acc.chips(FLEE_CHIPS, `Fuyarde +${FLEE_CHIPS}${tag}`),
    onDamaged: (api, brick) => {
      const far = api.freeSlots().filter((id) => Math.hypot(api.world.bricks[id].x - brick.x, api.world.bricks[id].y - brick.y) > 3);
      if (!far.length) return;
      const to = api.run.rng.pick(far);
      api.world.moveBrick(brick.id, to);
      api.movedSlot(brick.id, to);
      api.fled(brick.id, to);
    },
  },
  joker: { name: 'Joker', desc: 'En entrant dans la Main, prend la {k}valeur et la couleur{/} qui l\'arrangent le plus', code: 5 },
  pinata: {
    name: 'Piñata', desc: `Résiste à {k}${PINATA_HITS} coups{/}. Cassée : {g}+$${PINATA_MONEY}{/} et une {k}balle bonus{/}`, code: 16, hp: PINATA_HITS + 1, living: true,
    onBreak: (api, info) => {
      info.money += PINATA_MONEY;
      info.tags.push('Piñata');
      const a = api.run.rng.range(-0.6, 0.6);
      api.world.spawnExtra(info.brick.x, info.brick.y, Math.sin(a), -Math.cos(a));
    },
  },
};

/** Briques vivantes : elles bougent, changent ou se multiplient sur le mur. */
export const LIVING = (Object.keys(ENH) as Enh[]).filter((e) => ENH[e].living);

/** Jetons de valeur d'une brique (une Pierre n'a pas de valeur). */
export const brickChips = (c: { value: number; enh: Enh }) => (c.enh === 'pierre' ? STONE_CHIPS : c.value);

export interface EditionDef {
  name: string;
  desc: string;
  code: number;
  score?: (acc: ScoreAcc, tag: string) => void;
}

export const EDITION: Record<Edition, EditionDef> = {
  none: { name: '', desc: '', code: 0 },
  metal: { name: 'Métal', desc: '{c}+50 Jetons{/}', code: 1, score: (acc, tag) => acc.chips(50, `Métal +50${tag}`) },
  holo: { name: 'Holo', desc: '{m}+10 Mult{/}', code: 2, score: (acc, tag) => acc.mult(10, `Holo +10 Mult${tag}`) },
  poly: { name: 'Polychrome', desc: '{x}×1.5 Mult{/}', code: 3, score: (acc, tag) => acc.xmult(1.5, `Poly ×1.5${tag}`) },
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
