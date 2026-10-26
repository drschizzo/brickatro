import { Rng } from '../core/rng';
import { BALL_BY_ID, type BallDef } from './balls';
import { pickBoss, type BossDef } from './bosses';
import type { BrickCard, BrickColor } from './bricks';
import { MAX_CONSUMABLES, type ConsumableDef } from './consumables';
import { STAKES, WALL_REWARD, wallTarget, type DeckDef, type StakeDef } from './decks';
import type { Rules } from './ruleset';
import { newLevels, type FigureLevels } from './figures';
import { sumMod, type RelicInstance } from './relics';
import type { ToolInstance } from './tools';
import type { WallModOffer } from './wallmods';

export interface BallInstance {
  def: BallDef;
  used: boolean;
}

/** Tout l'état persistant d'un run. */
export interface Run {
  seed: number;
  rng: Rng;
  deck: DeckDef;
  stakeIdx: number;
  stake: StakeDef;
  ante: number;
  wallIdx: number; // 0 Petit, 1 Grand, 2 Boss
  boss: BossDef;
  eclipseColor: BrickColor;
  /** Valeur imposée par La Cloche. */
  bossValue: number;
  /** Dernier motif utilisé (pour éviter les répétitions). */
  lastLayout: string | null;
  money: number;
  cards: BrickCard[];
  relics: RelicInstance[];
  consumables: ConsumableDef[];
  maxConsumables: number;
  balls: BallInstance[];
  tools: ToolInstance[];
  levels: FigureLevels;
  stats: { bestHand: number; ballsLost: number; bricks: number; glass: number; discards: number };
  /** Mode infini (après la victoire à l'Ante 8). */
  endless: boolean;
  /** Malédiction acceptée en boutique pour le prochain Mur, puis active pendant ce Mur. */
  pendingMod: WallModOffer | null;
  wallMod: WallModOffer | null;
  /** Briques retirées du deck à l'Atelier (le prix monte à chaque fois). */
  removals: number;
  /** Jeu de règles du run, figé à sa création. */
  readonly rules: Rules;
}

export function createRun(deck: DeckDef, stakeIdx: number, seed: number, rules: Rules): Run {
  const rng = new Rng(seed);
  const run: Run = {
    seed, rng, deck, stakeIdx, stake: STAKES[stakeIdx],
    ante: 1, wallIdx: 0,
    boss: pickBoss(() => rng.next(), 1, null),
    eclipseColor: rng.int(4) as BrickColor,
    bossValue: 1 + rng.int(10),
    lastLayout: null,
    money: 4 + (deck.money ?? 0),
    cards: deck.build(),
    relics: [],
    consumables: [],
    maxConsumables: MAX_CONSUMABLES + (deck.consumableSlots ?? 0),
    balls: [{ def: BALL_BY_ID.standard, used: false }],
    tools: [],
    levels: newLevels(),
    stats: { bestHand: 0, ballsLost: 0, bricks: 0, glass: 0, discards: 0 },
    endless: false,
    pendingMod: null,
    wallMod: null,
    removals: 0,
    rules,
  };
  return run;
}

export const isBossWall = (run: Run) => run.wallIdx === 2;
export const activeBoss = (run: Run) => (isBossWall(run) ? run.boss : null);
/** Objectif d'un Mur pour ce run (échelle du jeu de règles comprise). */
export const targetOf = (run: Run, ante: number, wallIdx: number) =>
  Math.round((wallTarget(ante, wallIdx, run.stake, run.rules.anteBase) * run.rules.targetScale) / 10) * 10;
export const currentTarget = (run: Run) => targetOf(run, run.ante, run.wallIdx);

export function wallLancers(run: Run) {
  return Math.max(1, 3 + (run.deck.lancers ?? 0) + run.stake.lancers + sumMod(run.relics, 'lancers'));
}

export function wallSecousses(run: Run) {
  return Math.max(0, 1 + (run.deck.secousses ?? 0) + sumMod(run.relics, 'secousses'));
}

/** Défausses du Mur : base du jeu de règles (0 = pas de Défausse, les bonus ne s'appliquent pas). */
export function wallDiscards(run: Run) {
  const base = run.rules.discardsPerWall;
  return base > 0 ? base + (run.deck.discards ?? 0) + sumMod(run.relics, 'discards') : 0;
}

export const interestCap = (run: Run) => Math.max(5, ...run.relics.map((r) => r.def.interestCap ?? 0));

const TIGHT_WALL_REWARD = [2, 3, 4];

/** Lancer de secours (économie resserrée) : 1 par Mur, quand les Lancers sont épuisés sans avoir atteint l'objectif. */
export const rescueCost = (run: Run) => 3 + 2 * run.ante;

/** Récompenses de fin de Mur, ligne par ligne (affichées comme le "cash out" de Balatro). */
export function cashOut(run: Run, lancersLeft: number, scoreRatio = 1) {
  const lines: { label: string; amount: number }[] = [];
  const reward = run.wallIdx === 0 && run.stake.noSmallReward ? 0 : (run.rules.tightEconomy ? TIGHT_WALL_REWARD : WALL_REWARD)[run.wallIdx];
  if (reward) lines.push({ label: 'Mur brisé', amount: reward });
  const mod = run.wallMod;
  if (mod?.reward.money) lines.push({ label: `${mod.mod.glyph} ${mod.mod.name} brisé`, amount: mod.reward.money });
  // Démolition : dépasser largement l'objectif rapporte (×2 → $2, ×4 → $4, ×8 → $6)
  const overkill = run.rules.tightEconomy ? 0 : Math.min(3, Math.floor(Math.log2(Math.max(1, scoreRatio))));
  if (overkill > 0) lines.push({ label: `Démolition (objectif ×${2 ** overkill})`, amount: overkill * 2 });
  if (lancersLeft > 0) lines.push({ label: `${lancersLeft} Lancer${lancersLeft > 1 ? 's' : ''} restant${lancersLeft > 1 ? 's' : ''}`, amount: lancersLeft });
  if (!run.stake.interestOff) {
    const interest = Math.min(interestCap(run), Math.floor(run.money / 5));
    if (interest > 0) lines.push({ label: `Intérêts (1 par $5, max ${interestCap(run)})`, amount: interest });
  }
  return { lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

/** Passe au Mur suivant. Retourne true si une nouvelle Ante commence. */
export function advanceWall(run: Run): boolean {
  run.wallIdx++;
  if (run.wallIdx > 2) {
    run.wallIdx = 0;
    run.ante++;
    run.boss = pickBoss(() => run.rng.next(), run.ante, run.boss.id);
    run.eclipseColor = run.rng.int(4) as BrickColor;
    run.bossValue = 1 + run.rng.int(10);
    return true;
  }
  return false;
}
