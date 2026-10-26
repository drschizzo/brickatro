import { newCard, type BrickCard, type BrickColor } from './bricks';

export interface DeckDef {
  id: string;
  name: string;
  glyph: string;
  color: string;
  desc: string;
  /** Meilleure Ante atteinte nécessaire pour débloquer. */
  unlockAnte: number;
  build: () => BrickCard[];
  lancers?: number;
  secousses?: number;
  /** Défausses en plus par Mur (règles v3). */
  discards?: number;
  money?: number;
  consumableSlots?: number;
}

/** 1 brique par couleur et par valeur (1 à 10) : 40 briques, comme un jeu de cartes. */
const standard = (colors: BrickColor[] = [0, 1, 2, 3], copies = 1) =>
  colors.flatMap((c) => Array.from({ length: 10 * copies }, (_, i) => newCard(c, (i % 10) + 1)));

export const DECKS: DeckDef[] = [
  { id: 'rouge', name: 'Deck Rouge', glyph: '🟥', color: '#fe5f55', desc: '{k}+1 Secousse{/} par Mur', unlockAnte: 0, build: () => standard(), secousses: 1 },
  { id: 'bleu', name: 'Deck Bleu', glyph: '🟦', color: '#2d9cff', desc: '{k}+1 Lancer{/} par Mur', unlockAnte: 0, build: () => standard(), lancers: 1 },
  { id: 'recycle', name: 'Deck Recyclé', glyph: '♻', color: '#7dffb0', desc: '{k}+1 Défausse{/} par Mur', unlockAnte: 1, build: () => standard(), discards: 1 },
  { id: 'dore', name: 'Deck Doré', glyph: '🟨', color: '#ffc53d', desc: 'Commence avec {g}$10{/} de plus', unlockAnte: 2, build: () => standard(), money: 10 },
  { id: 'bicolore', name: 'Deck Bicolore', glyph: '◐', color: '#b85cff', desc: 'Seulement {feu}Feu{/} et {eau}Eau{/}, en double. Couleurs faciles', unlockAnte: 3, build: () => standard([0, 1], 2) },
  {
    id: 'verre', name: 'Deck de Cristal', glyph: '💠', color: '#9fe8ff', desc: 'Commence avec {k}8 briques de Verre{/}', unlockAnte: 4,
    build: () => { const d = standard(); for (let i = 0; i < 8; i++) d[i * 5].enh = 'verre'; return d; },
  },
  { id: 'fourre', name: 'Deck Fourre-tout', glyph: '🎒', color: '#3fd18f', desc: '{k}+1 emplacement{/} de consommable', unlockAnte: 5, build: () => standard(), consumableSlots: 1 },
];

export interface StakeDef {
  name: string;
  color: string;
  desc: string;
  targetMul: number;
  lancers: number;
  noSmallReward: boolean;
  interestOff: boolean;
}

/** Mises (difficulté) : chaque victoire débloque la suivante, effets cumulés. */
export const STAKES: StakeDef[] = [
  { name: 'Mise Blanche', color: '#f4f1ff', desc: 'Les règles de base', targetMul: 1, lancers: 0, noSmallReward: false, interestOff: false },
  { name: 'Mise Rouge', color: '#fe5f55', desc: 'Le Petit Mur ne rapporte pas d\'argent', targetMul: 1, lancers: 0, noSmallReward: true, interestOff: false },
  { name: 'Mise Verte', color: '#3fd18f', desc: '+ Objectifs ×1.3', targetMul: 1.3, lancers: 0, noSmallReward: true, interestOff: false },
  { name: 'Mise Noire', color: '#555a7a', desc: '+ −1 Lancer par Mur', targetMul: 1.3, lancers: -1, noSmallReward: true, interestOff: false },
  { name: 'Mise d\'Or', color: '#ffc53d', desc: '+ Pas d\'intérêts, objectifs ×1.6', targetMul: 1.6, lancers: -1, noSmallReward: true, interestOff: true },
];

/** Objectifs proches de Balatro : sans synergies, on bloque vers l'Ante 3-4. */
export const ANTE_BASE = [1000, 2600, 6500, 13500, 26000, 46000, 75000, 115000];
export const WIN_ANTE = 8;
export const WALL_NAMES = ['Petit Mur', 'Grand Mur', 'Mur Boss'] as const;
export const WALL_MUL = [1, 1.5, 2];
export const WALL_REWARD = [3, 4, 5];

/**
 * Objectifs des règles v3 (une carte par trajet) : réglés au banc pour retrouver la marge score/objectif
 * de la v2 Ante par Ante (le Joker et les Commandes facilitent surtout le début).
 */
export const ANTE_BASE_V3 = [1000, 2100, 4500, 8600, 14200, 22500, 32500, 47000];

export function wallTarget(ante: number, wallIdx: number, stake: StakeDef, table: number[] = ANTE_BASE) {
  const base = ante <= table.length ? table[ante - 1] : table[table.length - 1] * Math.pow(2.2, ante - table.length);
  return Math.round((base * WALL_MUL[wallIdx] * stake.targetMul) / 10) * 10;
}
