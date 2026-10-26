import { LIVING, newCard, type BrickCard, type BrickColor, type Enh } from '../rules/bricks';
import { sumMod } from '../rules/relics';
import { DISCARD_BRICKS } from '../rules/tools';
import { cutBlocks, cutSegments, fillBlock, fillSegment, planVeins } from '../rules/veins';
import { COLS, ROWS, type Brick } from '../sim/world';
import type { Engine } from './engine';

/** Nombre de prochaines briques de la pioche montrées au joueur. */
export const PEEK = 3;

/**
 * La pioche et la pose des briques : remplir le mur, Jokers, malédictions, Défausse, briques temporaires.
 */
export class WallDeck {
  /** Briques temporaires (Maçon fou, Reine) : elles ne rejoignent pas la défausse. */
  private temps = new Set<number>();

  constructor(private readonly engine: Engine) {}

  private get run() {
    return this.engine.run!;
  }

  private get wall() {
    return this.engine.wall;
  }

  /** Nouveau Mur : pioche mélangée, défausse vide. */
  startWall() {
    this.wall.drawPile = this.run.rng.shuffle([...this.run.cards]);
    this.wall.discard = [];
  }

  /** Remplit les emplacements du motif avec des briques de la pioche, puis applique les Jokers et la malédiction. */
  layWall() {
    this.temps.clear();
    this.layCards();
    if (this.run.rules.jokersPerWall > 0) this.placeJokers();
    this.applyWallMod();
  }

  /** Mur vidé : nouvelles briques (les briques temporaires restent comptées comme telles). */
  refill() {
    this.layCards();
    if (this.run.rules.jokersPerWall > 0) this.placeJokers();
    this.applyWallMod();
  }

  /** Brique cassée : elle part à la défausse (sauf une brique temporaire). */
  discardBroken(card: BrickCard) {
    if (!this.temps.has(card.uid)) this.wall.discard.push(card);
  }

  /** Pose une brique temporaire (pour ce Mur seulement). */
  spawnTemp(id: number, color: BrickColor, value: number, enh: Enh = 'none') {
    const card = newCard(color, value, enh);
    this.engine.cards.set(card.uid, card);
    this.temps.add(card.uid);
    const b = this.engine.world.bricks[id];
    b.vein = 0;
    b.veinKind = null;
    this.engine.world.setBrick(id, card);
  }

  draw(): BrickCard | null {
    const w = this.wall;
    if (!w.drawPile.length && w.discard.length) {
      w.drawPile = this.run.rng.shuffle(w.discard);
      w.discard = [];
    }
    return w.drawPile.pop() ?? null;
  }

  /** Les prochaines briques de la pioche, la première d'abord (sans compter un remélange de la défausse). */
  peek(n = PEEK): BrickCard[] {
    return this.wall.drawPile.slice(-n).reverse();
  }

  /** Briques remplacées au plus par une Défausse (Grand ménage : plus). */
  get discardSize() {
    return DISCARD_BRICKS + (this.engine.run ? sumMod(this.engine.run.relics, 'discardSize') : 0);
  }

  /**
   * Défausse (avant un Lancer) : jusqu'à discardSize briques du mur partent à la défausse
   * et sont remplacées, dans l'ordre de sélection, par les prochaines briques de la pioche.
   * Retourne les emplacements effectivement remplacés.
   */
  discardOn(slotIds: number[]): number[] {
    const run = this.engine.run;
    const w = this.wall;
    if (!run || w.discardsLeft <= 0) return [];
    const { world, cards } = this.engine;
    const bricks = [...new Set(slotIds)].map((id) => world.bricks[id])
      .filter((b) => b.alive && b.kind === 'brick' && cards.has(b.uid)).slice(0, this.discardSize);
    if (!bricks.length) return [];
    // On pioche d'abord : une brique défaussée ne peut pas revenir aussitôt par un remélange
    const fresh = bricks.map(() => this.draw());
    const done: number[] = [];
    bricks.forEach((b, i) => {
      const card = fresh[i];
      if (!card) return;
      const orig = this.engine.restoreDeckCard(b);
      if (orig) w.discard.push(orig);
      this.temps.delete(b.uid);
      b.vein = 0;
      b.veinKind = null;
      world.setBrick(b.id, card);
      if (run.wallMod?.mod.armored) b.hp = Math.max(b.hp, 2);
      done.push(b.id);
    });
    if (!done.length) return [];
    w.discardsLeft--;
    run.stats.discards += done.length;
    this.engine.updateSnap();
    return done;
  }

  /** Jokers : la brique la plus basse de quelques colonnes devient Joker (copie limitée à ce Mur, le deck ne change pas). */
  private placeJokers() {
    const front = frontBricks(this.engine.world.bricks).filter((b) => this.engine.cards.get(b.uid)?.enh === 'none');
    for (const b of this.run.rng.shuffle(front).slice(0, this.run.rules.jokersPerWall)) this.engine.patchCard(b, { enh: 'joker' }, true);
  }

  private layCards() {
    const { rng, rules } = this.run;
    const { world } = this.engine;
    const slotsIds = this.engine.wallSlots;
    const wallStyle = rules.wallStyle;
    if (wallStyle.style === 'random') {
      for (const id of rng.shuffle([...slotsIds])) world.setBrick(id, this.draw());
      return;
    }
    const bricks = world.bricks;
    const draw = (pred?: (c: BrickCard) => boolean) => (pred ? this.drawWhere(pred) : this.draw());
    const { style, order } = wallStyle;
    let slots = slotsIds.map((id) => bricks[id]);
    let vein = 0;
    if (style === 'blocks' || style === 'mixed') {
      const { blocks, rest } = cutBlocks(slots, COLS, order, rng);
      for (const block of blocks) {
        vein++;
        const cards = fillBlock(block, draw);
        block.rows.forEach((row, r) => row.forEach((id, c) => {
          bricks[id].vein = vein;
          bricks[id].veinKind = block.kind;
          world.setBrick(id, cards[r][c]);
        }));
      }
      slots = rest.map((s) => bricks[s.id]);
    }
    // Restes des blocs : Filons de rangée (mixed) ou bruit (blocks)
    const rowCfg = style === 'blocks' ? { ...wallStyle, style: 'veins' as const, order: 0 } : style === 'mixed' ? { ...wallStyle, style: 'veins' as const } : wallStyle;
    const segs = cutSegments(slots, (r, c) => bricks[r * COLS + c].kind === 'block');
    for (const seg of planVeins(segs, rowCfg, rng)) {
      const cards = fillSegment(seg, rowCfg.style, draw);
      if (seg.kind) vein++;
      seg.slots.forEach((id, k) => {
        bricks[id].vein = seg.kind ? vein : 0;
        bricks[id].veinKind = seg.kind;
        world.setBrick(id, cards[k]);
      });
    }
  }

  /** Malédiction du Mur : briques blindées ou vivantes (copies limitées à ce Mur, le deck ne change pas). */
  private applyWallMod() {
    const mod = this.run.wallMod?.mod;
    if (!mod) return;
    const live = this.engine.world.bricks.filter((b) => b.alive && b.kind === 'brick');
    if (mod.living) {
      const plain = live.filter((b) => this.engine.cards.get(b.uid)?.enh === 'none');
      for (const b of this.run.rng.shuffle(plain).slice(0, mod.living)) this.engine.patchCard(b, { enh: this.run.rng.pick(LIVING) }, true);
    }
    if (mod.armored) for (const b of live) b.hp = Math.max(b.hp, 2);
  }

  /** Première carte du dessus de la pioche qui vérifie `pred`, sinon la carte du dessus. */
  private drawWhere(pred: (c: BrickCard) => boolean): BrickCard | null {
    const pile = this.wall.drawPile;
    for (let i = pile.length - 1; i >= Math.max(0, pile.length - this.run.rules.wallStyle.lookahead); i--) {
      if (pred(pile[i])) return pile.splice(i, 1)[0];
    }
    return this.draw();
  }
}

/** Front du mur : la brique la plus basse de chaque colonne (un bloc vivant cache celles du dessus). */
export function frontBricks(bricks: Brick[]): Brick[] {
  const front: Brick[] = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = ROWS - 1; r >= 0; r--) {
      const b = bricks[r * COLS + c];
      if (b.kind === 'block' && b.alive) break;
      if (b.alive && b.kind === 'brick') {
        front.push(b);
        break;
      }
    }
  }
  return front;
}
