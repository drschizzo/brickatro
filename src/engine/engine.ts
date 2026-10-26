import { Emitter } from '../core/events';
import { cloneCard, isColorless, LIVING, newCard, type BrickCard, type BrickColor, type Enh } from '../rules/bricks';
import { applyRune, type AstreDef, type RuneDef } from '../rules/consumables';
import { ANTE_BASE, ANTE_BASE_V3, WIN_ANTE, type DeckDef } from '../rules/decks';
import { evaluateHand, FIGURE_BY_ID, FIGURE_RULES, figureIndex, setShortFigures, type FigureDef, type FigureId } from '../rules/figures';
import { LAYOUT_BY_ID, pickLayout, type LayoutDef } from '../rules/layouts';
import { computeOuts, type Outs } from '../rules/outs';
import { HAND_SIZE, Pot, type DropChooser, type PotBrick } from '../rules/pot';
import { PROWESS } from '../rules/prowess';
import { DISCARD_BRICKS, MAX_TOOLS, type ToolDef } from '../rules/tools';
import { cutBlocks, cutSegments, DEFAULT_WALL_STYLE, fillBlock, fillSegment, planVeins, type WallStyleCfg } from '../rules/veins';
import { hasFlag, MAX_RELICS, prodMod, sumMod, type RelicDef } from '../rules/relics';
import {
  activeBoss, advanceWall, cashOut, createRun, currentTarget, isBossWall, rescueCost, wallDiscards, wallLancers, wallSecousses, type Run,
} from '../rules/run';
import { computeScore, frenzyStreak, type RunView, type ScoreResult } from '../rules/scoring';
import { rollWallMod, type WallModOffer } from '../rules/wallmods';
import { rollOrders, type Order } from '../rules/orders';
import { canRemove, canRetail, removePrice, RETAIL_PRICE, type AtelierVisit } from '../rules/atelier';
import { rollSkip, type SkipReward } from '../rules/skips';
import { generateShop, openPack, rerollBaseCost, rerollShop, sellPrice, type ShopItem } from '../rules/shop';
import { COLS, PADDLE_W, predictPath, ROWS, type Brick, type BreakCause, type SimInput, type TiltKind, World } from '../sim/world';

export interface WallState {
  target: number;
  score: number;
  lancersLeft: number;
  lancersMax: number;
  secoussesLeft: number;
  secoussesMax: number;
  /** Défausses du Mur (v3) : remplacer des briques du mur par les prochaines de la pioche. */
  discardsLeft: number;
  discardsMax: number;
  drawPile: BrickCard[];
  discard: BrickCard[];
}

export type LancerEnd =
  | { kind: 'cash'; res: ScoreResult; x: number }
  | { kind: 'insured'; res: ScoreResult; x: number; keep: number }
  | { kind: 'empty'; x: number }
  | { kind: 'lost'; x: number; potLost: boolean };

export type EngineEvents = {
  /** Brique cassée, après application des règles. */
  brick: {
    brick: Brick; card: BrickCard; eclipsed: boolean; out: PotBrick | null; tags: string[];
    /** Règle « brique de tête » : la brique n'entre pas dans la Main (Éclat, Jetons seulement). */
    shard: boolean;
    money: number; bomb: boolean; cause: BreakCause; dx: number; dy: number;
  };
  lancerEnd: LancerEnd;
  /** Gravité : des briques sont tombées (emplacement de départ → d'arrivée). */
  settled: { moves: { from: number; to: number }[] };
  /** Pinceau : des briques ont changé de couleur. */
  painted: { ids: number[]; color: BrickColor };
  /** Mur vidé : de nouvelles briques ont été posées. */
  refilled: Record<string, never>;
  /** Frénésie : la Série a assez duré, la balle s'embrase. */
  frenzy: { x: number; y: number };
  /** La Main atteint un Full ou mieux : onde de choc autour de la brique. */
  bigFigure: { x: number; y: number; figure: FigureDef };
  /** Briques apparues sur le mur (Maçon fou, Reine). */
  spawned: { ids: number[] };
  /** Mimics : leur valeur a changé. */
  morphed: { ids: number[] };
  /** Fuyarde : la brique s'est enfuie. */
  fled: { from: number; to: number };
  /** Pacte du Diable : une Relique a été détruite. */
  relicLost: { def: RelicDef };
  cleared: Record<string, never>;
  /** Mode « meilleure brique du trajet » : la brique choisie entre dans la Main. */
  tripCard: { uid: number; x: number; y: number; color: BrickColor };
};

/** Délai entre la dernière brique cassée et la repose du mur (secondes de jeu). */
const REFILL_DELAY = 0.25;
const BOMB_DELAY = 0.08;
/** Délai avant que les briques d'un mur à gravité tombent dans la case libérée. */
const GRAVITY_DELAY = 0.18;
/** À partir de cette main de poker, la Main déclenche une onde de choc (une fois par Lancer). */
const SHOCK_FIGURE = figureIndex(FIGURE_BY_ID.full);
/** Nombre de prochaines briques de la pioche montrées au joueur. */
export const PEEK = 3;
/** Gain d'argent quand une Piñata casse. */
const PINATA_MONEY = 3;

/**
 * Moteur de jeu sans rendu : toutes les règles d'un run (murs, Main, Boss, boutique…).
 * Partagé entre le jeu (qui ajoute le "juice") et le banc de simulation (bots).
 */
export type Ruleset = 'classic' | 'v3';
/** Brique candidate du trajet (règle v3) : déjà comptée en Éclat, elle peut encore entrer dans la Main. */
export interface TripCand { pb: PotBrick; chips: number; x: number; y: number }

export class Engine {
  readonly events = new Emitter<EngineEvents>();
  readonly pot = new Pot();
  run: Run | null = null;
  wall: WallState = { target: 0, score: 0, lancersLeft: 0, lancersMax: 0, secoussesLeft: 0, secoussesMax: 0, discardsLeft: 0, discardsMax: 0, drawPile: [], discard: [] };
  cards = new Map<number, BrickCard>();
  wallSlots: number[] = [];
  layout: LayoutDef | null = null;
  /** Pose des briques (le banc peut la changer pour comparer). */
  wallStyle: WallStyleCfg = { ...DEFAULT_WALL_STYLE };
  played = new Set<FigureId>();
  selectedBall = 0;
  /** Emplacements visés par une Rune du Trait : pulvérisés au prochain Lancer. */
  lasered = new Set<number>();
  /** Rune de Scission : balles supplémentaires au prochain Lancer. */
  splitNext = 0;
  /** Briques temporaires (Maçon fou, Reine) : elles ne rejoignent pas la défausse. */
  private temps = new Set<number>();
  private shockDone = false;
  /** Malédiction proposée en boutique pour le prochain Mur. */
  wallModOffer: WallModOffer | null = null;
  /** Brique au bout du guide doré au dernier renvoi : la toucher = « Dans le mille ». */
  aimedSlot = -1;
  shopItems: ShopItem[] = [];
  /** Récompense si on passe le prochain Mur (null si c'est un Boss). */
  skipReward: SkipReward | null = null;
  rerollCount = 0;
  /**
   * Règle « brique de tête » (prototype) : seule la 1re brique touchée par la balle après le lancer
   * ou un renvoi entre dans la Main ; les autres (ricochets, explosions) sont des Éclats.
   */
  headRule = false;
  /**
   * 'first' : la 1re brique touchée du trajet entre dans la Main.
   * 'best'  : à la fin du trajet (renvoi ou encaissement), la meilleure brique cassée par la balle pendant ce trajet entre dans la Main.
   */
  headMode: 'first' | 'best' = 'first';
  /** Économie resserrée (prototype), copiée dans run.tight au début du run. */
  tightEconomy = false;
  /** Lancer de secours déjà acheté pendant ce Mur. */
  rescueUsed = false;
  /** Commandes du Mur (prototype : activées par ordersOn). */
  ordersOn = false;
  orders: Order[] = [];
  /** Défausses par Mur (0 = pas de Défausse). */
  discardsPerWall = 0;
  /** Jokers posés sur le front du mur à chaque pose (prototype, 0 = aucun). */
  jokersPerWall = 0;
  /** Mode 'best' : briques candidates du trajet en cours (déjà comptées comme Éclats). */
  private tripCands: TripCand[] = [];
  /** Jetons d'un Éclat, en part de la valeur de la brique. */
  shardRate = 0.5;
  /**
   * Jeu de règles :
   * - classic : la Main garde les 5 meilleures briques cassées, Filons, économie d'origine ;
   * - v3 : une carte par trajet (la meilleure brique cassée par la balle), les autres sont des Éclats ;
   *   Suite et Couleur à 4 briques ; 1 Joker sur le front du mur ; Commandes ; économie resserrée.
   */
  ruleset: Ruleset = 'classic';
  applyRuleset(name: Ruleset) {
    const v3 = name === 'v3';
    this.ruleset = name;
    setShortFigures(v3);
    this.headRule = v3;
    this.headMode = v3 ? 'best' : 'first';
    this.shardRate = 0.5;
    this.jokersPerWall = v3 ? 1 : 0;
    this.discardsPerWall = v3 ? 2 : 0;
    this.ordersOn = v3;
    this.tightEconomy = v3;
    this.anteBase = v3 ? ANTE_BASE_V3 : ANTE_BASE;
    this.targetScale = 1;
    // Les Filons ne pilotaient pas les Figures (banc) : les Commandes les remplacent
    this.wallStyle = v3 ? { ...DEFAULT_WALL_STYLE, style: 'random' } : { ...DEFAULT_WALL_STYLE };
  }

  /** Objectifs de base par Ante du jeu de règles, et échelle supplémentaire (banc). */
  anteBase = ANTE_BASE;
  targetScale = 1;
  /** La brique de tête du trajet en cours est déjà prise. */
  private headTaken = false;
  private explosions: { id: number; t: number }[] = [];
  private refillIn = -1;
  private settleIn = -1;

  constructor(readonly world: World) {
    this.bindWorld();
  }

  // ───────────────────────── Run / murs ─────────────────────────

  startRun(deck: DeckDef, stake: number, seed: number) {
    this.run = createRun(deck, stake, seed);
    this.run.tight = this.tightEconomy;
    this.run.ruleset = this.ruleset;
    this.run.targetScale = this.targetScale;
    this.run.anteBase = this.anteBase;
    this.splitNext = 0;
    this.startWall();
  }

  get endless() {
    return !!this.run?.endless;
  }
  set endless(v: boolean) {
    if (this.run) this.run.endless = v;
  }

  startWall(): LayoutDef {
    const run = this.run!;
    run.wallMod = run.pendingMod;
    run.pendingMod = null;
    // Inflation : le deck dérive, les 10 deviennent Polychromes
    const inflate = sumMod(run.relics, 'inflate');
    for (const c of run.rng.shuffle(run.cards.filter((c) => c.enh !== 'pierre')).slice(0, inflate)) {
      if (c.value < 10) c.value++;
      else c.edition = 'poly';
    }
    const glassify = sumMod(run.relics, 'glassifyOnWall');
    if (glassify) {
      const plain = run.rng.shuffle(run.cards.filter((c) => c.enh === 'none'));
      plain.slice(0, glassify).forEach((c) => (c.enh = 'verre'));
    }
    this.cards = new Map(run.cards.map((c) => [c.uid, c]));
    const w = this.wall;
    w.target = currentTarget(run);
    w.score = 0;
    w.lancersMax = w.lancersLeft = wallLancers(run);
    w.secoussesMax = w.secoussesLeft = wallSecousses(run);
    w.discardsMax = w.discardsLeft = wallDiscards(run, this.discardsPerWall);
    w.drawPile = run.rng.shuffle([...run.cards]);
    w.discard = [];
    const boss = activeBoss(run);
    const layout = boss?.layout ? LAYOUT_BY_ID[boss.layout] : pickLayout(run.rng, run.ante, run.wallIdx, run.lastLayout);
    run.lastLayout = layout.id;
    this.layout = layout;
    this.world.setTide(0);
    this.wallSlots = this.world.setLayout(layout, boss?.pendulum ?? 0);
    this.temps.clear();
    this.rescueUsed = false;
    this.layWall();
    this.applyWallMod();
    this.orders = this.ordersOn ? rollOrders(run.rng, this.wallCards(), run.ante, FIGURE_RULES.short) : [];
    this.pot.size = boss?.handSize ?? HAND_SIZE;
    this.pot.reset();
    this.played = new Set();
    this.world.paddle.w = PADDLE_W * prodMod(run.relics, 'paddleMul') * (boss?.paddleMul ?? 1) * (run.wallMod?.mod.paddleMul ?? 1);
    this.world.twin = hasFlag(run.relics, 'twin');
    this.world.resetBall();
    this.updateSnap();
    run.balls.forEach((b) => (b.used = false));
    run.tools.forEach((t) => (t.used = false));
    this.world.netLeft = sumMod(run.relics, 'nets');
    this.selectedBall = 0;
    this.explosions = [];
    this.refillIn = -1;
    this.lasered.clear();
    this.settleIn = -1;
    return layout;
  }

  /** Remplit les emplacements du motif avec des briques de la pioche. */
  layWall() {
    this.layCards();
    if (this.jokersPerWall > 0) this.placeJokers();
  }

  /** Jokers : la brique la plus basse de quelques colonnes devient Joker (copie limitée à ce Mur, le deck ne change pas). */
  private placeJokers() {
    const front: Brick[] = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = ROWS - 1; r >= 0; r--) {
        const b = this.world.bricks[r * COLS + c];
        if (b.kind === 'block' && b.alive) break;
        if (b.alive && b.kind === 'brick') {
          if (this.cards.get(b.uid)?.enh === 'none') front.push(b);
          break;
        }
      }
    }
    for (const b of this.run!.rng.shuffle(front).slice(0, this.jokersPerWall)) {
      const card = { ...this.cards.get(b.uid)!, enh: 'joker' as const };
      this.cards.set(card.uid, card);
      this.world.setBrick(b.id, card);
    }
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

  // ───────────────────────── Briques voilées (prototype) ─────────────────────────

  private layCards() {
    const { rng } = this.run!;
    if (this.wallStyle.style === 'random') {
      for (const id of rng.shuffle([...this.wallSlots])) this.world.setBrick(id, this.draw());
      return;
    }
    const bricks = this.world.bricks;
    const draw = (pred?: (c: BrickCard) => boolean) => (pred ? this.drawWhere(pred) : this.draw());
    const { style, order } = this.wallStyle;
    let slots = this.wallSlots.map((id) => bricks[id]);
    let vein = 0;
    if (style === 'blocks' || style === 'mixed') {
      const { blocks, rest } = cutBlocks(slots, COLS, order, rng);
      for (const block of blocks) {
        vein++;
        const cards = fillBlock(block, draw);
        block.rows.forEach((row, r) => row.forEach((id, c) => {
          bricks[id].vein = vein;
          bricks[id].veinKind = block.kind;
          this.world.setBrick(id, cards[r][c]);
        }));
      }
      slots = rest.map((s) => bricks[s.id]);
    }
    // Restes des blocs : Filons de rangée (mixed) ou bruit (blocks)
    const rowCfg = style === 'blocks' ? { ...this.wallStyle, style: 'veins' as const, order: 0 } : style === 'mixed' ? { ...this.wallStyle, style: 'veins' as const } : this.wallStyle;
    const segs = cutSegments(slots, (r, c) => bricks[r * COLS + c].kind === 'block');
    for (const seg of planVeins(segs, rowCfg, rng)) {
      const cards = fillSegment(seg, rowCfg.style, draw);
      if (seg.kind) vein++;
      seg.slots.forEach((id, k) => {
        bricks[id].vein = seg.kind ? vein : 0;
        bricks[id].veinKind = seg.kind;
        this.world.setBrick(id, cards[k]);
      });
    }
  }

  /** Malédiction du Mur : briques blindées ou vivantes (copies limitées à ce Mur, le deck ne change pas). */
  private applyWallMod() {
    const mod = this.run!.wallMod?.mod;
    if (!mod) return;
    const live = this.world.bricks.filter((b) => b.alive && b.kind === 'brick');
    if (mod.living) {
      const plain = live.filter((b) => this.cards.get(b.uid)?.enh === 'none');
      for (const b of this.run!.rng.shuffle(plain).slice(0, mod.living)) {
        const card = { ...this.cards.get(b.uid)!, enh: this.run!.rng.pick(LIVING) };
        this.cards.set(card.uid, card);
        this.world.setBrick(b.id, card);
      }
    }
    if (mod.armored) for (const b of live) b.hp = Math.max(b.hp, 2);
  }

  /** Emplacements où une brique peut apparaître ou fuir (loin des bumpers, portails et balles). */
  private freeSlots(): number[] {
    const w = this.world;
    const near = (x: number, y: number, r: number) => Math.hypot(x, y) < r;
    return w.bricks.filter((b) => !b.alive && b.kind !== 'block'
      && !w.bumpers.some((p) => near(p.x - b.baseX, p.y - b.baseY, 1.3))
      && !w.portals.some((p) => near(p.ax - b.baseX, p.ay - b.baseY, 1.3) || near(p.bx - b.baseX, p.by - b.baseY, 1.3))
      && !w.balls.some((ball) => Math.abs(ball.x - b.x) < b.w / 2 + 0.7 && Math.abs(ball.y - b.y) < b.h / 2 + 0.7))
      .map((b) => b.id);
  }

  /** Pose une brique temporaire (pour ce Mur seulement). */
  private spawnTemp(id: number, color: BrickColor, value: number, enh: Enh = 'none') {
    const card = newCard(color, value, enh);
    this.cards.set(card.uid, card);
    this.temps.add(card.uid);
    const b = this.world.bricks[id];
    b.vein = 0;
    b.veinKind = null;
    this.world.setBrick(id, card);
  }

  /** Première carte du dessus de la pioche qui vérifie `pred`, sinon la carte du dessus. */
  private drawWhere(pred: (c: BrickCard) => boolean): BrickCard | null {
    const pile = this.wall.drawPile;
    for (let i = pile.length - 1; i >= Math.max(0, pile.length - this.wallStyle.lookahead); i--) {
      if (pred(pile[i])) return pile.splice(i, 1)[0];
    }
    return this.draw();
  }

  /** Les prochaines briques de la pioche, la première d'abord (sans compter un remélange de la défausse). */
  peek(n = PEEK): BrickCard[] {
    return this.wall.drawPile.slice(-n).reverse();
  }

  /** Briques remplacées au plus par une Défausse (Grand ménage : plus). */
  get discardSize() {
    return DISCARD_BRICKS + (this.run ? sumMod(this.run.relics, 'discardSize') : 0);
  }

  /**
   * Défausse (avant un Lancer) : jusqu'à discardSize briques du mur partent à la défausse
   * et sont remplacées, dans l'ordre de sélection, par les prochaines briques de la pioche.
   * Retourne les emplacements effectivement remplacés.
   */
  discardOn(slotIds: number[]): number[] {
    const run = this.run;
    const w = this.wall;
    if (!run || w.discardsLeft <= 0) return [];
    const bricks = [...new Set(slotIds)].map((id) => this.world.bricks[id])
      .filter((b) => b.alive && b.kind === 'brick' && this.cards.has(b.uid)).slice(0, this.discardSize);
    if (!bricks.length) return [];
    // On pioche d'abord : une brique défaussée ne peut pas revenir aussitôt par un remélange
    const fresh = bricks.map(() => this.draw());
    const done: number[] = [];
    bricks.forEach((b, i) => {
      const card = fresh[i];
      if (!card) return;
      // Une copie limitée au Mur (Joker, Pinceau, brique vivante) redevient la vraie carte du deck
      const orig = run.cards.find((c) => c.uid === b.uid);
      if (orig) {
        this.cards.set(orig.uid, orig);
        w.discard.push(orig);
      }
      this.temps.delete(b.uid);
      b.vein = 0;
      b.veinKind = null;
      this.world.setBrick(b.id, card);
      if (run.wallMod?.mod.armored) b.hp = Math.max(b.hp, 2);
      done.push(b.id);
    });
    if (!done.length) return [];
    w.discardsLeft--;
    run.stats.discards += done.length;
    this.updateSnap();
    return done;
  }

  draw(): BrickCard | null {
    const w = this.wall;
    if (!w.drawPile.length && w.discard.length) {
      w.drawPile = this.run!.rng.shuffle(w.discard);
      w.discard = [];
    }
    return w.drawPile.pop() ?? null;
  }

  /** Après un Lancer : le mur est-il gagné, perdu, ou on continue ? */
  afterLancer(): 'won' | 'lost' | 'continue' {
    const run = this.run!;
    this.pot.reset();
    this.explosions = [];
    if (run.balls[this.selectedBall]?.used) this.selectedBall = 0;
    this.updateSnap();
    if (this.wall.score >= this.wall.target) return 'won';
    if (this.wall.lancersLeft <= 0) return 'lost';
    return 'continue';
  }

  /** Lancer de secours : proposé quand le Mur est perdu, 1 fois par Mur (économie resserrée). */
  get rescuePrice(): number | null {
    const run = this.run;
    if (!run?.tight || this.rescueUsed || this.wall.lancersLeft > 0 || this.wall.score >= this.wall.target) return null;
    return rescueCost(run);
  }

  buyRescue(): boolean {
    const price = this.rescuePrice;
    if (price === null || this.run!.money < price) return false;
    this.run!.money -= price;
    this.rescueUsed = true;
    this.wall.lancersLeft++;
    this.wall.lancersMax++;
    return true;
  }

  /** Récompenses du mur gagné (à encaisser avec collect). */
  rewards() {
    return cashOut(this.run!, this.wall.lancersLeft, this.wall.score / Math.max(1, this.wall.target));
  }

  collect(total: number) {
    this.run!.money += total;
  }

  get isVictory() {
    const run = this.run!;
    return isBossWall(run) && run.ante === WIN_ANTE && !this.endless;
  }

  // ───────────────────────── Actions ─────────────────────────

  launch(angle: number): boolean {
    const run = this.run;
    if (!run || this.wall.lancersLeft <= 0) return false;
    let bi = run.balls[this.selectedBall];
    if (!bi || bi.used) { this.selectedBall = 0; bi = run.balls[0]; }
    const def = bi.def;
    if (this.selectedBall > 0) bi.used = true;
    this.world.ballMods = { pierce: def.pierce ?? 0, wrap: !!def.wrap, noSpeedGain: !!def.noSpeedGain };
    this.world.twin = hasFlag(run.relics, 'twin');
    this.wall.lancersLeft--;
    this.pot.reset();
    this.shockDone = false;
    this.headTaken = false;
    this.tripCands = [];
    this.world.frenzy = false;
    this.layEggs();
    this.updateSnap();
    this.world.launch(angle);
    // Rune de Scission : la balle part en éventail
    for (let k = 0; k < this.splitNext; k++) this.world.splitBall((k % 2 ? -1 : 1) * 0.3 * (1 + (k >> 1)));
    this.splitNext = 0;
    this.aimedSlot = -1; // le lancer est visé à l'arrêt : seul un renvoi peut faire « Dans le mille »
    for (const id of this.lasered) this.world.destroyBrick(id, 'laser');
    this.lasered.clear();
    return true;
  }

  /** Reines : chacune pond une brique de sa couleur dans une case libre voisine. */
  private layEggs() {
    const run = this.run!;
    const ids: number[] = [];
    for (const q of this.world.bricks) {
      if (!q.alive || q.kind !== 'brick' || this.cards.get(q.uid)?.enh !== 'reine') continue;
      const free = new Set(this.freeSlots());
      const around = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]]
        .map(([r, c]) => [q.row + r, q.col + c])
        .filter(([r, c]) => r >= 0 && r < ROWS && c >= 0 && c < COLS && free.has(r * COLS + c));
      if (!around.length) continue;
      const [r, c] = around[0];
      this.spawnTemp(r * COLS + c, q.color, 1 + run.rng.int(10));
      ids.push(r * COLS + c);
    }
    if (ids.length) this.events.emit('spawned', { ids });
  }

  /** Mémorise la brique que la balle va toucher en premier (même calcul que le guide doré). */
  private aimAt() {
    const b = this.world.ball;
    const id = predictPath(this.world, b.x, b.y, b.dx, b.dy, 2, null).brick;
    this.aimedSlot = id >= 0 && this.world.bricks[id].kind === 'brick' ? id : -1;
  }

  selectBall(i: number): boolean {
    const run = this.run;
    if (!run || !run.balls[i] || run.balls[i].used) return false;
    this.selectedBall = i;
    return true;
  }

  /**
   * Secousse en vol : la balle est poussée vers la raquette ; sous la raquette, elle remonte
   * (la Main est sauvée mais la Série retombe à 0). 2 Secousses dans le même trajet = TILT, balle perdue.
   */
  secousse(): TiltKind | null {
    if (!this.run || this.wall.secoussesLeft <= 0 || this.world.ball.stuck) return null;
    this.wall.secoussesLeft--;
    this.pot.shakes++;
    const kind = this.world.tilt();
    if (kind === 'save') {
      this.pot.streak = 0;
      this.pot.frenzy = this.world.frenzy = false;
    }
    this.aimedSlot = -1;
    return kind;
  }

  applyAstre(a: AstreDef): number {
    const run = this.run!;
    run.levels[a.figure] += 1 + sumMod(run.relics, 'astroBonus');
    return run.levels[a.figure];
  }

  /** Consommable sans cible (Astre, Ermite). Retourne false s'il faut choisir des briques. */
  useInstant(i: number): { astre?: AstreDef; money?: number; split?: number; discards?: number } | false {
    const run = this.run!;
    const c = run.consumables[i];
    if (!c) return false;
    if (c.kind === 'astre') {
      run.consumables.splice(i, 1);
      this.applyAstre(c);
      return { astre: c };
    }
    if (c.targets > 0) return false;
    run.consumables.splice(i, 1);
    if (c.split) {
      this.splitNext += c.split;
      return { split: this.splitNext };
    }
    if (c.discards) {
      this.wall.discardsLeft += c.discards;
      this.wall.discardsMax += c.discards;
      return { discards: c.discards };
    }
    let money = 0;
    if (c.doubleMoney) {
      money = Math.min(c.doubleMoney, run.money);
      run.money += money;
    }
    return { money };
  }

  /** Applique une Rune sur des emplacements du mur (dans l'ordre de sélection). */
  applyRuneOn(index: number, slotIds: number[]): RuneDef {
    const run = this.run!;
    const rune = run.consumables[index] as RuneDef;
    // Seules les briques encore sur le mur (sinon les cartes ne correspondent plus aux emplacements)
    const bricks = slotIds.map((id) => this.world.bricks[id]).filter((b) => b.alive && b.kind === 'brick' && this.cards.has(b.uid));
    // Une brique peinte (Pinceau) redevient la vraie carte du deck avant d'être modifiée
    for (const b of bricks) {
      const orig = run.cards.find((c) => c.uid === b.uid);
      if (orig) this.cards.set(b.uid, orig);
    }
    const cards = bricks.map((b) => this.cards.get(b.uid)!);
    run.consumables.splice(index, 1);
    if (rune.destroy) {
      const uids = new Set(cards.map((c) => c.uid));
      run.cards = run.cards.filter((c) => !uids.has(c.uid));
      bricks.forEach((b) => this.world.setBrick(b.id, null));
    } else if (rune.duplicate) {
      for (const c of cards) {
        const copy = cloneCard(c);
        run.cards.push(copy);
        this.cards.set(copy.uid, copy);
        this.wall.drawPile.splice(run.rng.int(this.wall.drawPile.length + 1), 0, copy);
      }
    } else {
      applyRune(rune, cards);
      bricks.forEach((b, i) => this.world.setBrick(b.id, cards[i]));
    }
    this.updateSnap();
    return rune;
  }

  /** Utilise un Outil (1 fois par Mur) sur des emplacements du mur, dans l'ordre de sélection. */
  useTool(index: number, slotIds: number[]): ToolDef | null {
    const t = this.run!.tools[index];
    if (!t || t.used) return null;
    t.used = true;
    const bricks = slotIds.map((id) => this.world.bricks[id]).filter((b) => b.alive && b.kind === 'brick');
    if (t.def.swap) {
      for (let i = 0; i + 1 < bricks.length; i += 2) {
        const a = this.cards.get(bricks[i].uid), b = this.cards.get(bricks[i + 1].uid);
        if (!a || !b) continue;
        this.world.setBrick(bricks[i].id, b);
        this.world.setBrick(bricks[i + 1].id, a);
      }
    }
    if (t.def.laser) bricks.forEach((b) => this.lasered.add(b.id));
    this.updateSnap();
    return t.def;
  }

  // ───────────────────────── Score ─────────────────────────

  runView(): RunView {
    const run = this.run!;
    return {
      money: run.money, deckSize: run.cards.length, relicCount: run.relics.length,
      lancersLeft: this.wall.lancersLeft, secoussesLeft: this.wall.secoussesLeft, discardsLeft: this.wall.discardsLeft,
      lastLancer: this.wall.lancersLeft === 0,
    };
  }

  speedMul() {
    const run = this.run;
    if (!run) return 1;
    return prodMod(run.relics, 'speedMul') * (activeBoss(run)?.speedMul ?? 1) * (run.wallMod?.mod.speedMul ?? 1);
  }

  get currentBall() {
    return this.run?.balls[this.selectedBall]?.def;
  }

  score(catchOffset: number | null, roll: boolean, lossFactor = 1, pot: Pot = this.pot): ScoreResult {
    const run = this.run!;
    const boss = activeBoss(run);
    return computeScore({
      pot, relics: run.relics, levels: run.levels, catchOffset,
      ballSpeed: this.world.ball.speed * this.speedMul(), run: this.runView(),
      roll: roll ? () => run.rng.next() : null, lossFactor,
      rules: {
        requiredValue: boss?.requiredValue ? run.bossValue : undefined,
        bannedFigures: boss?.oncePerFigure ? this.played : undefined,
      },
      orders: this.orders,
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

  /** Cartes encore sur le mur. */
  wallCards(): BrickCard[] {
    return this.world.bricks.filter((b) => b.alive && b.kind === 'brick').map((b) => this.cards.get(b.uid)!).filter(Boolean);
  }

  outs(): Outs {
    // Éclipse : les briques éteintes n'entrent pas dans la Main, elles ne peuvent pas l'améliorer
    const run = this.run;
    const off = run && activeBoss(run)?.eclipse ? run.eclipseColor : -1;
    return computeOuts(this.previewPot(), this.wallCards().filter((c) => isColorless(c) || c.color !== off));
  }

  /** Met à jour les briques "aimantées" de la visée assistée (utiles + cibles ★, sauf Brouillard). */
  updateSnap() {
    const snap = this.world.snapSlots;
    snap.clear();
    if (!this.run || activeBoss(this.run)?.fog || this.run.wallMod?.mod.dark) return;
    const useful = this.outs().useful;
    for (const b of this.world.bricks) {
      if (b.alive && b.kind === 'brick' && (b.star || useful.has(b.uid))) snap.add(b.id);
    }
  }

  /** Applique un encaissement : score, argent, Verre brisé, Reliques évolutives. */
  commitCashIn(res: ScoreResult): { destroyed: number } {
    const run = this.run!;
    if (!res.blocked && res.figure && activeBoss(run)?.oncePerFigure) this.played.add(res.figure.id);
    this.wall.score += res.total;
    run.money += res.money;
    for (const o of res.orders) o.done = true;
    run.stats.bestHand = Math.max(run.stats.bestHand, res.total);
    let destroyed = 0;
    if (res.destroyed.length) {
      const gone = new Set(res.destroyed);
      run.cards = run.cards.filter((c) => !gone.has(c.uid));
      this.wall.discard = this.wall.discard.filter((c) => !gone.has(c.uid));
      run.stats.glass += gone.size;
      run.relics.forEach((r) => r.def.onGlassBroken?.(r, gone.size));
      destroyed = gone.size;
    }
    // Une Main annulée par un Boss ne fait pas évoluer les Reliques
    if (!res.blocked) run.relics.forEach((r) => r.def.onCashIn?.(r, res, this.pot));
    return { destroyed };
  }

  // ───────────────────────── Simulation ─────────────────────────

  /** Un pas de simulation (bombes en chaîne, repose du mur, physique). */
  step(dt: number, input: SimInput) {
    // Les bombes n'explosent que balle en jeu (pas pendant un encaissement)
    for (let i = this.explosions.length - 1; i >= 0 && !this.world.ball.stuck; i--) {
      const e = this.explosions[i];
      e.t -= dt;
      if (e.t <= 0) {
        this.explosions.splice(i, 1);
        this.world.destroyBrick(e.id);
      }
    }
    if (this.settleIn >= 0) {
      this.settleIn -= dt;
      if (this.settleIn < 0) this.applyGravity();
    }
    if (this.refillIn >= 0) {
      this.refillIn -= dt;
      if (this.refillIn < 0) {
        this.layWall();
        this.applyWallMod();
        this.updateSnap();
        this.events.emit('refilled', {});
      }
    }
    this.world.step(dt, input);
  }

  private bindWorld() {
    const ev = this.world.events;

    ev.on('brickBroken', ({ brick, dx, dy, cause, hit }) => {
      const run = this.run;
      const card = this.cards.get(brick.uid);
      if (!run || !card) return;
      if (!this.temps.has(card.uid)) this.wall.discard.push(card);
      run.stats.bricks++;
      const boss = activeBoss(run);
      const eclipsed = !!boss?.eclipse && card.color === run.eclipseColor && !isColorless(card);
      let out: PotBrick | null = null;
      const tags: string[] = [];
      let money = 0;
      // Touchée par la balle (rebond ou traversée de la Lourde), pas par une explosion
      const touched = cause === 'ball' || cause === 'pierce';
      // Règle « brique de tête » : la viser est la règle, « Dans le mille » n'a plus lieu d'être
      const called = !this.headRule && touched && brick.id === this.aimedSlot;
      if (touched) this.aimedSlot = -1;
      const best = this.headRule && this.headMode === 'best';
      const shard = this.headRule && cause !== 'laser' && (!touched || this.headTaken || best);
      if (this.headRule && touched) this.headTaken = true;
      const pb: PotBrick = {
        uid: card.uid, color: card.color, value: card.value, enh: card.enh, edition: card.edition, cause,
        wallBounces: hit.wallBounces, sideBounces: hit.sideBounces, bumped: hit.bumped, ported: hit.ported, fromAbove: hit.fromAbove,
        trip: cause === 'laser' ? -1 : this.pot.trip, star: brick.star, called, row: brick.row, col: brick.col, vein: brick.vein,
        frenzy: this.pot.frenzy,
      };
      if (shard) {
        const chips = this.shardChips(card);
        this.pot.addShard(card, chips);
        if (best && touched && !eclipsed) this.tripCands.push({ pb, chips, x: brick.x, y: brick.y });
      } else if (!eclipsed) {
        out = this.pot.addBrick(this.resolveJoker(pb), this.dropChooser());
        if (this.pot.frenzy) tags.push('🔥');
        this.checkShock(brick);
        if (brick.star) tags.push('★ Cible');
        if (called) tags.push(PROWESS.mille.name);
        if (hit.ported) tags.push(PROWESS.teleport.name);
        if (hit.bumped) tags.push(PROWESS.carambole.name);
        if (hit.fromAbove) tags.push(PROWESS.dessus.name);
        if (hit.sideBounces >= 3 && cause !== 'explosion') tags.push(PROWESS.bande.name);
        if (this.pot.segment === 3) tags.push(PROWESS.double.name);
        money = this.currentBall?.money ?? 0;
      }
      if (card.enh === 'pinata') {
        money += PINATA_MONEY;
        tags.push('Piñata');
        const a = run.rng.range(-0.6, 0.6);
        this.world.spawnExtra(brick.x, brick.y, Math.sin(a), -Math.cos(a));
      }
      run.money += money;
      const bomb = card.enh === 'bombe';
      if (bomb) {
        const big = hasFlag(run.relics, 'bigBomb');
        for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) {
          if (!r && !c) continue;
          if (!big && r && c) continue;
          const rr = brick.row + r, cc = brick.col + c;
          if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) this.explosions.push({ id: rr * COLS + cc, t: BOMB_DELAY });
        }
      }
      if (hasFlag(run.relics, 'paint') && !isColorless(card)) this.paintAround(brick, card.color);
      if (hasFlag(run.relics, 'chain') && cause !== 'explosion' && !isColorless(card)) {
        // Voisinage : les voisines de rangée de même valeur cassent aussi (pas de réaction en chaîne)
        for (const nb of this.rowNeighbors(brick)) {
          const c = this.cards.get(nb.uid);
          if (c && !isColorless(c) && c.value === card.value) this.explosions.push({ id: nb.id, t: BOMB_DELAY * 1.5 });
        }
      }
      if (this.world.gravity && this.settleIn < 0) this.settleIn = GRAVITY_DELAY;
      this.updateSnap();
      this.events.emit('brick', { brick, card, eclipsed, out, tags, shard, money, bomb, cause, dx, dy });
    });

    ev.on('paddleHit', ({ offset, extra }) => {
      const run = this.run;
      if (!run || extra) return;
      this.resolveTrip();
      this.pot.addRebound(offset);
      this.headTaken = false;
      this.aimAt();
      run.relics.forEach((r) => r.def.onRebound?.(r));
      const tide = (activeBoss(run)?.tide ?? 0) + (run.wallMod?.mod.tide ?? 0);
      if (tide) this.world.setTide(this.world.tide + tide);
      this.checkFrenzy();
      if (this.pot.rebounds === 3 && hasFlag(run.relics, 'mitosis')) this.world.splitBall(0.35);
      if (hasFlag(run.relics, 'mason')) {
        const free = this.freeSlots();
        if (free.length) {
          const id = run.rng.pick(free);
          this.spawnTemp(id, run.rng.int(4) as BrickColor, 7);
          this.events.emit('spawned', { ids: [id] });
        }
      }
      // Mimics : nouvelle valeur à chaque renvoi (copie limitée à ce Mur)
      const morphed: number[] = [];
      for (const br of this.world.bricks) {
        const c = br.alive && br.kind === 'brick' ? this.cards.get(br.uid) : undefined;
        if (c?.enh !== 'mimic') continue;
        this.cards.set(c.uid, { ...c, value: 1 + run.rng.int(10) });
        morphed.push(br.id);
      }
      if (morphed.length) this.events.emit('morphed', { ids: morphed });
      this.updateSnap();
    });

    ev.on('twinHit', () => {
      if (!this.run || this.world.ball.stuck) return;
      // Raquette siamoise : le rebond au plafond compte comme un renvoi de Série
      this.pot.twinHits++;
      this.pot.streak++;
      this.checkFrenzy();
    });

    ev.on('brickDamaged', ({ brick }) => {
      // Fuyarde : au premier coup, elle file vers une case libre loin de la balle
      const card = this.cards.get(brick.uid);
      if (!this.run || card?.enh !== 'fuyarde') return;
      const far = this.freeSlots().filter((id) => Math.hypot(this.world.bricks[id].x - brick.x, this.world.bricks[id].y - brick.y) > 3);
      if (!far.length) return;
      const to = this.run.rng.pick(far);
      this.world.moveBrick(brick.id, to);
      if (this.lasered.delete(brick.id)) this.lasered.add(to);
      this.updateSnap();
      this.events.emit('fled', { from: brick.id, to });
    });

    ev.on('bumperHit', () => {
      if (this.run && !this.world.ball.stuck) this.pot.addWallBounce();
    });

    ev.on('wallHit', () => {
      if (!this.run || this.world.ball.stuck) return;
      this.pot.addWallBounce();
      const sm = this.currentBall?.wallMult;
      if (sm) this.pot.springMult += sm;
    });

    ev.on('caught', ({ x, offset }) => {
      if (!this.run) return;
      this.resolveTrip();
      // Les balles supplémentaires éclatent : chacune multiplie la Main
      this.pot.airBalls = this.world.popExtras();
      if (this.pot.empty) this.events.emit('lancerEnd', { kind: 'empty', x });
      else this.events.emit('lancerEnd', { kind: 'cash', res: this.score(offset, true), x });
    });

    ev.on('ballLost', ({ x }) => {
      const run = this.run;
      if (!run) return;
      this.resolveTrip();
      run.stats.ballsLost++;
      run.relics.forEach((r) => r.def.onBallLost?.(r));
      if (hasFlag(run.relics, 'pact')) {
        const victims = run.relics.filter((r) => !r.def.pact);
        if (victims.length) {
          const v = run.rng.pick(victims);
          run.relics.splice(run.relics.indexOf(v), 1);
          this.events.emit('relicLost', { def: v.def });
        }
      }
      this.explosions = [];
      const keep = Math.max(0, ...run.relics.map((r) => r.def.keepOnLoss ?? 0));
      if (keep > 0 && !this.pot.empty) this.events.emit('lancerEnd', { kind: 'insured', res: this.score(null, true, keep), x, keep });
      else this.events.emit('lancerEnd', { kind: 'lost', x, potLost: !this.pot.empty });
    });

    ev.on('wallCleared', () => {
      if (!this.run) return;
      this.refillIn = REFILL_DELAY;
      this.events.emit('cleared', {});
    });
  }

  /** Mode 'best' : la meilleure brique du trajet quitte les Éclats et entre dans la Main. */
  /** Jetons d'un Éclat. */
  shardChips(card: { value: number; enh: Enh }) {
    return card.enh === 'pierre' ? 10 : Math.max(1, Math.round(card.value * this.shardRate));
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

  /**
   * La Main telle qu'elle serait si le trajet finissait maintenant (la meilleure candidate y est déjà).
   * Sert à l'affichage et aux décisions : c'est ce qu'on encaisserait en attrapant la balle.
   * Ne pas modifier le résultat (c'est this.pot quand il n'y a pas de candidate).
   */
  previewPot(): Pot {
    const lead = this.tripLead();
    if (!lead) return this.pot;
    const p = this.pot.clone();
    p.shards--;
    p.shardChips -= lead.chips;
    p.broken--;
    p.addBrick({ ...lead.pb }, this.dropChooser(p));
    return p;
  }

  private resolveTrip() {
    const pick = this.tripLead();
    this.tripCands = [];
    if (!pick) return;
    this.pot.shards--;
    this.pot.shardChips -= pick.chips;
    this.pot.broken--;
    this.pot.addBrick(pick.pb, this.dropChooser());
    this.events.emit('tripCard', { uid: pick.pb.uid, x: pick.x, y: pick.y, color: pick.pb.color });
  }

  /** Série assez longue : la balle s'embrase jusqu'à la fin du Lancer. */
  private checkFrenzy() {
    if (this.pot.frenzy || this.pot.streak < frenzyStreak(this.run!.relics)) return;
    this.pot.frenzy = this.world.frenzy = true;
    this.world.ball.burnLeft = Math.max(this.world.ball.burnLeft, 1);
    this.events.emit('frenzy', { x: this.world.ball.x, y: this.world.ball.y });
  }

  /** Full ou mieux : onde de choc qui pulvérise les briques autour (une fois par Lancer). */
  private checkShock(brick: Brick) {
    if (this.shockDone) return;
    const fig = evaluateHand(this.pot.bricks, this.pot.chameleon).figure;
    if (figureIndex(fig) < SHOCK_FIGURE) return;
    this.shockDone = true;
    for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) {
      const rr = brick.row + r, cc = brick.col + c;
      if ((r || c) && rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) this.explosions.push({ id: rr * COLS + cc, t: BOMB_DELAY * 2 });
    }
    this.events.emit('bigFigure', { x: brick.x, y: brick.y, figure: fig! });
  }

  private applyGravity() {
    const moves = this.world.settle();
    if (!moves.length) return;
    // Les briques visées par l'Arbalète suivent leur chute
    if (this.lasered.size) {
      const moved = new Map(moves.map((m) => [m.from, m.to]));
      this.lasered = new Set([...this.lasered].map((id) => moved.get(id) ?? id));
    }
    this.updateSnap();
    this.events.emit('settled', { moves });
  }

  /** Voisine la plus proche de chaque côté dans la rangée, à 2 cases au plus (un bloc arrête la recherche). */
  private rowNeighbors(brick: Brick): Brick[] {
    const out: Brick[] = [];
    for (const dc of [-1, 1]) {
      for (let step = 1; step <= 2; step++) {
        const col = brick.col + dc * step;
        if (col < 0 || col >= COLS) break;
        const cand = this.world.bricks[brick.row * COLS + col];
        if (cand.kind === 'block') break;
        if (cand.alive && cand.kind === 'brick') { out.push(cand); break; }
      }
    }
    return out;
  }

  /** Pinceau : les voisines de rangée prennent la couleur (copie de carte limitée à ce Mur, le deck ne change pas). */
  private paintAround(brick: Brick, color: BrickColor) {
    const ids: number[] = [];
    for (const nb of this.rowNeighbors(brick)) {
      const c = this.cards.get(nb.uid);
      if (!c || isColorless(c) || c.color === color) continue;
      this.cards.set(c.uid, { ...c, color });
      nb.color = color;
      ids.push(nb.id);
    }
    if (ids.length) this.events.emit('painted', { ids, color });
  }

  // ───────────────────────── Boutique ─────────────────────────

  openShop(): ShopItem[] {
    const run = this.run!;
    this.shopItems = generateShop(run);
    this.rerollCount = 0;
    this.atelier = { removed: false, retailed: false };
    this.skipReward = run.wallIdx !== 1 ? rollSkip(run) : null; // le mur suivant n'est pas un Boss
    this.wallModOffer = run.wallIdx !== 1 ? rollWallMod(run) : null;
    run.pendingMod = null;
    return this.shopItems;
  }

  // ───────────────────────── Atelier ─────────────────────────

  /** Services de l'Atelier déjà utilisés pendant cette visite de boutique. */
  atelier: AtelierVisit = { removed: false, retailed: false };

  get atelierOpen() {
    return this.run?.ruleset === 'v3';
  }

  /** Retire une brique du deck. */
  atelierRemove(uid: number): boolean {
    const run = this.run!;
    if (!this.atelierOpen || !canRemove(run, this.atelier) || !run.cards.some((c) => c.uid === uid)) return false;
    run.money -= removePrice(run);
    run.removals++;
    run.cards = run.cards.filter((c) => c.uid !== uid);
    this.atelier.removed = true;
    return true;
  }

  /** Retaille une brique du deck : ±1 à sa valeur. */
  atelierRetail(uid: number, delta: 1 | -1): boolean {
    const run = this.run!;
    const card = run.cards.find((c) => c.uid === uid);
    if (!this.atelierOpen || !canRetail(run, this.atelier, card, delta)) return false;
    run.money -= RETAIL_PRICE;
    card!.value += delta;
    this.atelier.retailed = true;
    return true;
  }

  /** Accepte (ou refuse) la malédiction proposée pour le prochain Mur. */
  acceptWallMod(on: boolean) {
    this.run!.pendingMod = on ? this.wallModOffer : null;
  }

  get rerollCost() {
    return rerollBaseCost(this.run!) + this.rerollCount;
  }

  reroll(): boolean {
    const run = this.run!;
    if (run.money < this.rerollCost) return false;
    run.money -= this.rerollCost;
    this.rerollCount++;
    this.shopItems = rerollShop(run, this.shopItems);
    return true;
  }

  /** Achète un article. Pour un pack, retourne les options à choisir (via pickPack). */
  buy(i: number): { ok: false; reason: string } | { ok: true; options?: ReturnType<typeof openPack>; astre?: AstreDef } {
    const run = this.run!;
    const it = this.shopItems[i];
    if (!it || it.sold) return { ok: false, reason: 'vendu' };
    if (run.money < it.price) return { ok: false, reason: 'argent' };
    if (it.type === 'relic' && run.relics.length >= MAX_RELICS) return { ok: false, reason: 'reliques' };
    if (it.type === 'tool' && run.tools.length >= MAX_TOOLS) return { ok: false, reason: 'outils' };
    const runeSlotsFull = run.consumables.length >= run.maxConsumables;
    if (it.type === 'consumable' && it.def.kind === 'rune' && runeSlotsFull) return { ok: false, reason: 'consommables' };
    if (it.type === 'pack' && it.pack === 'runes' && runeSlotsFull) return { ok: false, reason: 'consommables' };
    run.money -= it.price;
    it.sold = true;
    if (it.type === 'relic') run.relics.push({ def: it.def, counter: 0, poly: it.poly });
    else if (it.type === 'consumable') {
      if (it.def.kind === 'astre') {
        this.applyAstre(it.def);
        return { ok: true, astre: it.def };
      }
      run.consumables.push(it.def);
    } else if (it.type === 'ball') run.balls.push({ def: it.def, used: false });
    else if (it.type === 'tool') run.tools.push({ def: it.def, used: false });
    else return { ok: true, options: openPack(run, it.pack) };
    return { ok: true };
  }

  /** Choix dans un pack ouvert. Retourne l'Astre appliqué s'il y en a un. */
  pickPack(options: ReturnType<typeof openPack>, pick: number | null): { astre?: AstreDef; ok: boolean } {
    const run = this.run!;
    if (pick === null) return { ok: true };
    const o = options[pick];
    if ('uid' in o) {
      run.cards.push(o);
      return { ok: true };
    }
    if (o.kind === 'astre') {
      this.applyAstre(o);
      return { ok: true, astre: o };
    }
    if (run.consumables.length < run.maxConsumables) {
      run.consumables.push(o);
      return { ok: true };
    }
    return { ok: false };
  }

  sell(i: number) {
    const run = this.run!;
    const r = run.relics[i];
    if (!r) return;
    run.money += sellPrice(r.def);
    run.relics.splice(i, 1);
  }

  move(i: number, dir: number) {
    const run = this.run!;
    const j = i + dir;
    if (j < 0 || j >= run.relics.length) return;
    [run.relics[i], run.relics[j]] = [run.relics[j], run.relics[i]];
  }

  /** Quitte la boutique et passe au mur suivant. Retourne true si une nouvelle Ante commence. */
  leaveShop(): boolean {
    const newAnte = advanceWall(this.run!);
    this.startWall();
    return newAnte;
  }

  /** Quitte la boutique en passant le prochain Mur (Petit ou Grand) contre sa récompense. */
  skipNextWall(): { newAnte: boolean; reward: SkipReward; options?: ReturnType<typeof openPack> } | null {
    const run = this.run!;
    const reward = this.skipReward;
    if (!reward) return null;
    this.skipReward = null;
    run.pendingMod = null;
    const a = advanceWall(run);
    if (reward.money) run.money += reward.money;
    const options = reward.pack ? openPack(run, reward.pack) : undefined;
    const b = this.leaveShop();
    return { newAnte: a || b, reward, options };
  }
}
