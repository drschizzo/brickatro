import type { BrickCard, BrickColor, Enh } from '../rules/bricks';
import { isColorless } from '../rules/bricks';
import type { FigureId } from '../rules/figures';
import { computeOuts, type Outs } from '../rules/outs';
import { HAND_SIZE, Pot, type DropChooser, type PotBrick } from '../rules/pot';
import { PROWESS } from '../rules/prowess';
import { activeBoss } from '../rules/run';
import { computeScore, type ScoreResult } from '../rules/scoring';
import type { Brick, BreakCause, HitInfo } from '../sim/world';
import type { Engine } from './engine';

/** Brique candidate du trajet (règle v3) : déjà comptée en Éclat, elle peut encore entrer dans la Main. */
export interface TripCand { pb: PotBrick; chips: number; x: number; y: number }

/** Ce qu'il advient d'une brique cassée pour la Main. */
export interface HandEntry {
  /** La brique est un Éclat (Jetons seulement) ou une candidate du trajet. */
  shard: boolean;
  /** Elle est entrée dans la Main tout de suite. */
  entered: boolean;
  /** Brique écartée de la Main (Main pleine). */
  out: PotBrick | null;
  /** Prouesses et bonus réalisés (affichage). */
  tags: string[];
}

/**
 * La Main et le trajet en cours : quelles briques entrent dans la Main, Éclats, Joker, aperçu et scoring.
 */
export class Hand {
  readonly pot = new Pot();
  /** Mains de poker déjà jouées sur ce Mur (Boss L'Œil). */
  played = new Set<FigureId>();
  /** Mode 'best' : briques candidates du trajet en cours (déjà comptées comme Éclats). */
  private tripCands: TripCand[] = [];
  /** La brique de tête du trajet en cours est déjà prise. */
  private headTaken = false;

  constructor(private readonly engine: Engine) {}

  /** Nouveau Mur : taille de la Main (Boss Le Silex) et Mains jouées remises à zéro. */
  startWall(size = HAND_SIZE) {
    this.pot.size = size;
    this.pot.reset();
    this.played = new Set();
  }

  /** Nouveau Lancer. */
  startLancer() {
    this.pot.reset();
    this.headTaken = false;
    this.tripCands = [];
  }

  /** Renvoi sur la raquette : le trajet suivant commence. */
  rebound(offset: number) {
    this.resolveTrip();
    this.pot.addRebound(offset);
    this.headTaken = false;
  }

  /**
   * Une brique casse : elle entre dans la Main, devient un Éclat, ou candidate du trajet (règle v3).
   * `called` : brique au bout du guide doré (Prouesse « Dans le mille »).
   */
  take(brick: Brick, card: BrickCard, cause: BreakCause, hit: HitInfo, eclipsed: boolean, called: boolean): HandEntry {
    const { headRule, headMode } = this.engine.run!.rules;
    // Touchée par la balle (rebond ou traversée de la Lourde), pas par une explosion
    const touched = cause === 'ball' || cause === 'pierce';
    const best = headRule && headMode === 'best';
    const shard = headRule && cause !== 'laser' && (!touched || this.headTaken || best);
    if (headRule && touched) this.headTaken = true;
    const pot = this.pot;
    const pb: PotBrick = {
      uid: card.uid, color: card.color, value: card.value, enh: card.enh, edition: card.edition, cause,
      wallBounces: hit.wallBounces, sideBounces: hit.sideBounces, bumped: hit.bumped, ported: hit.ported, fromAbove: hit.fromAbove,
      trip: cause === 'laser' ? -1 : pot.trip, star: brick.star, called, row: brick.row, col: brick.col, vein: brick.vein,
      frenzy: pot.frenzy,
    };
    const tags: string[] = [];
    if (shard) {
      const chips = this.shardChips(card);
      pot.addShard(card, chips);
      if (best && touched && !eclipsed) this.tripCands.push({ pb, chips, x: brick.x, y: brick.y });
      return { shard, entered: false, out: null, tags };
    }
    if (eclipsed) return { shard, entered: false, out: null, tags };
    const out = pot.addBrick(this.resolveJoker(pb), this.dropChooser());
    if (pot.frenzy) tags.push('🔥');
    if (brick.star) tags.push('★ Cible');
    if (called) tags.push(PROWESS.mille.name);
    if (hit.ported) tags.push(PROWESS.teleport.name);
    if (hit.bumped) tags.push(PROWESS.carambole.name);
    if (hit.fromAbove) tags.push(PROWESS.dessus.name);
    if (hit.sideBounces >= 3 && cause !== 'explosion') tags.push(PROWESS.bande.name);
    if (pot.segment === 3) tags.push(PROWESS.double.name);
    return { shard, entered: true, out, tags };
  }

  /** Jetons d'un Éclat. */
  shardChips(card: { value: number; enh: Enh }) {
    const rate = (this.engine.run?.rules ?? this.engine.rules).shardRate;
    return card.enh === 'pierre' ? 10 : Math.max(1, Math.round(card.value * rate));
  }

  score(catchOffset: number | null, roll: boolean, lossFactor = 1, pot: Pot = this.pot): ScoreResult {
    const engine = this.engine;
    const run = engine.run!;
    const boss = activeBoss(run);
    return computeScore({
      pot, relics: run.relics, levels: run.levels, catchOffset,
      ballSpeed: engine.world.ball.speed * engine.speedMul(), run: engine.runView(),
      roll: roll ? () => run.rng.next() : null, lossFactor,
      rules: {
        requiredValue: boss?.requiredValue ? run.bossValue : undefined,
        bannedFigures: boss?.oncePerFigure ? this.played : undefined,
      },
      orders: engine.orders,
    });
  }

  /**
   * Écart "intelligent" : quand la Main déborde, on garde les 5 briques qui donnent le meilleur score
   * avec les Reliques actuelles (à égalité, on écarte la plus ancienne).
   */
  dropChooser(pot: Pot = this.pot): DropChooser {
    return (hand) => {
      let best = 0, bestV = -1;
      hand.forEach((_, i) => {
        const v = this.score(null, false, 1, pot.withBricks(hand.filter((__, k) => k !== i))).total;
        if (v > bestV) { bestV = v; best = i; }
      });
      return best;
    };
  }

  /** Un Joker entre dans la Main : il prend la valeur et la couleur qui donnent le meilleur score. */
  resolveJoker(pb: PotBrick, pot: Pot = this.pot): PotBrick {
    if (pb.enh !== 'joker') return pb;
    let best = { ...pb, enh: 'none' as const }, bestV = -1;
    for (let v = 1; v <= 10; v++) {
      for (let c = 0; c < 4; c++) {
        const cand: PotBrick = { ...pb, enh: 'none', value: v, color: c as BrickColor };
        const sim = pot.clone();
        sim.addBrick({ ...cand }, this.dropChooser(sim));
        const t = this.score(null, false, 1, sim).total;
        if (t > bestV) { bestV = t; best = cand as PotBrick & { enh: 'none' }; }
      }
    }
    return best;
  }

  /** Mode 'best' : la candidate du trajet en cours qui entrerait dans la Main si le trajet finissait maintenant (Joker résolu). */
  tripLead(): TripCand | null {
    let pick: TripCand | null = null, bestV = -1;
    for (const c of this.tripCands) {
      const pb = this.resolveJoker(c.pb);
      const sim = this.pot.clone();
      sim.addBrick({ ...pb }, this.dropChooser(sim));
      const v = this.score(null, false, 1, sim).total;
      if (v > bestV) { bestV = v; pick = { ...c, pb }; }
    }
    return pick;
  }

  /** Nombre de briques candidates du trajet en cours. */
  get tripCount() {
    return this.tripCands.length;
  }

  /** La candidate quitte les Éclats et entre dans la Main `pot`. */
  private promote(pot: Pot, lead: TripCand) {
    pot.shards--;
    pot.shardChips -= lead.chips;
    pot.broken--;
    pot.addBrick(lead.pb, this.dropChooser(pot));
  }

  /**
   * La Main telle qu'elle serait si le trajet finissait maintenant (la meilleure candidate y est déjà).
   * Sert à l'affichage et aux décisions : c'est ce qu'on encaisserait en attrapant la balle.
   * Ne pas modifier le résultat (c'est this.pot quand il n'y a pas de candidate).
   */
  previewPot(): Pot {
    const lead = this.tripLead();
    if (!lead) return this.pot;
    const p = this.pot.clone();
    this.promote(p, { ...lead, pb: { ...lead.pb } });
    return p;
  }

  /** Fin du trajet (renvoi, encaissement, balle perdue) : la meilleure candidate entre dans la Main. */
  resolveTrip() {
    const pick = this.tripLead();
    this.tripCands = [];
    if (!pick) return;
    this.promote(this.pot, pick);
    this.engine.events.emit('tripCard', { uid: pick.pb.uid, x: pick.x, y: pick.y, color: pick.pb.color });
  }

  /** Quelles briques du mur feraient monter la Main (Éclipse : les briques éteintes ne comptent pas). */
  outs(): Outs {
    const run = this.engine.run;
    const off = run && activeBoss(run)?.eclipse ? run.eclipseColor : -1;
    return computeOuts(this.previewPot(), this.engine.wallCards().filter((c) => isColorless(c) || c.color !== off));
  }
}
