import { isColorless, type BrickColor, type Edition, type Enh } from './bricks';
import { evaluateHand, figureIndex } from './figures';
import type { BreakCause } from '../sim/world';

export const HAND_SIZE = 5;
/** Au-delà de ce décalage (|offset| de 0 à 1), le renvoi est fait sur le bord de la raquette. */
export const EDGE_OFFSET = 0.6;

/** Une brique dans la Main. */
export interface PotBrick {
  uid: number;
  color: BrickColor;
  value: number;
  enh: Enh;
  edition: Edition;
  wallBounces: number;
  sideBounces: number;
  cause: BreakCause;
  bumped: boolean;
  ported: boolean;
  fromAbove: boolean;
  /** Trajet (entre deux contacts raquette) pendant lequel la brique a été cassée. */
  trip: number;
  /** Cassée sur un emplacement cible ★. */
  star: boolean;
  /** Brique visée par le guide doré (au lancer ou au renvoi) et touchée : Prouesse « Dans le mille ». */
  called: boolean;
  /** Cassée pendant la Frénésie. */
  frenzy?: boolean;
  /** Emplacement d'origine sur le mur (Reliques spatiales) et Filon (0 = aucun). */
  row: number;
  col: number;
  vein: number;
}

/** Choisit, dans une main d'une brique de trop, l'indice de la brique à écarter. */
export type DropChooser = (hand: PotBrick[]) => number;

/**
 * La Main : les 5 meilleures briques cassées pendant le Lancer.
 * Quand une brique de trop arrive, on écarte celle qui pèse le moins (elle peut être la nouvelle) :
 * une série de briques ne peut qu'améliorer la Main.
 */
export class Pot {
  bricks: PotBrick[] = [];
  size = HAND_SIZE;
  rebounds = 0;
  trip = 0;
  /** Briques cassées pendant tout le Lancer (éjectées comprises). */
  broken = 0;
  segment = 0;
  maxSegment = 0;
  wallStreak = 0;
  springMult = 0;
  /** Valeurs de toutes les briques cassées pendant le Lancer (éjectées comprises). */
  brokenValues = new Set<number>();
  /** Relique Caméléon : Feu ≈ Foudre (chaudes) et Eau ≈ Terre (froides). */
  chameleon = false;
  /** Renvois sur le bord de la raquette pendant le Lancer. */
  edgeRebounds = 0;
  /** Série : renvois raquette sans encaisser (remise à zéro par une Secousse de sauvetage). */
  streak = 0;
  /** Secousses utilisées pendant le Lancer. */
  shakes = 0;
  /** Frénésie : Série assez longue, la balle s'embrase jusqu'à la fin du Lancer (ou un sauvetage). */
  frenzy = false;
  /** Balles supplémentaires encore en jeu à l'encaissement (multiballe). */
  airBalls = 0;
  /** Rebonds sur la raquette jumelle (Raquette siamoise). */
  twinHits = 0;
  /** Règle « brique de tête » : briques cassées hors Main (ricochets, explosions) et leurs Jetons. */
  shards = 0;
  shardChips = 0;

  reset() {
    this.bricks = [];
    this.rebounds = 0;
    this.trip = 0;
    this.broken = 0;
    this.segment = 0;
    this.maxSegment = 0;
    this.wallStreak = 0;
    this.springMult = 0;
    this.edgeRebounds = 0;
    this.streak = 0;
    this.shakes = 0;
    this.frenzy = false;
    this.airBalls = 0;
    this.twinHits = 0;
    this.shards = 0;
    this.shardChips = 0;
    this.brokenValues = new Set();
  }
  /** Ajoute une brique ; retourne celle qui a été écartée, s'il y en a une. */
  addBrick(b: PotBrick, chooseDrop: DropChooser = (h) => defaultDrop(h, this.chameleon)): PotBrick | null {
    this.bricks.push(b);
    if (b.enh !== 'pierre') this.brokenValues.add(b.value);
    this.broken++;
    this.segment++;
    this.wallStreak = 0;
    this.maxSegment = Math.max(this.maxSegment, this.segment);
    if (this.bricks.length <= this.size) return null;
    return this.bricks.splice(chooseDrop(this.bricks), 1)[0];
  }

  /** Éclat : brique cassée qui n'entre pas dans la Main, elle ne rapporte que des Jetons. */
  addShard(b: { value: number; enh: Enh }, chips: number) {
    if (b.enh !== 'pierre') this.brokenValues.add(b.value);
    this.broken++;
    this.shards++;
    this.shardChips += chips;
  }

  /** Copie de la Main avec d'autres briques (pour évaluer des variantes). */
  withBricks(bricks: PotBrick[]): Pot {
    const p = new Pot();
    Object.assign(p, this, { bricks, brokenValues: new Set(this.brokenValues) });
    return p;
  }

  clone(): Pot {
    return this.withBricks(this.bricks.map((b) => ({ ...b })));
  }
  addRebound(offset = 0) {
    this.rebounds++;
    this.streak++;
    if (Math.abs(offset) > EDGE_OFFSET) this.edgeRebounds++;
    this.trip++;
    this.segment = 0;
    this.wallStreak = 0;
  }
  addWallBounce() {
    this.wallStreak++;
  }
  /** La brique compte-t-elle comme cette couleur ? (Caméléon : couleurs chaudes / froides confondues) */
  matches(b: PotBrick, color: number): boolean {
    if (isColorless(b)) return false;
    return b.color === color || (this.chameleon && b.color % 2 === color % 2);
  }
  /** Nombre de briques comptant pour chaque couleur. */
  colorCounts(list: PotBrick[] = this.bricks): number[] {
    return [0, 1, 2, 3].map((c) => list.filter((b) => this.matches(b, c)).length);
  }
  /** Nombre de "familles" de couleurs différentes (Caméléon : chaudes / froides). */
  distinctColors(list: PotBrick[] = this.bricks): number {
    return new Set(list.filter((b) => !isColorless(b)).map((b) => (this.chameleon ? b.color % 2 : b.color))).size;
  }
  count(pred: (b: PotBrick) => boolean, list: PotBrick[] = this.bricks) {
    let n = 0;
    for (const b of list) if (pred(b)) n++;
    return n;
  }
  get empty() {
    return this.bricks.length === 0;
  }
}

/** Écart par défaut (sans Reliques) : garde la meilleure main de poker, puis les plus fortes valeurs. */
export function defaultDrop(hand: PotBrick[], chameleon = false): number {
  let best = 0, bestKey = -Infinity;
  hand.forEach((_, i) => {
    const rest = hand.filter((__, k) => k !== i);
    const ev = evaluateHand(rest, chameleon);
    const key = figureIndex(ev.figure) * 1000 + ev.scoring.reduce((s, b) => s + (b.enh === 'pierre' ? 50 : b.value), 0);
    if (key > bestKey) { bestKey = key; best = i; }
  });
  return best;
}
