import { isColorless, type BrickColor } from './bricks';
import { BOMB_DELAY, type BreakInfo, type EffectApi } from './effects';
import { FIGURE_BY_ID, figureIndex } from './figures';
import type { Pot } from './pot';
import { EDGE_CATCH } from './prowess';
import type { ScoreAcc, ScoreCtx, ScoreResult } from './scoring';

export type Rarity = 'commun' | 'rare' | 'légendaire';

/** Archétypes : les Reliques d'un même archétype se renforcent entre elles. */
export type Archetype = 'couleur' | 'valeur' | 'adresse' | 'combo' | 'perfo' | 'eco' | 'verre' | 'scaling' | 'copie' | 'enchant' | 'espace' | 'raquette' | 'tri';
export const ARCHETYPE_NAMES: Record<Archetype, string> = {
  couleur: 'Couleur', valeur: 'Valeur', adresse: 'Adresse', combo: 'Combo', perfo: 'Perforation', eco: 'Économie',
  verre: 'Verre', scaling: 'Évolutive', copie: 'Relance', enchant: 'Enchantement', espace: 'Espace', raquette: 'Raquette', tri: 'Défausse',
};

export interface RelicInstance {
  def: RelicDef;
  counter: number;
  /** Édition Polychrome : ×1.5 Mult en plus de son effet. */
  poly?: boolean;
}

export interface RelicDef {
  id: string;
  name: string;
  glyph: string;
  rarity: Rarity;
  tags: Archetype[];
  desc: (r: RelicInstance) => string;
  /** Contribution au scoring, appelée dans l'ordre des emplacements (gauche → droite). */
  score?: (ctx: ScoreCtx, acc: ScoreAcc, r: RelicInstance) => void;
  /** Après un encaissement réel, non annulé par un Boss (Reliques évolutives). */
  onCashIn?: (r: RelicInstance, res: ScoreResult, pot: Pot) => void;
  /** Balle principale perdue (avant l'Assurance). */
  onBallLost?: (r: RelicInstance, api: EffectApi) => void;
  /** Renvoi de la balle principale sur la raquette (après la Série et la Frénésie). */
  onRebound?: (r: RelicInstance, api: EffectApi) => void;
  /** Une brique casse (après les effets de son amélioration). */
  onBrickBroken?: (r: RelicInstance, api: EffectApi, info: BreakInfo) => void;
  onGlassBroken?: (r: RelicInstance, n: number) => void;
  /** Au début de chaque Mur : nb de briques de la pioche à transformer en Verre. */
  glassifyOnWall?: number;
  speedMul?: number;
  paddleMul?: number;
  lancers?: number;
  secousses?: number;
  /** Défausses en plus par Mur (règles v3). */
  discards?: number;
  /** Briques en plus remplacées par chaque Défausse. */
  discardSize?: number;
  /** Sans Défausse (règles d'origine), la Relique ne sert à rien : pas proposée en boutique. */
  needsDiscard?: boolean;
  /** Sans Filons (pose aléatoire), la Relique ne sert à rien : pas proposée en boutique. */
  needsVeins?: boolean;
  interestCap?: number;
  rerollDiscount?: number;
  keepOnLoss?: number;
  retriggerFirst?: number;
  /** Relance les briques touchées par le haut. */
  retriggerAbove?: number;
  retriggerEnhanced?: number;
  retriggerColor?: { color: number; n: number };
  chameleon?: boolean;
  bigBomb?: boolean;
  /** Balles perdues rattrapées par Mur. */
  nets?: number;
  midas?: boolean;
  astroBonus?: number;
  /** Gain de ×Mult supplémentaire par renvoi de la Série. */
  seriesStep?: number;
  /** Copie le score de la Relique à droite. */
  copy?: boolean;
  /** Au début de chaque Mur : nb de briques du deck qui gagnent +1. */
  inflate?: number;
  /** Raquette jumelle au plafond. */
  twin?: boolean;
  /** Renvois de Série en plus (ou en moins) pour déclencher la Frénésie. */
  frenzyStreak?: number;
}

/** La Main contient-elle 3 valeurs consécutives ? */
const hasRun3 = (pot: Pot) => {
  const v = new Set(pot.bricks.filter((b) => b.enh !== 'pierre').map((b) => b.value));
  for (const x of v) if (v.has(x + 1) && v.has(x + 2)) return true;
  return false;
};

/** Briques qui comptent d'une couleur donnée. */
const perColor = (color: number) => (ctx: ScoreCtx) => ctx.pot.count((b) => ctx.pot.matches(b, color), ctx.scoring);
/** ×Mult cumulatif (x par élément), arrondi au centième. */
const xPow = (x: number, n: number) => Math.round(Math.pow(x, n) * 100) / 100;
const BRELAN = figureIndex(FIGURE_BY_ID.brelan);
const MASON_VALUE = 7;
const MITOSIS_REBOUND = 3;

export const RELICS: RelicDef[] = [
  // ───────── Couleur ─────────
  {
    id: 'pyromane', name: 'Pyromane', glyph: '🔥', rarity: 'commun', tags: ['couleur'],
    desc: () => '{m}+6 Mult{/} par brique {feu}Feu{/} qui compte',
    score: (ctx, acc) => { const n = perColor(0)(ctx); if (n) acc.mult(6 * n); },
  },
  {
    id: 'tesla', name: 'Tesla', glyph: '⚡', rarity: 'rare', tags: ['couleur'],
    desc: () => '{x}×1.25 Mult{/} par brique {foudre}Foudre{/} qui compte (cumulatif)',
    score: (ctx, acc) => { const n = perColor(2)(ctx); if (n) acc.xmult(xPow(1.25, n)); },
  },
  {
    id: 'monomane', name: 'Monomane', glyph: '◆', rarity: 'rare', tags: ['couleur'],
    desc: () => '{x}×2 Mult{/} si la Figure est une {k}Couleur{/} (ou Quinte flush)',
    score: (ctx, acc) => { if (ctx.figure?.id === 'couleur' || ctx.figure?.id === 'quinteflush') acc.xmult(2); },
  },
  {
    id: 'fanatique', name: 'Fanatique', glyph: '☯', rarity: 'rare', tags: ['couleur'],
    desc: () => '{x}×3 Mult{/} si toutes les briques de la Main ont la même couleur (3 min.)',
    score: (ctx, acc) => {
      const n = ctx.pot.bricks.length;
      if (n >= 3 && ctx.pot.distinctColors() === 1 && ctx.pot.count((b) => b.enh === 'pierre') === 0) acc.xmult(3);
    },
  },
  {
    id: 'arcenciel', name: 'Arc-en-ciel', glyph: '◈', rarity: 'commun', tags: ['couleur'],
    desc: () => '{m}+4 Mult{/} par couleur différente dans la Main',
    score: (ctx, acc) => { const n = ctx.pot.distinctColors(); if (n) acc.mult(4 * n); },
  },
  {
    id: 'cameleon', name: 'Caméléon', glyph: '🦎', rarity: 'rare', tags: ['couleur'],
    desc: () => '{feu}Feu{/} et {foudre}Foudre{/} comptent comme une même couleur, {eau}Eau{/} et {terre}Terre{/} aussi',
    chameleon: true,
  },
  {
    id: 'pinceau', name: 'Pinceau', glyph: '🖌', rarity: 'rare', tags: ['couleur', 'espace'],
    desc: () => 'Quand une brique casse, ses {k}voisines de rangée{/} prennent sa couleur (pour ce Mur)',
    onBrickBroken: (_r, api, { brick, card }) => {
      if (isColorless(card)) return;
      // Copie de carte limitée à ce Mur, le deck ne change pas
      const ids: number[] = [];
      for (const nb of api.rowNeighbors(brick)) {
        const c = api.card(nb.uid);
        if (!c || isColorless(c) || c.color === card.color) continue;
        api.patchCard(nb, { color: card.color });
        nb.color = card.color;
        ids.push(nb.id);
      }
      if (ids.length) api.painted(ids, card.color);
    },
  },
  // ───────── Espace : où les briques étaient sur le mur ─────────
  {
    id: 'geometre', name: 'Géomètre', glyph: '📐', rarity: 'commun', tags: ['espace'],
    desc: () => '{m}+4 Mult{/} par brique de la Main qui partage sa {k}rangée{/} avec une autre',
    score: (ctx, acc) => {
      const rows = new Map<number, number>();
      for (const b of ctx.pot.bricks) rows.set(b.row, (rows.get(b.row) ?? 0) + 1);
      const n = ctx.pot.count((b) => (rows.get(b.row) ?? 0) >= 2);
      if (n) acc.mult(4 * n);
    },
  },
  {
    id: 'lignedemire', name: 'Ligne de mire', glyph: '⌖', rarity: 'rare', tags: ['espace'],
    desc: () => '{x}×2 Mult{/} si {k}4 briques{/} de la Main ou plus viennent de la {k}même rangée{/}',
    score: (ctx, acc) => {
      const rows = new Map<number, number>();
      for (const b of ctx.pot.bricks) rows.set(b.row, (rows.get(b.row) ?? 0) + 1);
      if (Math.max(0, ...rows.values()) >= 4) acc.xmult(2);
    },
  },
  {
    id: 'cartographe', name: 'Cartographe', glyph: '🗺', rarity: 'commun', tags: ['espace'], needsVeins: true,
    desc: () => '{m}+3 Mult{/} par brique de la Main venue d\'un {k}Filon{/}, {x}×1.5 Mult{/} si 3 viennent du même',
    score: (ctx, acc) => {
      const v = new Map<number, number>();
      for (const b of ctx.pot.bricks) if (b.vein) v.set(b.vein, (v.get(b.vein) ?? 0) + 1);
      const n = [...v.values()].reduce((s, x) => s + x, 0);
      if (n) acc.mult(3 * n);
      if (Math.max(0, ...v.values()) >= 3) acc.xmult(1.5);
    },
  },
  {
    id: 'voisinage', name: 'Voisinage', glyph: '🏘', rarity: 'rare', tags: ['espace', 'perfo'],
    desc: () => 'Quand la balle casse une brique, ses {k}voisines de rangée de même valeur{/} cassent aussi',
    onBrickBroken: (_r, api, { brick, card, cause }) => {
      // Pas de réaction en chaîne : une brique explosée ne fait pas casser ses voisines
      if (cause === 'explosion' || isColorless(card)) return;
      for (const nb of api.rowNeighbors(brick)) {
        const c = api.card(nb.uid);
        if (c && !isColorless(c) && c.value === card.value) api.explode(nb.id, BOMB_DELAY * 1.5);
      }
    },
  },
  // ───────── Raquette ─────────
  {
    id: 'poignet', name: 'Coup de poignet', glyph: '🏓', rarity: 'commun', tags: ['raquette'],
    desc: () => '{m}+6 Mult{/} par renvoi sur le {k}bord{/} de la raquette pendant le Lancer',
    score: (ctx, acc) => { if (ctx.pot.edgeRebounds) acc.mult(6 * ctx.pot.edgeRebounds); },
  },
  {
    id: 'filet', name: 'Filet', glyph: '🥅', rarity: 'rare', tags: ['raquette'],
    desc: () => '{k}1 fois par Mur{/}, une balle perdue rebondit sur un filet : la Main est gardée',
    nets: 1,
  },
  // ───────── Valeur ─────────
  {
    id: 'poucet', name: 'Petit Poucet', glyph: '🐁', rarity: 'rare', tags: ['valeur'],
    desc: () => '{x}×2 Mult{/} si toutes les briques de la Main valent {k}5 ou moins{/}',
    score: (ctx, acc) => { const v = ctx.pot.bricks.filter((b) => b.enh !== 'pierre'); if (v.length >= 3 && v.every((b) => b.value <= 5)) acc.xmult(2); },
  },
  {
    id: 'colosse', name: 'Colosse', glyph: '🗿', rarity: 'commun', tags: ['valeur'],
    desc: () => '{c}+30 Jetons{/} par brique de valeur {k}8 ou plus{/} qui compte',
    score: (ctx, acc) => { const n = ctx.scoring.filter((b) => b.enh !== 'pierre' && b.value >= 8).length; if (n) acc.chips(30 * n); },
  },
  {
    id: 'decimal', name: 'Décimal', glyph: '🔟', rarity: 'rare', tags: ['valeur'],
    desc: () => 'Chaque {k}10{/} qui compte donne {x}×1.5 Mult{/}',
    score: (ctx, acc) => { const n = ctx.scoring.filter((b) => b.enh !== 'pierre' && b.value === 10).length; if (n) acc.xmult(xPow(1.5, n)); },
  },
  {
    id: 'dynastie', name: 'Dynastie', glyph: '🏰', rarity: 'légendaire', tags: ['valeur', 'scaling'],
    desc: (r) => `Gagne {x}×0.2 Mult{/} à chaque {k}Brelan{/} ou mieux encaissé (actuel {x}×${(1 + 0.2 * r.counter).toFixed(1)}{/})`,
    onCashIn: (r, res) => { if (figureIndex(res.figure) >= BRELAN) r.counter++; },
    score: (_c, acc, r) => { if (r.counter) acc.xmult(Math.round((1 + 0.2 * r.counter) * 10) / 10); },
  },
  // ───────── Adresse ─────────
  {
    id: 'billard', name: 'Billard', glyph: '🎱', rarity: 'commun', tags: ['adresse'],
    desc: () => '{m}+6 Mult{/} de plus par {k}Bande{/}',
    score: (ctx, acc) => { const p = ctx.prowess.find((x) => x.id === 'bande'); if (p) acc.mult(6 * p.count); },
  },
  {
    id: 'flipperrelic', name: 'Flipper', glyph: '🕹', rarity: 'commun', tags: ['adresse'],
    desc: () => '{c}+60 Jetons{/} et {m}+4 Mult{/} par {k}Carambolage{/}',
    score: (ctx, acc) => { const p = ctx.prowess.find((x) => x.id === 'carambole'); if (p) { acc.chips(60 * p.count); acc.mult(4 * p.count); } },
  },
  {
    id: 'voltigeur', name: 'Voltigeur', glyph: '🤸', rarity: 'rare', tags: ['adresse', 'copie'],
    desc: () => 'Les briques touchées {k}par-dessus{/} sont {k}relancées{/}',
    retriggerAbove: 1,
  },
  {
    id: 'showman', name: 'Showman', glyph: '🎩', rarity: 'rare', tags: ['adresse'],
    desc: () => '{x}×2 Mult{/} si la Main réunit {k}3 Prouesses{/} différentes ou plus',
    score: (ctx, acc) => { if (ctx.prowess.length >= 3) acc.xmult(2); },
  },
  {
    id: 'acrobate', name: 'Acrobate', glyph: '🎪', rarity: 'rare', tags: ['adresse', 'scaling'],
    desc: (r) => `Gagne {m}+1 Mult{/} par Prouesse encaissée (actuel {m}+${r.counter}{/})`,
    onCashIn: (r, res) => { r.counter += res.prowess.reduce((s, p) => s + p.count, 0); },
    score: (_c, acc, r) => { if (r.counter) acc.mult(r.counter); },
  },
  {
    id: 'sniper', name: "Tireur d'élite", glyph: '🎯', rarity: 'rare', tags: ['adresse'],
    desc: () => '{x}×1.5 Mult{/} par brique {k}★ cible{/} dans la Main',
    score: (ctx, acc) => { const n = ctx.pot.count((b) => b.star); if (n) acc.xmult(xPow(1.5, n)); },
  },
  // ───────── Combo ─────────
  {
    id: 'glouton', name: 'Glouton', glyph: '◉', rarity: 'commun', tags: ['raquette', 'combo'],
    desc: () => '{c}+15 Jetons{/} par rebond sur la raquette',
    score: (ctx, acc) => { if (ctx.pot.rebounds) acc.chips(15 * ctx.pot.rebounds); },
  },
  {
    id: 'vertige', name: 'Vertige', glyph: '∞', rarity: 'rare', tags: ['combo'],
    desc: () => 'La {k}Série{/} monte plus vite : {x}+×0.15{/} de plus par renvoi',
    seriesStep: 0.15,
  },
  {
    id: 'kamikaze', name: 'Kamikaze', glyph: '✈', rarity: 'rare', tags: ['combo'],
    desc: () => '{x}×2 Mult{/}. La balle va {k}15% plus vite{/}',
    speedMul: 1.15,
    score: (_c, acc) => acc.xmult(2),
  },
  {
    id: 'accelerateur', name: 'Accélérateur', glyph: '➹', rarity: 'rare', tags: ['combo'],
    desc: () => '{x}×Mult{/} égal à la vitesse de la balle (×1 au départ)',
    score: (ctx, acc) => { const x = Math.round((ctx.ballSpeed / 13) * 100) / 100; if (x > 1) acc.xmult(x); },
  },
  {
    id: 'gravite', name: 'Gravité Zéro', glyph: '☾', rarity: 'commun', tags: ['combo'],
    desc: () => 'La balle est {k}20% plus lente{/}',
    speedMul: 0.8,
  },
  {
    id: 'funambule', name: 'Funambule', glyph: '⚖️', rarity: 'rare', tags: ['adresse', 'raquette'],
    desc: () => '{x}×2 Mult{/} si tu encaisses sur le {k}bord{/} de la raquette',
    score: (ctx, acc) => { if (ctx.catchOffset !== null && Math.abs(ctx.catchOffset) > EDGE_CATCH) acc.xmult(2); },
  },
  {
    id: 'ambidextre', name: 'Ambidextre', glyph: '⟷', rarity: 'commun', tags: ['raquette'],
    desc: () => 'Raquette {k}25% plus large{/}',
    paddleMul: 1.25,
  },
  {
    id: 'marathon', name: 'Marathonien', glyph: '🏃', rarity: 'commun', tags: ['combo', 'scaling'],
    desc: (r) => `{m}+1 Mult{/} tous les 10 rebonds raquette du run (actuel {m}+${Math.floor(r.counter / 10)}{/})`,
    onRebound: (r) => { r.counter++; },
    score: (_c, acc, r) => { const n = Math.floor(r.counter / 10); if (n) acc.mult(n); },
  },
  // ───────── Perforation ─────────
  {
    id: 'belier', name: 'Bélier', glyph: '♈', rarity: 'commun', tags: ['perfo'],
    desc: () => '{c}+30 Jetons{/} par brique {k}traversée{/} ou {k}explosée{/} dans la Main',
    score: (ctx, acc) => { const n = ctx.pot.count((b) => b.cause !== 'ball'); if (n) acc.chips(30 * n); },
  },
  {
    id: 'demolisseur', name: 'Démolisseur', glyph: '💣', rarity: 'rare', tags: ['perfo', 'enchant'],
    desc: () => 'Les {k}Bombes{/} explosent en carré 3×3. {m}+6 Mult{/} par Bombe dans la Main',
    bigBomb: true,
    score: (ctx, acc) => { const n = ctx.pot.count((b) => b.enh === 'bombe'); if (n) acc.mult(6 * n); },
  },
  {
    id: 'berserker', name: 'Berserker', glyph: '👹', rarity: 'rare', tags: ['perfo'],
    desc: () => '{x}×1.5 Mult{/} par brique de la Main {k}traversée{/} ou {k}explosée{/}',
    score: (ctx, acc) => { const n = ctx.pot.count((b) => b.cause !== 'ball'); if (n) acc.xmult(xPow(1.5, n)); },
  },
  {
    id: 'artificier', name: 'Artificier', glyph: '🎆', rarity: 'commun', tags: ['perfo', 'eco'],
    desc: () => '{g}+$1{/} par brique explosée pendant le Lancer',
    score: (ctx, acc) => { const n = ctx.pot.count((b) => b.cause === 'explosion'); if (n) acc.money(n); },
  },
  // ───────── Économie ─────────
  {
    id: 'avare', name: 'Avare', glyph: '¤', rarity: 'commun', tags: ['eco'],
    desc: () => '{g}+$1{/} par brique cassée pendant le Lancer. {k}−1 Lancer{/}',
    lancers: -1,
    score: (ctx, acc) => acc.money(ctx.pot.broken),
  },
  {
    id: 'rentier', name: 'Rentier', glyph: '💰', rarity: 'rare', tags: ['eco'],
    desc: () => '{m}+2 Mult{/} par tranche de {g}$5{/} possédés',
    score: (ctx, acc) => { const n = Math.floor(ctx.run.money / 5); if (n) acc.mult(2 * n); },
  },
  {
    id: 'banquier', name: 'Banquier', glyph: '🏦', rarity: 'commun', tags: ['eco'],
    desc: () => 'Intérêts plafonnés à {g}$10{/} au lieu de {g}$5{/}',
    interestCap: 10,
  },
  {
    id: 'marchand', name: 'Marchand', glyph: '🛒', rarity: 'commun', tags: ['eco'],
    desc: () => 'Les relances de la boutique coûtent {g}$2{/} de moins',
    rerollDiscount: 2,
  },
  {
    id: 'midas', name: 'Midas', glyph: '👑', rarity: 'rare', tags: ['eco', 'enchant'],
    desc: () => 'Les briques {k}Or{/} donnent aussi {x}×1.5 Mult{/}',
    midas: true,
  },
  // ───────── Verre ─────────
  {
    id: 'vitrier', name: 'Vitrier', glyph: '🔲', rarity: 'rare', tags: ['verre', 'scaling'],
    desc: (r) => `{x}×0.5 Mult{/} par brique de {k}Verre{/} brisée ce run (actuel {x}×${1 + 0.5 * r.counter}{/})`,
    onGlassBroken: (r, n) => { r.counter += n; },
    score: (_c, acc, r) => { if (r.counter) acc.xmult(1 + 0.5 * r.counter); },
  },
  {
    id: 'souffleur', name: 'Souffleur', glyph: '🍾', rarity: 'commun', tags: ['verre', 'enchant'],
    desc: () => 'Au début de chaque Mur, {k}2 briques{/} de ton deck deviennent {k}Verre{/}. {m}+3 Mult{/} par Verre dans la Main',
    glassifyOnWall: 2,
    score: (ctx, acc) => { const n = ctx.pot.count((b) => b.enh === 'verre'); if (n) acc.mult(3 * n); },
  },
  // ───────── Évolutives ─────────
  {
    id: 'rancune', name: 'Rancune', glyph: '☠', rarity: 'légendaire', tags: ['scaling'],
    desc: (r) => `{x}×0.5 Mult{/} par balle perdue ce run (actuel {x}×${1 + 0.5 * r.counter}{/})`,
    onBallLost: (r) => { r.counter++; },
    score: (_c, acc, r) => { if (r.counter) acc.xmult(1 + 0.5 * r.counter); },
  },
  {
    id: 'stalagmite', name: 'Stalagmite', glyph: '▲', rarity: 'commun', tags: ['scaling'],
    desc: (r) => `Gagne {c}+8 Jetons{/} à chaque encaissement (actuel {c}+${8 * r.counter}{/})`,
    onCashIn: (r) => { r.counter++; },
    score: (_c, acc, r) => { if (r.counter) acc.chips(8 * r.counter); },
  },
  {
    id: 'prismophile', name: 'Escalier', glyph: '📶', rarity: 'rare', tags: ['scaling', 'valeur'],
    desc: (r) => `Gagne {m}+3 Mult{/} à chaque Main contenant {k}3 valeurs qui se suivent{/} (actuel {m}+${3 * r.counter}{/})`,
    onCashIn: (r, _f, pot) => { if (hasRun3(pot)) r.counter++; },
    score: (_c, acc, r) => { if (r.counter) acc.mult(3 * r.counter); },
  },
  {
    id: 'mecene', name: 'Mécène', glyph: '🎭', rarity: 'légendaire', tags: ['scaling'],
    desc: () => '{x}×0.4 Mult{/} par Relique possédée',
    score: (ctx, acc) => acc.xmult(Math.round((1 + 0.4 * ctx.run.relicCount) * 10) / 10),
  },
  // ───────── Relance / copie ─────────
  {
    id: 'echo', name: 'Écho', glyph: '◎', rarity: 'commun', tags: ['copie'],
    desc: () => 'La {k}première brique qui compte{/} est {k}relancée{/}',
    retriggerFirst: 1,
  },
  {
    id: 'reverb', name: 'Réverbération', glyph: '〰', rarity: 'rare', tags: ['copie', 'enchant'],
    desc: () => 'Les briques {k}enchantées{/} qui comptent sont {k}relancées{/}',
    retriggerEnhanced: 1,
  },
  {
    id: 'tonnerre', name: 'Tonnerre', glyph: '⛈️', rarity: 'rare', tags: ['copie', 'couleur'],
    desc: () => 'Les briques {foudre}Foudre{/} sont {k}relancées{/}',
    retriggerColor: { color: 2, n: 1 },
  },
  {
    id: 'reflet', name: 'Reflet', glyph: '⧉', rarity: 'légendaire', tags: ['copie'],
    desc: () => 'Copie l\'effet de score de la Relique {k}à sa droite{/}',
    copy: true,
  },
  // ───────── Enchantement / divers ─────────
  {
    id: 'joaillier', name: 'Joaillier', glyph: '💎', rarity: 'commun', tags: ['enchant'],
    desc: () => '{m}+8 Mult{/} par brique {k}enchantée{/} dans la Main',
    score: (ctx, acc) => { const n = ctx.pot.count((b) => b.enh !== 'none' || b.edition !== 'none'); if (n) acc.mult(8 * n); },
  },
  {
    id: 'assurance', name: 'Assurance', glyph: '☔', rarity: 'rare', tags: ['combo'],
    desc: () => 'Balle perdue : tu encaisses quand même la Main à {k}75%{/}',
    keepOnLoss: 0.75,
  },
  {
    id: 'dernier', name: 'Dernier Souffle', glyph: '⌛', rarity: 'rare', tags: ['combo'],
    desc: () => '{x}×3 Mult{/} pendant le {k}dernier Lancer{/} du Mur',
    score: (ctx, acc) => { if (ctx.run.lastLancer) acc.xmult(3); },
  },
  // ───────── Folie ─────────
  {
    id: 'pacte', name: 'Pacte du Diable', glyph: '😈', rarity: 'rare', tags: ['combo'],
    desc: () => '{x}×2 Mult{/}. Chaque {k}balle perdue{/} détruit une {k}autre Relique{/} au hasard',
    onBallLost: (_r, api) => {
      const relics = api.run.relics;
      const victims = relics.filter((x) => x.def.id !== 'pacte');
      if (victims.length) api.relicLost(relics.indexOf(api.run.rng.pick(victims)));
    },
    score: (_c, acc) => acc.xmult(2),
  },
  {
    id: 'macon', name: 'Maçon fou', glyph: '🧱', rarity: 'rare', tags: ['raquette', 'perfo'],
    desc: () => `Chaque renvoi sur la raquette fait apparaître une brique {k}${MASON_VALUE}{/} sur le mur (pour ce Mur)`,
    onRebound: (_r, api) => {
      const free = api.freeSlots();
      if (!free.length) return;
      const id = api.run.rng.pick(free);
      api.spawnTemp(id, api.run.rng.int(4) as BrickColor, MASON_VALUE);
      api.spawned([id]);
    },
  },
  {
    id: 'inflation', name: 'Inflation', glyph: '🎈', rarity: 'rare', tags: ['valeur', 'enchant'],
    desc: () => 'Au début de chaque Mur, {k}3 briques{/} de ton deck gagnent {k}+1{/}. Un {k}10{/} devient {k}Polychrome{/} à la place',
    inflate: 3,
  },
  {
    id: 'collection', name: 'Collectionneur', glyph: '📚', rarity: 'rare', tags: ['scaling'],
    desc: (r) => `{x}×0.15 Mult{/} par main {k}Brelan ou mieux{/} différente encaissée ce run (actuel {x}×${collectionX(r)}{/})`,
    onCashIn: (r, res) => { if (figureIndex(res.figure) >= BRELAN) r.counter |= 1 << figureIndex(res.figure); },
    score: (_c, acc, r) => { const x = collectionX(r); if (x > 1) acc.xmult(x); },
  },
  {
    id: 'siamoise', name: 'Raquette siamoise', glyph: '🪞', rarity: 'rare', tags: ['raquette', 'adresse'],
    desc: () => 'Une 2e raquette au {k}plafond{/}, en miroir de la tienne. Chaque rebond dessus fait monter la {k}Série{/} et donne {m}+6 Mult{/}',
    twin: true,
    score: (ctx, acc) => { if (ctx.pot.twinHits) acc.mult(6 * ctx.pot.twinHits); },
  },
  {
    id: 'mitose', name: 'Mitose', glyph: '🧫', rarity: 'rare', tags: ['combo'],
    desc: () => `Au {k}${MITOSIS_REBOUND}e renvoi{/} de chaque Lancer, la balle se {k}divise en 2{/}`,
    onRebound: (_r, api) => { if (api.pot.rebounds === MITOSIS_REBOUND) api.world.splitBall(0.35); },
  },
  {
    id: 'jongleur', name: 'Jongleur', glyph: '🤹', rarity: 'commun', tags: ['combo'],
    desc: () => '{m}+8 Mult{/} par {k}balle supplémentaire{/} encore en l\'air quand tu encaisses',
    score: (ctx, acc) => { if (ctx.pot.airBalls) acc.mult(8 * ctx.pot.airBalls); },
  },
  {
    id: 'brasier', name: 'Brasier', glyph: '🌋', rarity: 'commun', tags: ['combo'],
    desc: () => 'La {k}Frénésie{/} se déclenche après {k}3 renvois{/} de Série au lieu de 5',
    frenzyStreak: -2,
  },
  {
    id: 'sismographe', name: 'Sismographe', glyph: '📈', rarity: 'commun', tags: ['combo', 'raquette'],
    desc: () => '{x}×1.5 Mult{/} si tu as donné une {k}Secousse{/} pendant le Lancer',
    score: (ctx, acc) => { if (ctx.pot.shakes) acc.xmult(1.5); },
  },
  {
    id: 'econome', name: 'Économe', glyph: '🧺', rarity: 'commun', tags: ['eco'],
    desc: () => '{m}+4 Mult{/} par {k}Secousse{/} restante',
    score: (ctx, acc) => { if (ctx.run.secoussesLeft) acc.mult(4 * ctx.run.secoussesLeft); },
  },
  // ───────── Défausse ─────────
  {
    id: 'recycleur', name: 'Recycleur', glyph: '♻', rarity: 'commun', tags: ['tri'],
    desc: () => '{k}+1 Défausse{/} par Mur',
    discards: 1, needsDiscard: true,
  },
  {
    id: 'grandmenage', name: 'Grand ménage', glyph: '🧹', rarity: 'rare', tags: ['tri'],
    desc: () => "{k}+1 Défausse{/} par Mur, et chaque Défausse remplace jusqu'à {k}5 briques{/}",
    discards: 1, discardSize: 2, needsDiscard: true,
  },
  {
    id: 'minimaliste', name: 'Minimaliste', glyph: '🍃', rarity: 'commun', tags: ['tri', 'eco'],
    desc: () => '{m}+5 Mult{/} par {k}Défausse{/} restante',
    needsDiscard: true,
    score: (ctx, acc) => { if (ctx.run.discardsLeft) acc.mult(5 * ctx.run.discardsLeft); },
  },
  {
    id: 'astrologue', name: 'Astrologue', glyph: '🔭', rarity: 'rare', tags: ['scaling'],
    desc: () => 'Les {k}Astres{/} donnent {k}1 niveau de plus{/}',
    astroBonus: 1,
  },
];

export const RELIC_BY_ID = Object.fromEntries(RELICS.map((r) => [r.id, r])) as Record<string, RelicDef>;
export const MAX_RELICS = 5;
export const RELIC_PRICE: Record<Rarity, number> = { commun: 5, rare: 7, légendaire: 10 };

/** Modificateurs déclarés par les Reliques (les clés se déduisent de RelicDef : rien à tenir à jour à la main). */
type KeysOf<T> = { [K in keyof RelicDef]-?: NonNullable<RelicDef[K]> extends T ? K : never }[keyof RelicDef];
export type NumMod = Exclude<KeysOf<number>, 'speedMul' | 'paddleMul' | 'interestCap' | 'keepOnLoss'>;
export type MulMod = 'speedMul' | 'paddleMul';
export type FlagMod = KeysOf<boolean>;

/** Somme d'un modificateur numérique sur toutes les reliques. */
export const sumMod = (relics: RelicInstance[], key: NumMod) =>
  relics.reduce((s, r) => s + (r.def[key] ?? 0), 0);
export const prodMod = (relics: RelicInstance[], key: MulMod) =>
  relics.reduce((s, r) => s * (r.def[key] ?? 1), 1);
export const hasFlag = (relics: RelicInstance[], key: FlagMod) => relics.some((r) => r.def[key]);

/** Collectionneur : ×(1 + 0.15 par main de poker différente encaissée), le compteur est un masque de bits. */
function collectionX(r: RelicInstance) {
  let n = 0;
  for (let m = r.counter; m; m &= m - 1) n++;
  return Math.round((1 + 0.15 * n) * 100) / 100;
}
