import { COLOR_NAMES, EDITION, ENH, isColorless } from './bricks';
import { evaluate, figureValue, type FigureDef, type FigureId, type FigureLevels } from './figures';
import type { Pot, PotBrick } from './pot';
import { computeProwess, PROWESS, type ProwessHit } from './prowess';
import { hasFlag, sumMod, type RelicInstance } from './relics';
import { fulfills, ORDER_XMULT, orderLabel, type Order } from './orders';

export interface RunView {
  money: number;
  deckSize: number;
  relicCount: number;
  lancersLeft: number;
  secoussesLeft: number;
  discardsLeft: number;
  lastLancer: boolean;
}

export interface ScoreCtx {
  pot: Pot;
  figure: FigureDef | null;
  /** Briques de la Main qui comptent pour la Figure. */
  scoring: PotBrick[];
  prowess: ProwessHit[];
  /** -1..1 position de la balle sur la raquette au moment de l'encaissement, null en aperçu. */
  catchOffset: number | null;
  ballSpeed: number;
  run: RunView;
}

export type StepSource =
  | { kind: 'figure' }
  | { kind: 'bricks' }
  | { kind: 'brick'; color: number; uid: number }
  | { kind: 'combo' }
  | { kind: 'prowess' }
  | { kind: 'relic'; index: number }
  | { kind: 'loss' };

export interface ScoreStep {
  source: StepSource;
  label: string;
  chips?: number;
  mult?: number;
  xmult?: number;
  money?: number;
  chipsAfter: number;
  multAfter: number;
}

export interface ScoreResult {
  figure: FigureDef | null;
  level: number;
  /** uid des briques qui comptent. */
  scoringUids: Set<number>;
  steps: ScoreStep[];
  chips: number;
  mult: number;
  total: number;
  money: number;
  /** Briques de Verre brisées (à retirer du deck). */
  destroyed: number[];
  prowess: ProwessHit[];
  /** Raison d'un score annulé par un Boss. */
  blocked: string | null;
  /** Commandes remplies par cette Main. */
  orders: Order[];
}

/** Accumulateur passé aux reliques. Chaque appel produit une étape animée. */
export class ScoreAcc {
  chipsV = 0;
  multV = 0;
  moneyV = 0;
  steps: ScoreStep[] = [];
  source: StepSource = { kind: 'figure' };
  chips(v: number, label = `+${v}`) {
    this.chipsV += v;
    this.push({ chips: v, label });
  }
  mult(v: number, label = `+${v} Mult`) {
    this.multV += v;
    this.push({ mult: v, label });
  }
  xmult(v: number, label = `×${v} Mult`) {
    this.multV = Math.round(this.multV * v * 100) / 100;
    this.push({ xmult: v, label });
  }
  money(v: number, label = `+$${v}`) {
    this.moneyV += v;
    this.push({ money: v, label });
  }
  private push(s: Omit<ScoreStep, 'source' | 'chipsAfter' | 'multAfter'>) {
    this.steps.push({ ...s, source: this.source, chipsAfter: this.chipsV, multAfter: this.multV });
  }
}

export interface ScoreInput {
  pot: Pot;
  relics: RelicInstance[];
  levels: FigureLevels;
  catchOffset: number | null;
  ballSpeed: number;
  run: RunView;
  /** Hasard (briques Chance, Verre). null = aperçu : pas de tirage. */
  roll: (() => number) | null;
  lossFactor?: number;
  /** Contraintes de Boss. */
  rules?: { requiredValue?: number; bannedFigures?: Set<FigureId> };
  /** Commandes du Mur encore ouvertes. */
  orders?: Order[];
}

/** Gain de ×Mult par renvoi de la Série. */
export const SERIES_STEP = 0.2;
/** Renvois de Série qui déclenchent la Frénésie, et Mult par brique de la Main cassée en Frénésie. */
export const FRENZY_STREAK = 6;
export const FRENZY_MULT = 2;
export const frenzyStreak = (relics: RelicInstance[]) => Math.max(2, FRENZY_STREAK + sumMod(relics, 'frenzyStreak'));
/** ×Mult par balle supplémentaire en l'air à l'encaissement. */
export const AIR_BALL_X = 0.5;
export const seriesMult = (streak: number, relics: RelicInstance[]) =>
  Math.round((1 + streak * (SERIES_STEP + sumMod(relics, 'seriesStep'))) * 100) / 100;

const isEnhanced = (b: PotBrick) => b.enh !== 'none' || b.edition !== 'none';

/**
 * Pipeline de scoring ordonné, comme Balatro :
 * Figure → briques (avec relances) → combo → reliques gauche → droite (Reflet copie la voisine).
 * Pur : sert à l'aperçu live du Pot comme à l'encaissement réel.
 */
export function computeScore(input: ScoreInput): ScoreResult {
  const { pot, relics, roll } = input;
  pot.chameleon = hasFlag(relics, 'chameleon');
  const { figure, scoring } = evaluate(pot);
  const scoringUids = new Set(scoring.map((b) => b.uid));
  const acc = new ScoreAcc();
  const destroyed: number[] = [];
  const prowess = computeProwess(pot, input.catchOffset);
  if (!figure) return { figure, level: 1, scoringUids, steps: [], chips: 0, mult: 0, total: 0, money: 0, destroyed, prowess, blocked: null, orders: [] };
  const level = input.levels[figure.id];
  const base = figureValue(figure, level);

  acc.source = { kind: 'figure' };
  acc.chipsV = base.chips;
  acc.multV = base.mult;
  acc.steps.push({
    source: acc.source, label: `${figure.name}${level > 1 ? ` niv.${level}` : ''}`,
    chips: base.chips, mult: base.mult, chipsAfter: acc.chipsV, multAfter: acc.multV,
  });

  // Nombre de déclenchements de chaque brique (relances)
  const rFirst = sumMod(relics, 'retriggerFirst');
  const rEnh = sumMod(relics, 'retriggerEnhanced');
  const triggers = scoring.map((b, i) => {
    let t = 1;
    if (i === 0) t += rFirst;
    if (b.star) t += 1;
    if (b.fromAbove) t += sumMod(relics, 'retriggerAbove');
    if (isEnhanced(b)) t += rEnh;
    for (const r of relics) if (r.def.retriggerColor && !isColorless(b) && pot.matches(b, r.def.retriggerColor.color)) t += r.def.retriggerColor.n;
    return t;
  });

  // Chaque brique qui compte donne sa valeur en Jetons (Pierre = 50), puis ses effets
  const midas = hasFlag(relics, 'midas');
  scoring.forEach((b, i) => {
    acc.source = { kind: 'brick', color: isColorless(b) ? -1 : b.color, uid: b.uid };
    for (let t = 0; t < triggers[i]; t++) {
      const tag = t > 0 ? ' (relance)' : '';
      const v = b.enh === 'pierre' ? 50 : b.value;
      acc.chips(v, `+${v}${tag}`);
      switch (b.enh) {
        case 'bonus': acc.chips(30, `Bonus +30${tag}`); break;
        case 'mult': acc.mult(4, `+4 Mult${tag}`); break;
        case 'verre': acc.xmult(2, `Verre ×2${tag}`); break;
        case 'acier': acc.xmult(1.5, `Acier ×1.5${tag}`); break;
        case 'or':
          acc.money(2, `Or +$2${tag}`);
          if (midas) acc.xmult(1.5, `Midas ×1.5${tag}`);
          break;
        case 'fuyarde': acc.chips(40, `Fuyarde +40${tag}`); break;
        case 'chance':
          if (roll) {
            if (roll() < 0.25) acc.mult(20, `Chance ! +20 Mult${tag}`);
            if (roll() < 1 / 12) acc.money(10, `Jackpot ! +$10${tag}`);
          }
          break;
      }
      switch (b.edition) {
        case 'metal': acc.chips(50, `Métal +50${tag}`); break;
        case 'holo': acc.mult(10, `Holo +10 Mult${tag}`); break;
        case 'poly': acc.xmult(1.5, `Poly ×1.5${tag}`); break;
      }
    }
    if (b.enh === 'verre' && roll && roll() < 0.25) destroyed.push(b.uid);
  });

  // Éclats (règle « brique de tête ») : le volume de casse donne des Jetons, pas des cartes
  if (pot.shardChips > 0) {
    acc.source = { kind: 'bricks' };
    acc.chips(pot.shardChips, `Éclats ×${pot.shards} +${pot.shardChips}`);
  }

  // Prouesses : l'adresse s'ajoute à la main
  acc.source = { kind: 'prowess' };
  for (const p of prowess) {
    const name = PROWESS[p.id].name + (p.count > 1 ? ` ×${p.count}` : '');
    if (p.mult) acc.mult(p.mult, `${name} +${p.mult} Mult`);
    if (p.xmult) acc.xmult(p.xmult, `${name} ×${p.xmult}`);
  }

  if (pot.springMult > 0) {
    acc.source = { kind: 'combo' };
    acc.mult(pot.springMult, `Ressort +${pot.springMult} Mult`);
  }

  // Frénésie : les briques cassées balle en feu donnent du Mult
  const hot = pot.count((b) => !!b.frenzy);
  if (hot) {
    acc.source = { kind: 'combo' };
    acc.mult(FRENZY_MULT * hot, `Frénésie +${FRENZY_MULT * hot} Mult`);
  }

  // Série : chaque renvoi sans encaisser fait monter un ×Mult
  if (pot.streak > 0) {
    acc.source = { kind: 'combo' };
    const x = seriesMult(pot.streak, relics);
    acc.xmult(x, `Série ${pot.streak} ×${x}`);
  }

  // Multiballe : chaque balle encore en l'air à l'encaissement multiplie la Main
  if (pot.airBalls > 0) {
    acc.source = { kind: 'combo' };
    const x = 1 + AIR_BALL_X * pot.airBalls;
    acc.xmult(x, `${pot.airBalls} balle${pot.airBalls > 1 ? 's' : ''} en l'air ×${x}`);
  }

  const ctx: ScoreCtx = { pot, figure, scoring, prowess, catchOffset: input.catchOffset, ballSpeed: input.ballSpeed, run: input.run };
  relics.forEach((r, index) => {
    // Reflet : suit la chaîne de copies vers la droite
    let target: RelicInstance | undefined = r;
    let guard = 0;
    while (target?.def.copy && guard++ < relics.length) target = relics[index + guard];
    acc.source = { kind: 'relic', index };
    if (target?.def.score) target.def.score(ctx, acc, target);
    // Relique Polychrome (mode Infini surtout) : ×1.5 en plus de son effet
    if (r.poly) acc.xmult(1.5, 'Polychrome ×1.5');
  });

  // Commandes : la Figure demandée rapporte de l'argent et ×1,5 Mult
  const orders = (input.orders ?? []).filter((o) => !o.done && fulfills(o, figure, scoring));
  for (const o of orders) {
    acc.source = { kind: 'combo' };
    acc.xmult(ORDER_XMULT, `Commande ${orderLabel(o).replace(/\{[^}]*\}/g, '')} ×${ORDER_XMULT}`);
    acc.money(o.money, `Commande +$${o.money}`);
  }

  const lossFactor = input.lossFactor ?? 1;
  if (lossFactor < 1) {
    acc.source = { kind: 'loss' };
    acc.xmult(lossFactor, `Assurance ×${lossFactor}`);
  }

  // Contraintes de Boss : affichées comme une étape, pour que la sanction soit claire
  let blocked: string | null = null;
  const rules = input.rules;
  if (rules?.requiredValue && !pot.brokenValues.has(rules.requiredValue)) {
    blocked = `La Cloche : il faut un ${rules.requiredValue}`;
  } else if (rules?.bannedFigures?.has(figure.id)) {
    blocked = `L'Œil : ${figure.name} déjà jouée`;
  }
  if (blocked) {
    acc.source = { kind: 'loss' };
    acc.xmult(0, blocked);
  }

  const total = Math.floor(acc.chipsV * acc.multV);
  return { figure, level, scoringUids, steps: acc.steps, chips: acc.chipsV, mult: acc.multV, total, money: acc.moneyV, destroyed, prowess, blocked, orders: blocked ? [] : orders };
}

export const describeBrick = (b: PotBrick) =>
  `${COLOR_NAMES[b.color]}${b.enh !== 'none' ? ' ' + ENH[b.enh].name : ''}${b.edition !== 'none' ? ' ' + EDITION[b.edition].name : ''}`;
