/**
 * Bot joueur pour le banc de simulation : il joue avec le vrai moteur (Engine + World),
 * avec une adresse imparfaite paramétrable, et une politique de boutique.
 */
import { Rng } from '../src/core/rng';
import { Engine, type LancerEnd } from '../src/engine/engine';
import { frontBricks } from '../src/engine/wall-deck';
import { makeRules, type Rules, type RulesetId } from '../src/rules/ruleset';
import { RUNES, type RuneDef } from '../src/rules/consumables';
import { DECKS, WALL_NAMES } from '../src/rules/decks';
import type { BrickCard } from '../src/rules/bricks';
import { evaluateHand, type FigureId } from '../src/rules/figures';
import type { WallStyleCfg } from '../src/rules/veins';
import { DISCARD_BRICKS, MAX_TOOLS, TOOL_BY_ID, type ToolDef } from '../src/rules/tools';
import { Pot, type PotBrick } from '../src/rules/pot';
import { computeProwess } from '../src/rules/prowess';
import { MAX_RELICS, RELIC_BY_ID, RELIC_PRICE, type RelicDef, type RelicInstance } from '../src/rules/relics';
import { activeBoss } from '../src/rules/run';
import { computeScore } from '../src/rules/scoring';
import { sellPrice } from '../src/rules/shop';
import { ATELIER_MIN_DECK, removePrice, RETAIL_PRICE } from '../src/rules/atelier';
import { BALL_R, bounceDir, COLS, FIELD, FOCUS_DIST, MAX_BOUNCE_ANGLE, MAX_LAUNCH_ANGLE, paddleXForAngle, predictPath, World } from '../src/sim/world';

const STEP = 1 / 120;
/** Durée max d'un Lancer (secondes de jeu) avant d'être considéré comme bloqué. */
const LANCER_TIMEOUT = 150;

export interface Skill {
  name: string;
  /** Écart-type de placement de la raquette quand on court après la balle (unités monde). */
  aimSigma: number;
  /** Écart-type de l'angle visé quand la raquette est verrouillée (degrés). */
  angleSigma: number;
  /** Probabilité d'arriver trop tard sous la balle à vitesse de base (augmente avec la vitesse²). */
  late: number;
  /** Quand on arrive trop tard : probabilité de perdre la balle. */
  lose: number;
  /** Probabilité de réussir la Secousse de sauvetage quand la balle passe sous la raquette. */
  save: number;
}

export const SKILLS: Record<string, Skill> = {
  debutant: { name: 'debutant', aimSigma: 1.0, angleSigma: 3.5, late: 0.12, lose: 0.5, save: 0.4 },
  moyen: { name: 'moyen', aimSigma: 0.55, angleSigma: 2, late: 0.06, lose: 0.4, save: 0.7 },
  expert: { name: 'expert', aimSigma: 0.25, angleSigma: 1, late: 0.025, lose: 0.3, save: 0.9 },
  parfait: { name: 'parfait', aimSigma: 0, angleSigma: 0, late: 0, lose: 0, save: 1 },
};

export type ShopPolicy = 'none' | 'random' | 'greedy';

export interface BotConfig {
  skill: Skill;
  shop: ShopPolicy;
  deck: string;
  stake: number;
  /** Prise de risque : on continue si le gain espéré dépasse (1 + margin) × la Main actuelle. */
  riskMargin: number;
  /** Arrête après cette Ante (victoire = 8). */
  maxAnte: number;
  /** Visée assistée en degrés (null = valeur du jeu). */
  assistDeg: number | null;
  /** Pose des briques (null = valeur du jeu). */
  wall: WallStyleCfg | null;
  /** Reliques données au départ (pour mesurer leur effet). */
  relics?: string[];
  /** Rune offerte au début de chaque Mur (s'il reste une place). */
  gift?: string;
  /** Outils donnés au départ. */
  tools?: string[];
  /** N'utilise jamais l'Atelier (pour mesurer son apport). */
  noAtelier?: boolean;
  /** Argent gardé avant d'utiliser l'Atelier. */
  atelierReserve?: number;
  /** Mesure : l'Atelier ne coûte rien au bot (plafond de ce qu'il peut apporter). */
  atelierFree?: boolean;
  /** N'achète jamais d'Outil (pour mesurer leur apport). */
  noTools?: boolean;
  /**
   * Planification sur plusieurs briques : vise aussi ce qui prépare une Figure
   * (voisines du Filon, briques dégagées). null = bot glouton (1 seul tir d'avance).
   */
  plan: { discount: number } | null;
  /** Règle « brique de tête » (Jetons d'un Éclat en part de sa valeur) ; null = règle actuelle. */
  head?: { shardRate: number; mode?: 'first' | 'best' } | null;
  /** Jeu de règles de base (défaut v3). */
  ruleset?: RulesetId;
  /** Joueur « casse-briques » : vise une brique atteignable au hasard, sans chercher de Figure. */
  naive?: boolean;
  /** Économie resserrée. */
  tight?: boolean;
  /** Commandes à chaque mur. */
  orders?: boolean;
  /** Jokers posés sur le front de chaque mur. */
  jokers?: number;
  /** Suite et Couleur à 4 briques. */
  short?: boolean;
  /** Échelle des objectifs (1 = objectifs du jeu). */
  targetScale?: number;
  /** Défausses par Mur (undefined = valeur du jeu de règles). */
  discards?: number;
  /** Gain d'accord minimal pour défausser une brique (plus bas = défausse plus volontiers). */
  discardEdge?: number;
}

export interface CashRecord {
  ante: number; figure: FigureId | null; total: number; prowess: string[]; relics: number;
  /** Plus grand nombre de briques de la Main venant d'un même Filon. */
  veinMax: number;
  /** Briques dans la Main, renvois, Éclats et leurs Jetons (règle « brique de tête »). */
  cards?: number; rebounds?: number; shards?: number; shardChips?: number;
  /** Commandes remplies par cette Main. */
  orders?: number;
}
export interface WallRecord {
  ante: number; wallIdx: number; boss: string | null; layout: string; target: number; score: number;
  won: boolean; lancersUsed: number; ballsLost: number; bricks: number; trips: number;
  /** Tirs visés vers une brique précise, et combien l'ont effectivement touchée. */
  shots: number; hits: number;
}
export interface RunRecord {
  seed: number; won: boolean; ante: number; wallIdx: number; diedAt: string;
  walls: WallRecord[]; cashes: CashRecord[];
  relics: string[]; relicsEver: { id: string; ante: number }[];
  moneyByAnte: number[]; stuck: number; bestHand: number; runes: number; astres: number;
  /** Outils utilisés, et Outils possédés en fin de run. */
  tools: number; toolsOwned: string[];
  /** Secousses de sauvetage réussies. */
  saves: number;
  /** Lancers de secours achetés. */
  rescues?: number;
  /** Défausses utilisées et briques remplacées. */
  discards?: number; discarded?: number;
  /** Atelier : briques retirées et retaillées. */
  removed?: number; retailed?: number;
  /** Décisions de renvoi (Main non vide et pas pleine) : une brique qui fait monter la Figure est-elle sur le mur, atteignable ? */
  reach?: { decisions: number; onWall: number; reachable: number; bricks: number; usefulReach: number };
}

/** Largeur du faisceau de planification (chaînes de briques gardées à chaque niveau). */
const PLAN_BEAM = 2;
/** Nombre de briques atteignables (les meilleures en valeur immédiate) pour lesquelles on planifie. */
const PLAN_TOP = 3;

/** Gain estimé d'un Outil (en % de score), mesuré au banc avec --tool. */
const TOOL_VALUE: Record<string, number> = { echange: 0.1, trait: 0.1 };

/** Valeurs heuristiques des Reliques sans effet de score direct (en % de score). */
const PASSIVE_VALUE: Record<string, number> = {
  pinceau: 0.12, voisinage: 0.12, filet: 0.15, gravite: 0.08, ambidextre: 0.1, assurance: 0.07, banquier: 0.04, marchand: 0.02, souffleur: 0.06,
  cameleon: 0.15, astrologue: 0.08, echo: 0.06, reverb: 0.08, tonnerre: 0.08, voltigeur: 0.08,
  recycleur: 0.05, grandmenage: 0.08,
  demolisseur: 0.04, midas: 0.03, funambule: 0.2, dernier: 0.12, avare: 0.05, artificier: 0.02,
};

export class Bot {
  private world: World;
  private engine: Engine;
  private rng: Rng;
  private bank: Pot[] = [];
  private end: LancerEnd | null = null;
  private rec!: RunRecord;
  private curWall!: WallRecord;
  private figureCount = new Map<FigureId, number>();
  /** Brique visée par le dernier tir (emplacement), -1 si aucune. */
  private intended = -1;
  /** Filon d'origine des briques cassées (uid → mur:filon). */
  private veinOf = new Map<number, string>();
  private wallSeq = 0;
  /** Scores déjà calculés pendant une décision (clé : emplacements ajoutés à la Main). */
  private cache = new Map<string, number>();
  /** Main de référence d'une décision (règle v3 : avec la meilleure brique du trajet en cours). */
  private base!: Pot;
  /** La décision se prend avant un renvoi raquette : la Série aura un cran de plus. */
  private bounceAhead = false;

  private get rules() {
    return this.engine.rules;
  }

  constructor(private cfg: BotConfig, private seed: number) {
    this.rng = new Rng(seed ^ 0x9e3779b9);
    this.world = new World();
    this.engine = new Engine(this.world, botRules(cfg));
    this.engine.events.on('lancerEnd', (e) => (this.end = e));
    if (cfg.assistDeg !== null) this.world.aimAssist = (cfg.assistDeg * Math.PI) / 180;
    this.engine.events.on('brick', ({ brick, card }) => {
      if (brick.vein) this.veinOf.set(card.uid, `${this.wallSeq}:${brick.vein}`);
      else this.veinOf.delete(card.uid);
      if (!this.curWall) return;
      this.curWall.bricks++;
      if (this.intended >= 0) {
        if (brick.id === this.intended) this.curWall.hits++;
        this.intended = -1;
      }
    });
    this.world.events.on('paddleHit', () => this.curWall && this.curWall.trips++);
    this.engine.events.on('refilled', () => this.wallSeq++);
  }

  playRun(): RunRecord {
    const deck = DECKS.find((d) => d.id === this.cfg.deck) ?? DECKS[0];
    this.engine.startRun(deck, this.cfg.stake, this.seed);
    const run = this.engine.run!;
    for (const id of this.cfg.relics ?? []) if (RELIC_BY_ID[id]) run.relics.push({ def: RELIC_BY_ID[id], counter: 0 });
    const gift = RUNES.find((r) => r.id === this.cfg.gift);
    for (const id of this.cfg.tools ?? []) if (TOOL_BY_ID[id]) run.tools.push({ def: TOOL_BY_ID[id], used: false });
    this.rec = {
      seed: this.seed, won: false, ante: 1, wallIdx: 0, diedAt: '', walls: [], cashes: [],
      relics: [], relicsEver: [], moneyByAnte: [], stuck: 0, bestHand: 0, runes: 0, astres: 0, tools: 0, toolsOwned: [], saves: 0,
      reach: { decisions: 0, onWall: 0, reachable: 0, bricks: 0, usefulReach: 0 },
    };
    for (;;) {
      if (gift && run.consumables.length < run.maxConsumables) run.consumables.push(gift);
      const won = this.playWall();
      if (!won) break;
      const { total } = this.engine.rewards();
      this.engine.collect(total);
      if (this.engine.isVictory || run.ante >= this.cfg.maxAnte && run.wallIdx === 2) {
        this.rec.won = this.engine.isVictory;
        break;
      }
      this.rec.moneyByAnte[run.ante] = run.money;
      this.shop();
      this.engine.shop.leave();
    }
    this.rec.ante = run.ante;
    this.rec.wallIdx = run.wallIdx;
    this.rec.relics = run.relics.map((r) => r.def.id);
    this.rec.toolsOwned = run.tools.map((t) => t.def.id);
    this.rec.bestHand = run.stats.bestHand;
    if (!this.rec.won) this.rec.diedAt = `${run.ante}-${WALL_NAMES[run.wallIdx]}`;
    return this.rec;
  }

  // ───────────────────────── Un mur ─────────────────────────

  private playWall(): boolean {
    const run = this.engine.run!;
    const boss = activeBoss(run);
    this.curWall = {
      ante: run.ante, wallIdx: run.wallIdx, boss: boss?.id ?? null, layout: this.engine.layout!.id,
      target: this.engine.wall.target, score: 0, won: false, lancersUsed: 0, ballsLost: 0, bricks: 0, trips: 0,
      shots: 0, hits: 0,
    };
    this.rec.walls.push(this.curWall);
    this.wallSeq++;
    for (;;) {
      this.useConsumables();
      // Balle spéciale disponible ? On l'utilise.
      const special = run.balls.findIndex((b, i) => i > 0 && !b.used);
      if (special > 0) this.engine.selectBall(special);
      this.engine.launch(this.chooseLaunchAngle());
      this.curWall.lancersUsed++;
      this.playLancer();
      const end = this.end!;
      this.end = null;
      if (end.kind === 'cash' || end.kind === 'insured') {
        this.engine.commitCashIn(end.res);
        this.recordCash(end.res.figure?.id ?? null, end.res.total, end.res.orders.length);
      }
      if (end.kind === 'lost' || end.kind === 'insured') this.curWall.ballsLost++;
      const r = this.engine.afterLancer();
      this.curWall.score = this.engine.wall.score;
      if (r === 'won') { this.curWall.won = true; return true; }
      if (r === 'lost') {
        // Lancer de secours : le bot l'achète s'il en a les moyens
        if (this.engine.buyRescue()) { this.rec.rescues = (this.rec.rescues ?? 0) + 1; continue; }
        return false;
      }
    }
  }

  private recordCash(figure: FigureId | null, total: number, orders = 0) {
    const run = this.engine.run!;
    this.rec.cashes.push({
      ante: run.ante, figure, total, relics: run.relics.length,
      prowess: computeProwess(this.engine.pot, null).map((p) => p.id),
      veinMax: this.veinMax(),
      cards: this.engine.pot.bricks.length, rebounds: this.engine.pot.rebounds,
      shards: this.engine.pot.shards, shardChips: this.engine.pot.shardChips, orders,
    });
    if (figure) this.figureCount.set(figure, (this.figureCount.get(figure) ?? 0) + 1);
    // Banque de mains pour évaluer les Reliques en boutique
    this.bank.push(clonePot(this.engine.pot));
    if (this.bank.length > 40) this.bank.shift();
  }

  private veinMax(): number {
    const n = new Map<string, number>();
    for (const b of this.engine.pot.bricks) {
      const v = this.veinOf.get(b.uid);
      if (v) n.set(v, (n.get(v) ?? 0) + 1);
    }
    return Math.max(0, ...n.values());
  }

  /** Simule un Lancer jusqu'à sa fin (encaissement ou balle perdue). */
  private playLancer() {
    const w = this.world;
    const ball = w.ball;
    let decided = false;
    let catchArmed = false;
    let target = w.paddle.x;
    let t = 0;
    let saveTried = false;
    while (!this.end && t < LANCER_TIMEOUT) {
      // Secousse de sauvetage : la balle a passé la raquette
      if (w.ballBelowPaddle && !saveTried && w.tiltsThisTrip === 0 && this.engine.wall.secoussesLeft > 0) {
        saveTried = true;
        if (this.rng.next() < this.cfg.skill.save && this.engine.secousse() === 'save') {
          this.rec.saves++;
          decided = false;
          catchArmed = false;
        }
      }
      if (!w.ballBelowPaddle) saveTried = false;
      if (ball.dy < 0 && !ball.stuck && ball.y < FIELD.paddleY + FOCUS_DIST + 4) {
        // Même critère que le jeu : distance restant à parcourir jusqu'à la raquette
        if (!decided && this.distToPaddle() < FOCUS_DIST) {
          const plan = this.planReturn();
          if (plan) {
            decided = true;
            target = plan.x;
            catchArmed = plan.catch;
          }
        }
      } else if (ball.dy > 0) {
        decided = false;
        catchArmed = false;
      }
      this.engine.step(STEP, { paddleTargetX: target, catchArmed, speedMul: this.engine.speedMul() });
      t += STEP;
    }
    if (!this.end) {
      // Bloqué (balle coincée) : on considère la balle perdue
      this.rec.stuck++;
      this.world.resetBall();
      this.end = { kind: 'lost', x: 0, potLost: !this.engine.pot.empty };
    }
  }

  private distToPaddle(): number {
    const w = this.world;
    const b = w.ball;
    const inc = predictPath(w, b.x, b.y, b.dx, b.dy, 5, w.paddle.y + w.paddle.h / 2 + BALL_R);
    if (inc.landX === null) return Infinity;
    let d = 0;
    for (let i = 1; i < inc.pts.length; i++) {
      const p = inc.pts[i - 1], q = inc.pts[i];
      if (!Number.isNaN(p.x) && !Number.isNaN(q.x)) d += Math.hypot(q.x - p.x, q.y - p.y);
    }
    return d;
  }

  /**
   * Décide d'encaisser ou de continuer, et où placer la raquette. Modèle du jeu :
   * à l'entrée du ralenti, si on est à portée la raquette se verrouille et on vise un angle
   * (erreur angleSigma) ; sinon on court après la balle (erreur aimSigma, risque de la perdre).
   */
  private planReturn(): { x: number; catch: boolean } | null {
    const w = this.world;
    const b = w.ball;
    const top = w.paddle.y + w.paddle.h / 2 + BALL_R;
    const inc = predictPath(w, b.x, b.y, b.dx, b.dy, 5, top);
    if (inc.landX === null) return null; // la balle va encore toucher quelque chose
    const landX = inc.landX;
    const half = w.paddle.w / 2;
    const sk = this.cfg.skill;
    const speedF = Math.pow((b.speed * this.engine.speedMul()) / 13, 2);
    const late = this.rng.next() < Math.min(0.9, sk.late * speedF);
    if (late && this.rng.next() < sk.lose) return { x: landX + (this.rng.next() < 0.5 ? -1 : 1) * (half + 1.5), catch: false };

    // Main de référence : elle inclut déjà la meilleure brique du trajet en cours (ce qu'on encaisserait)
    this.base = this.engine.hand.previewPot();
    const now = this.engine.hand.score(null, false, 1, this.base).total;
    const remaining = this.engine.wall.target - this.engine.wall.score;
    // Briques atteignables (pas de 1°), puis meilleur tir selon le plan
    const shots: { a: number; brick: number }[] = [];
    for (let deg = -63; deg <= 63; deg += 1) {
      const a = (deg * Math.PI) / 180;
      const px = paddleXForAngle(w, landX, a);
      const save = w.paddle.x;
      w.paddle.x = px;
      const d = bounceDir(w, landX);
      w.paddle.x = save;
      const out = predictPath(w, landX, top, d.dx, d.dy, 3, null);
      shots.push({ a, brick: out.brick });
    }
    this.measureReach(shots);
    this.bounceAhead = true;
    const best = this.bestShot(shots);
    this.bounceAhead = false;
    const pLoss = Math.min(0.9, sk.late * speedF * sk.lose);
    const mustContinue = this.engine.wall.lancersLeft === 0 && now < remaining;
    const enough = !this.base.empty && now >= remaining;
    const gain = best.value * (1 - pLoss * 2);
    const keepGoing = this.base.empty || mustContinue || (!enough && gain > now * (1 + this.cfg.riskMargin) && this.base.rebounds < 10);
    if (!keepGoing) return { x: landX + gauss(this.rng) * (late ? sk.aimSigma * 0.35 : 0.05), catch: true };
    if (best.brick >= 0 && best.value > 0) {
      this.intended = best.brick;
      this.curWall.shots++;
    }
    if (late) {
      // Trop tard pour verrouiller : on renvoie "à l'ancienne", avec l'erreur de placement
      return { x: paddleXForAngle(w, landX, best.a) + gauss(this.rng) * sk.aimSigma, catch: false };
    }
    const a = Math.max(-MAX_BOUNCE_ANGLE * 0.98, Math.min(MAX_BOUNCE_ANGLE * 0.98, best.a + (gauss(this.rng) * sk.angleSigma * Math.PI) / 180));
    return { x: paddleXForAngle(w, landX, a), catch: false };
  }

  /** Mesure : parmi les briques atteignables, y en a-t-il une qui fait monter la Figure ? */
  private measureReach(shots: { brick: number }[]) {
    const pot = this.base;
    if (pot.empty || pot.bricks.length >= pot.size) return;
    const useful = this.engine.hand.outs().useful;
    const reach = new Set(shots.map((s) => s.brick).filter((b) => b >= 0 && this.world.bricks[b].kind === 'brick'));
    const ur = [...reach].filter((id) => useful.has(this.world.bricks[id].uid)).length;
    const m = this.rec.reach!;
    m.decisions++;
    if (useful.size) m.onWall++;
    if (ur) m.reachable++;
    m.bricks += reach.size;
    m.usefulReach += ur;
  }

  /**
   * Choisit le tir parmi les angles testés. Chaque brique atteignable est notée une seule fois :
   * glouton = score de la Main si on la touche ; planifié = on regarde aussi 1 à 2 briques de plus
   * parmi celles qu'on pourra toucher ensuite (voisines de rangée, brique dégagée au-dessus,
   * autres briques atteignables), avec une décote par brique supplémentaire.
   */
  private bestShot(shots: { a: number; brick: number }[]): { a: number; value: number; brick: number } {
    this.cache.clear();
    const reach = [...new Set(shots.map((s) => s.brick).filter((b) => b >= 0 && !this.engine.consumables.lasered.has(b)))];
    // Valeur immédiate pour toutes, planification seulement pour les plus prometteuses
    const val = new Map<number, number>(reach.map((b) => [b, this.valueIfHit([b])]));
    if (this.cfg.plan && !activeBoss(this.engine.run!)?.fog) {
      const top = [...reach].sort((a, b) => val.get(b)! - val.get(a)!).slice(0, PLAN_TOP);
      for (const b of top) val.set(b, this.planValue(b, reach));
    }
    let best = { a: 0, value: -1, brick: -1 };
    if (this.cfg.naive) {
      const hits = shots.filter((s) => s.brick >= 0);
      const s = hits.length ? hits[this.rng.int(hits.length)] : shots[this.rng.int(shots.length)];
      return { a: s.a, value: s.brick >= 0 ? val.get(s.brick) ?? 0 : 0, brick: s.brick };
    }
    for (const s of shots) {
      const v = s.brick >= 0 ? val.get(s.brick) ?? 0 : 0;
      if (v > best.value) best = { a: s.a, value: v, brick: s.brick };
    }
    return best;
  }

  private planValue(slot: number, reach: number[]): number {
    const v1 = this.valueIfHit([slot]);
    const plan = this.cfg.plan!;
    // Faisceau : on prolonge la chaîne de briques (en suivant les voisines de la dernière)
    // jusqu'à remplir la Main, pour voir venir une Suite ou une Couleur de 5.
    const depth = Math.max(3, Math.min(5, this.base.size - this.base.bricks.length));
    let beam = [{ chain: [slot], v: v1 }];
    let best = v1;
    let k = 1;
    for (let level = 2; level <= depth; level++) {
      k *= plan.discount;
      const next: { chain: number[]; v: number }[] = [];
      for (const { chain } of beam) {
        for (const c of this.followUps(chain[chain.length - 1], reach)) {
          if (chain.includes(c)) continue;
          const nc = [...chain, c];
          next.push({ chain: nc, v: this.valueIfHit(nc) });
        }
      }
      if (!next.length) break;
      next.sort((a, b) => b.v - a.v);
      beam = next.slice(0, PLAN_BEAM);
      best = Math.max(best, k * beam[0].v);
    }
    return best;
  }

  /** Briques qu'on pourra plausiblement toucher après `slot`. */
  private followUps(slot: number, reach: number[]): number[] {
    const bricks = this.world.bricks;
    // Brique de tête : les ricochets ne comptent pas, seule une prochaine visée remplit la Main
    if (this.rules.headRule) return reach.filter((id) => id !== slot && !this.engine.consumables.lasered.has(id) && bricks[id].alive);
    const b = bricks[slot];
    const out = new Set<number>(reach);
    for (const dc of [-2, -1, 1, 2]) {
      const c = b.col + dc;
      if (c >= 0 && c < COLS) out.add(b.row * COLS + c);
    }
    if (b.row > 0) out.add(slot - COLS); // brique dégagée au-dessus
    for (const id of this.engine.consumables.lasered) out.delete(id);
    out.delete(slot);
    return [...out].filter((id) => bricks[id].alive && bricks[id].kind === 'brick');
  }

  /** Score de la Main si les emplacements `slots` sont touchés (dans l'ordre). */
  private valueIfHit(slots: number[]): number {
    // L'ordre ne change presque rien à la Main : une seule entrée par ensemble de briques
    const key = [...slots].sort((a, b) => a - b).join(',');
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const pot = clonePot(this.base);
    if (this.bounceAhead) { pot.streak++; pot.rebounds++; }
    // Brique de tête : chaque brique de plus coûte un renvoi (un cran de Série)
    if (this.rules.headRule) { pot.streak += slots.length - 1; pot.rebounds += slots.length - 1; }
    const run = this.engine.run!;
    const boss = activeBoss(run);
    for (const slot of slots) {
      const br = this.world.bricks[slot];
      const card = br.kind === 'brick' ? this.engine.cards.get(br.uid) : undefined;
      if (!card) continue;
      if (boss?.eclipse && card.color === run.eclipseColor && card.enh !== 'pierre') continue;
      pot.addBrick(this.engine.hand.resolveJoker({
        uid: card.uid, color: card.color, value: card.value, enh: card.enh, edition: card.edition, cause: 'ball',
        wallBounces: 0, sideBounces: 0, bumped: false, ported: false, fromAbove: false, trip: pot.trip, star: br.star, called: !this.rules.headRule && this.bounceAhead && slot === slots[0],
        row: br.row, col: br.col, vein: br.vein,
      }, pot), this.engine.hand.dropChooser(pot));
    }
    let v = this.engine.hand.score(null, false, 1, pot).total;
    // Sous le Brouillard, le bot ne voit pas les valeurs : estimation neutre
    if (boss?.fog) v *= 0.6 + this.rng.next() * 0.8;
    this.cache.set(key, v);
    return v;
  }

  private chooseLaunchAngle(): number {
    this.base = this.engine.hand.previewPot();
    const w = this.world;
    const b = w.ball;
    const shots: { a: number; brick: number }[] = [];
    for (let a = -MAX_LAUNCH_ANGLE; a <= MAX_LAUNCH_ANGLE; a += 0.04) {
      shots.push({ a, brick: predictPath(w, b.x, b.y, Math.sin(a), Math.cos(a), 2, null).brick });
    }
    const best = this.bestShot(shots);
    return best.a + (gauss(this.rng) * this.cfg.skill.angleSigma * Math.PI) / 180;
  }

  // ───────────────────────── Consommables ─────────────────────────

  /** Heuristiques simples d'utilisation des Runes / Astres avant un Lancer. */
  private useConsumables() {
    const run = this.engine.run!;
    for (let i = run.consumables.length - 1; i >= 0; i--) {
      const c = run.consumables[i];
      if (c.kind === 'astre' || (c.kind === 'rune' && c.targets === 0)) {
        this.engine.consumables.useInstant(i);
        continue;
      }
      const slots = this.pickRuneTargets(c);
      if (slots.length) {
        this.engine.consumables.applyRuneOn(i, slots);
        this.rec.runes++;
      }
    }
    this.useDiscards();
    run.tools.forEach((t, i) => {
      if (t.used) return;
      const slots = this.pickToolTargets(t.def);
      if (slots.length) {
        this.engine.consumables.useTool(i, slots);
        this.rec.tools++;
      }
    });
  }

  /**
   * Défausse : une brique du front qui ne s'accorde avec rien sur le mur est remplacée si l'une des
   * prochaines briques de la pioche (visibles) s'y accorderait mieux. 1 Défausse par Lancer, toutes au dernier.
   */
  private useDiscards() {
    const w = this.engine.wall;
    if (this.cfg.naive) return;
    // Au dernier Lancer, on vide les Défausses tant qu'elles servent
    while (w.discardsLeft > 0 && this.discardOnce() && w.lancersLeft <= 1);
  }

  private discardOnce(): boolean {
    const bricks = this.world.bricks;
    const live = bricks.filter((b) => b.alive && b.kind === 'brick');
    const card = (id: number) => this.engine.cards.get(bricks[id].uid)!;
    const wall = new Map(live.map((b) => [b.id, card(b.id)]));
    // Accord d'une carte avec le reste du mur : paires, couleur, suites
    const support = (c: BrickCard, skip: number) => {
      if (c.enh === 'pierre') return 0;
      if (c.enh === 'joker') return 99;
      let s = 0;
      const near = new Set<number>();
      for (const [id, o] of wall) {
        if (id === skip || o.enh === 'pierre') continue;
        if (o.value === c.value) s += 3;
        if (o.color === c.color) s += 0.4;
        const d = Math.abs(o.value - c.value);
        if (d > 0 && d <= 2) near.add(o.value);
      }
      for (const v of near) s += Math.abs(v - c.value) === 1 ? 1 : 0.5;
      return s;
    };
    // Front : la brique la plus basse de chaque colonne (la plus facile à toucher)
    const front = frontBricks(bricks).map((b) => b.id);
    const next = this.engine.deck.peek(DISCARD_BRICKS);
    const picks: number[] = [];
    for (const nc of next) {
      let worst = -1, worstS = Infinity;
      for (const id of front) {
        if (picks.includes(id)) continue;
        const s = support(wall.get(id)!, id);
        if (s < worstS) { worstS = s; worst = id; }
      }
      if (worst < 0 || support(nc, worst) < worstS + (this.cfg.discardEdge ?? 1.5)) break;
      picks.push(worst);
      wall.set(worst, nc);
    }
    if (!picks.length) return false;
    const done = this.engine.deck.discardOn(picks);
    this.rec.discards = (this.rec.discards ?? 0) + 1;
    this.rec.discarded = (this.rec.discarded ?? 0) + done.length;
    return done.length > 0;
  }

  private pickRuneTargets(rune: RuneDef): number[] {
    const live = this.world.bricks.filter((b) => b.alive && b.kind === 'brick');
    const card = (id: number) => this.engine.cards.get(this.world.bricks[id].uid)!;
    if (!live.length) return [];
    const ids = live.map((b) => b.id);
    const run = this.engine.run!;
    // Couleur dominante du deck
    const counts = [0, 0, 0, 0];
    run.cards.forEach((c) => counts[c.color]++);
    if (rune.color !== undefined) return ids.filter((id) => card(id).color !== rune.color).slice(0, rune.targets);
    if (rune.destroy) return [...ids].sort((a, b) => card(a).value - card(b).value).slice(0, rune.targets);
    if (rune.convert) {
      const sorted = [...ids].sort((a, b) => card(a).value - card(b).value);
      return [sorted[0], sorted[sorted.length - 1]];
    }
    if (rune.valueUp) return [...ids].sort((a, b) => card(a).value - card(b).value).slice(0, rune.targets);
    if (rune.duplicate) return [...ids].sort((a, b) => card(b).value - card(a).value).slice(0, 1);
    return this.rng.shuffle([...ids]).filter((id) => card(id).enh === 'none').slice(0, rune.targets);
  }

  private pickToolTargets(tool: ToolDef): number[] {
    const ids = this.world.bricks.filter((b) => b.alive && b.kind === 'brick').map((b) => b.id);
    const card = (id: number) => this.engine.cards.get(this.world.bricks[id].uid)!;
    if (!ids.length) return [];
    if (tool.swap) return this.bestSwap();
    if (tool.laser) {
      // Une paire de même valeur (la plus haute), sinon les deux plus fortes briques
      const byVal = [...ids].sort((a, b) => card(b).value - card(a).value);
      for (const a of byVal) {
        const b = byVal.find((o) => o !== a && card(o).value === card(a).value && card(o).enh !== 'pierre');
        if (b !== undefined && card(a).enh !== 'pierre') return [a, b];
      }
      return byVal.slice(0, tool.targets);
    }
    return [];
  }

  /**
   * Pince : essaie tous les échanges et garde celui qui améliore le plus
   * les Figures "à portée" (fenêtres de 5 briques voisines dans une rangée).
   */
  private bestSwap(): number[] {
    const bricks = this.world.bricks;
    const live = bricks.filter((b) => b.alive && b.kind === 'brick');
    const at = new Map<number, BrickCard>(live.map((b) => [b.id, this.engine.cards.get(b.uid)!]));
    const rows = new Map<number, number[]>();
    for (const b of live) rows.set(b.row, [...(rows.get(b.row) ?? []), b.id]);
    const windows: number[][] = [];
    for (const ids of rows.values()) {
      ids.sort((a, b) => bricks[a].col - bricks[b].col);
      for (let i = 0; i + Math.min(5, ids.length) <= ids.length; i++) windows.push(ids.slice(i, i + 5));
    }
    const quality = () => windows.reduce((s, w) => {
      const f = evaluateHand(w.map((id) => at.get(id)!) as unknown as PotBrick[], false, this.rules.shortFigures).figure;
      return s + (f ? f.chips * f.mult : 0);
    }, 0);
    const base = quality();
    let best = { gain: 0, a: -1, b: -1 };
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i].id, b = live[j].id;
      const ca = at.get(a)!, cb = at.get(b)!;
      if (ca.value === cb.value && ca.color === cb.color) continue;
      at.set(a, cb); at.set(b, ca);
      const gain = quality() - base;
      at.set(a, ca); at.set(b, cb);
      if (gain > best.gain) best = { gain, a, b };
    }
    if (best.a < 0) return [];
    // Deuxième échange, appliqué sur le mur déjà modifié
    const ca = at.get(best.a)!, cb = at.get(best.b)!;
    at.set(best.a, cb); at.set(best.b, ca);
    const base2 = quality();
    let second = { gain: 0, a: -1, b: -1 };
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i].id, b = live[j].id;
      if ([best.a, best.b].includes(a) || [best.a, best.b].includes(b)) continue;
      const x = at.get(a)!, y = at.get(b)!;
      at.set(a, y); at.set(b, x);
      const gain = quality() - base2;
      at.set(a, x); at.set(b, y);
      if (gain > second.gain) second = { gain, a, b };
    }
    return second.a >= 0 ? [best.a, best.b, second.a, second.b] : [best.a, best.b];
  }

  // ───────────────────────── Boutique ─────────────────────────

  private shop() {
    const run = this.engine.run!;
    const items = this.engine.shop.open();
    if (this.cfg.shop === 'none') return;
    if (this.cfg.shop === 'random') {
      for (const i of this.rng.shuffle(items.map((_, k) => k))) {
        const it = items[i];
        if (it.type === 'pack' || it.price > run.money) continue;
        if (it.type === 'relic' || this.rng.next() < 0.5) this.buyAt(i);
      }
      return;
    }
    // Greedy : évalue chaque article sur la banque de mains réellement jouées
    for (let pass = 0; pass < 3; pass++) {
      const base = this.bankScore(run.relics);
      let bestI = -1, bestGain = 0, sellIdx = -1;
      this.engine.shop.items.forEach((it, i) => {
        if (it.sold || it.price > run.money + (it.type === 'relic' && run.relics.length >= MAX_RELICS ? 3 : 0)) return;
        let gain = 0;
        let sell = -1;
        if (it.type === 'relic') {
          if (run.relics.length < MAX_RELICS) gain = this.relicGain(it.def, run.relics, base);
          else {
            // Remplacement : on vend la Relique la moins utile si le gain est net
            const weakest = this.weakestRelic(base);
            const without = run.relics.filter((_, k) => k !== weakest);
            gain = this.relicGain(it.def, without, this.bankScore(without)) - this.relicContribution(weakest, base);
            sell = weakest;
            if (it.price > run.money + sellPrice(run.relics[weakest].def)) gain = 0;
          }
        } else if (it.type === 'consumable' && it.def.kind === 'astre') {
          const f = this.figureCount.get(it.def.figure) ?? 0;
          const total = [...this.figureCount.values()].reduce((a, b) => a + b, 0) || 1;
          gain = (f / total) * 0.25;
        } else if (it.type === 'consumable' && run.consumables.length < run.maxConsumables) {
          gain = 0.04;
        } else if (it.type === 'ball') gain = 0.05;
        else if (it.type === 'tool' && !this.cfg.noTools && run.tools.length < MAX_TOOLS) gain = TOOL_VALUE[it.def.id] ?? 0.08;
        else if (it.type === 'pack' && it.pack === 'astres') gain = 0.08;
        // Garde une réserve pour les intérêts quand le gain est faible
        const reserve = gain > 0.2 ? 0 : 5;
        if (run.money - it.price < reserve && sell < 0) return;
        const perDollar = gain / it.price;
        if (gain > 0.03 && perDollar > bestGain) { bestGain = perDollar; bestI = i; sellIdx = sell; }
      });
      if (bestI < 0) break;
      if (sellIdx >= 0) this.engine.shop.sell(sellIdx);
      this.buyAt(bestI);
    }
    if (!this.cfg.noAtelier) this.useAtelier();
    this.orderRelics();
  }

  /**
   * Atelier : concentre le deck sur peu de valeurs. Retire une brique simple de la valeur la plus rare,
   * et retaille une brique vers la valeur voisine la mieux fournie (pour viser Brelans et Carrés).
   */
  private useAtelier() {
    const run = this.engine.run!;
    if (!this.engine.shop.atelierOpen) return;
    // Réserve : l'Atelier ne passe qu'après les Reliques et les intérêts (au banc, le dépenser plus tôt coûte plus qu'il ne rapporte)
    const RESERVE = this.cfg.atelierReserve ?? 15;
    const plain = () => run.cards.filter((c) => c.enh === 'none' && c.edition === 'none');
    const counts = () => {
      const n = Array(12).fill(0);
      for (const c of run.cards) if (c.enh !== 'pierre') n[c.value]++;
      return n;
    };
    // Mode « gratuit » : on rembourse un service réellement effectué (jamais d'argent en plus)
    const refund = (price: number) => { if (this.cfg.atelierFree) run.money += price; };
    if ((this.cfg.atelierFree || run.money - removePrice(run) >= RESERVE) && run.cards.length > ATELIER_MIN_DECK) {
      const n = counts();
      const victim = [...plain()].sort((a, b) => n[a.value] - n[b.value] || a.value - b.value)[0];
      const price = removePrice(run);
      if (victim && this.engine.shop.atelierRemove(victim.uid)) {
        refund(price);
        this.rec.removed = (this.rec.removed ?? 0) + 1;
      }
    }
    if (this.cfg.atelierFree || run.money - RETAIL_PRICE >= RESERVE) {
      const n = counts();
      let best: { uid: number; d: 1 | -1; gain: number } | null = null;
      for (const c of plain()) {
        for (const d of [1, -1] as const) {
          const v = c.value + d;
          if (v < 1 || v > 10) continue;
          const gain = n[v] + 1 - n[c.value];
          // Seulement pour former (ou grossir) un groupe d'au moins 4
          if (gain >= 1 && n[v] + 1 >= 4 && (!best || gain > best.gain)) best = { uid: c.uid, d, gain };
        }
      }
      if (best && this.engine.shop.atelierRetail(best.uid, best.d)) {
        refund(RETAIL_PRICE);
        this.rec.retailed = (this.rec.retailed ?? 0) + 1;
      }
    }
  }

  private buyAt(i: number) {
    const run = this.engine.run!;
    const it = this.engine.shop.items[i];
    const r = this.engine.shop.buy(i);
    if (!r.ok) return;
    if (it.type === 'relic') this.rec.relicsEver.push({ id: it.def.id, ante: run.ante });
    if (r.astre) this.rec.astres++;
    if (r.options) {
      // Pack : on choisit l'option la plus utile (Astre de la main la plus jouée, sinon la 1re)
      let pick = 0;
      let bestF = -1;
      r.options.forEach((o, k) => {
        if (!('uid' in o) && o.kind === 'astre') {
          const f = this.figureCount.get(o.figure) ?? 0;
          if (f > bestF) { bestF = f; pick = k; }
        }
      });
      const res = this.engine.shop.pickPack(r.options, pick);
      if (res.astre) this.rec.astres++;
    }
  }

  /** Score moyen de la banque de mains avec un jeu de Reliques. */
  private bankScore(relics: RelicInstance[]): number {
    if (!this.bank.length) return 1;
    const run = this.engine.run!;
    let s = 0;
    for (const pot of this.bank) {
      s += computeScore({
        pot, relics, levels: run.levels, catchOffset: 0, ballSpeed: 16,
        run: { ...this.engine.runView(), lancersLeft: 1, lastLancer: false }, roll: null,
      }).total;
    }
    return s / this.bank.length || 1;
  }

  private relicGain(def: RelicDef, relics: RelicInstance[], base: number): number {
    // Les Reliques évolutives sont estimées avec un compteur "moyen"
    const inst: RelicInstance = { def, counter: def.onRebound ? 40 : def.onCashIn || def.onBallLost || def.onGlassBroken ? 4 : 0 };
    // L'ordre compte (Reflet, +Mult avant ×Mult) : on essaie chaque position d'insertion
    let withIt = 0;
    for (let k = 0; k <= relics.length; k++) withIt = Math.max(withIt, this.bankScore([...relics.slice(0, k), inst, ...relics.slice(k)]));
    const direct = withIt / base - 1;
    return direct + (PASSIVE_VALUE[def.id] ?? 0) - (def.lancers ? 0.2 : 0) + (RELIC_PRICE[def.rarity] > 9 ? 0.02 : 0);
  }

  private relicContribution(i: number, base: number): number {
    const run = this.engine.run!;
    const without = run.relics.filter((_, k) => k !== i);
    return base / this.bankScore(without) - 1 + (PASSIVE_VALUE[run.relics[i].def.id] ?? 0);
  }

  private weakestRelic(base: number): number {
    const run = this.engine.run!;
    let worst = 0, v = Infinity;
    run.relics.forEach((r, i) => {
      // Les Reliques imposées par --relic ne sont jamais revendues (on mesure leur effet)
      if (this.cfg.relics?.includes(r.def.id)) return;
      const c = this.relicContribution(i, base);
      if (c < v) { v = c; worst = i; }
    });
    return worst;
  }

  /** Cherche le meilleur ordre des Reliques (toutes les permutations, 5! = 120 au plus). */
  private orderRelics() {
    const run = this.engine.run!;
    if (run.relics.length < 2 || !this.bank.length) return;
    let best = run.relics;
    let bestV = this.bankScore(best);
    const perm = (arr: RelicInstance[], k: number) => {
      if (k === arr.length) {
        const v = this.bankScore(arr);
        if (v > bestV) { bestV = v; best = [...arr]; }
        return;
      }
      for (let i = k; i < arr.length; i++) {
        [arr[k], arr[i]] = [arr[i], arr[k]];
        perm(arr, k + 1);
        [arr[k], arr[i]] = [arr[i], arr[k]];
      }
    };
    perm([...run.relics], 0);
    run.relics.splice(0, run.relics.length, ...best);
  }
}

/** Jeu de règles du bot : celui de la config, puis les surcharges données en option (undefined = valeur du jeu de règles). */
function botRules(cfg: BotConfig): Rules {
  const o: { -readonly [K in keyof Rules]?: Rules[K] } = {};
  if (cfg.wall) o.wallStyle = { ...cfg.wall };
  if (cfg.targetScale !== undefined) o.targetScale = cfg.targetScale;
  if (cfg.jokers !== undefined) o.jokersPerWall = cfg.jokers;
  if (cfg.discards !== undefined) o.discardsPerWall = cfg.discards;
  if (cfg.orders !== undefined) o.orders = cfg.orders;
  if (cfg.tight !== undefined) o.tightEconomy = cfg.tight;
  if (cfg.short !== undefined) o.shortFigures = cfg.short;
  if (cfg.head === null) o.headRule = false;
  else if (cfg.head) {
    o.headRule = true;
    o.shardRate = cfg.head.shardRate;
    if (cfg.head.mode) o.headMode = cfg.head.mode;
  }
  return makeRules(cfg.ruleset ?? 'v3', o);
}

function clonePot(src: Pot): Pot {
  const p = new Pot();
  p.size = src.size;
  p.bricks = src.bricks.map((b) => ({ ...b }));
  p.rebounds = src.rebounds;
  p.trip = src.trip;
  p.broken = src.broken;
  p.segment = src.segment;
  p.maxSegment = src.maxSegment;
  p.wallStreak = src.wallStreak;
  p.springMult = src.springMult;
  p.edgeRebounds = src.edgeRebounds;
  p.streak = src.streak;
  p.shakes = src.shakes;
  p.chameleon = src.chameleon;
  p.short = src.short;
  p.brokenValues = new Set(src.brokenValues);
  return p;
}


function gauss(rng: Rng) {
  const u = Math.max(1e-9, rng.next());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
}

