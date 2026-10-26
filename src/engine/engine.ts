import { Emitter } from '../core/events';
import { ENH, isColorless, type BrickCard, type BrickColor } from '../rules/bricks';
import { BOMB_DELAY, RING, type BreakInfo, type EffectApi, type Offset } from '../rules/effects';
import { WIN_ANTE, type DeckDef } from '../rules/decks';
import { evaluate, FIGURE_BY_ID, figureIndex, type FigureDef } from '../rules/figures';
import { LAYOUT_BY_ID, pickLayout, type LayoutDef } from '../rules/layouts';
import type { PotBrick } from '../rules/pot';
import { RULESETS, type Rules } from '../rules/ruleset';
import { hasFlag, prodMod, sumMod, type RelicDef } from '../rules/relics';
import {
  activeBoss, cashOut, createRun, currentTarget, evolveDeck, isBossWall, rescueCost, wallDiscards, wallLancers, wallSecousses, type Run,
} from '../rules/run';
import { frenzyStreak, type RunView, type ScoreResult } from '../rules/scoring';
import { rollOrders, type Order } from '../rules/orders';
import { loadRun, saveRun, type RunSave } from '../rules/run-save';
import { COLS, PADDLE_W, predictPath, ROWS, type Brick, type BreakCause, type SimInput, type TiltKind, World } from '../sim/world';
import { Consumables } from './consumables';
import { Hand } from './hand';
import { Shop } from './shop';
import { WallDeck } from './wall-deck';

export type { TripCand } from './hand';
export { PEEK } from './wall-deck';

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

/** Point de reprise d'un run : l'état juste avant le début d'un Mur. */
export interface EngineSave { run: RunSave; splitNext: number }

/** Délai entre la dernière brique cassée et la repose du mur (secondes de jeu). */
const REFILL_DELAY = 0.25;
/** Délai avant que les briques d'un mur à gravité tombent dans la case libérée. */
const GRAVITY_DELAY = 0.18;
/** À partir de cette main de poker, la Main déclenche une onde de choc (une fois par Lancer). */
const SHOCK_FIGURE = figureIndex(FIGURE_BY_ID.full);

/**
 * Moteur de jeu sans rendu : orchestre un run (murs, Lancers, simulation) et ses services
 * (Main, pioche, consommables, boutique). Partagé entre le jeu (qui ajoute le "juice") et le banc (bots).
 */
export class Engine {
  readonly events = new Emitter<EngineEvents>();
  /** Jeu de règles (figé). Il s'applique au prochain run. */
  rules: Rules;
  run: Run | null = null;
  wall: WallState = { target: 0, score: 0, lancersLeft: 0, lancersMax: 0, secoussesLeft: 0, secoussesMax: 0, discardsLeft: 0, discardsMax: 0, drawPile: [], discard: [] };
  /** Cartes posées sur le mur (copies limitées au Mur comprises), par uid. */
  cards = new Map<number, BrickCard>();
  wallSlots: number[] = [];
  layout: LayoutDef | null = null;
  selectedBall = 0;
  /** Brique au bout du guide doré au dernier renvoi : la toucher = « Dans le mille ». */
  aimedSlot = -1;
  /** Lancer de secours déjà acheté pendant ce Mur. */
  rescueUsed = false;
  /** Commandes du Mur (si les règles en ont). */
  orders: Order[] = [];
  /** Point de reprise du Mur en cours (pris au début du Mur). */
  checkpoint: EngineSave | null = null;

  readonly hand: Hand;
  readonly deck: WallDeck;
  readonly consumables: Consumables;
  readonly shop: Shop;

  private shockDone = false;
  private explosions: { id: number; t: number }[] = [];
  private refillIn = -1;
  private settleIn = -1;
  private readonly api: EffectApi;

  constructor(readonly world: World, rules: Rules = RULESETS.v3) {
    this.rules = rules;
    this.hand = new Hand(this);
    this.deck = new WallDeck(this);
    this.consumables = new Consumables(this);
    this.shop = new Shop(this);
    this.api = this.makeApi();
    this.bindWorld();
  }

  /** La Main du Lancer en cours. */
  get pot() {
    return this.hand.pot;
  }

  // ───────────────────────── Run / murs ─────────────────────────

  startRun(deck: DeckDef, stake: number, seed: number) {
    this.run = createRun(deck, stake, seed, this.rules);
    this.pot.short = this.rules.shortFigures;
    this.consumables.splitNext = 0;
    this.startWall();
  }

  /** Reprend un run sauvegardé au début de son Mur. Retourne false si la sauvegarde n'est plus lisible. */
  resume(save: EngineSave): boolean {
    const run = loadRun(save.run);
    if (!run) return false;
    this.run = run;
    this.pot.short = run.rules.shortFigures;
    this.consumables.splitNext = save.splitNext;
    this.startWall();
    return true;
  }

  get endless() {
    return !!this.run?.endless;
  }
  set endless(v: boolean) {
    if (this.run) this.run.endless = v;
  }

  startWall(): LayoutDef {
    const run = this.run!;
    this.checkpoint = { run: saveRun(run), splitNext: this.consumables.splitNext };
    run.wallMod = run.pendingMod;
    run.pendingMod = null;
    evolveDeck(run);
    this.cards = new Map(run.cards.map((c) => [c.uid, c]));
    const w = this.wall;
    w.target = currentTarget(run);
    w.score = 0;
    w.lancersMax = w.lancersLeft = wallLancers(run);
    w.secoussesMax = w.secoussesLeft = wallSecousses(run);
    w.discardsMax = w.discardsLeft = wallDiscards(run);
    this.deck.startWall();
    const boss = activeBoss(run);
    const layout = boss?.layout ? LAYOUT_BY_ID[boss.layout] : pickLayout(run.rng, run.ante, run.wallIdx, run.lastLayout);
    run.lastLayout = layout.id;
    this.layout = layout;
    this.world.setTide(0);
    this.wallSlots = this.world.setLayout(layout, boss?.pendulum ?? 0);
    this.rescueUsed = false;
    this.deck.layWall();
    this.orders = run.rules.orders ? rollOrders(run.rng, this.wallCards(), run.ante, run.rules.shortFigures) : [];
    this.hand.startWall(boss?.handSize);
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
    this.consumables.startWall();
    this.settleIn = -1;
    return layout;
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
    if (!run?.rules.tightEconomy || this.rescueUsed || this.wall.lancersLeft > 0 || this.wall.score >= this.wall.target) return null;
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
    this.hand.startLancer();
    this.shockDone = false;
    this.world.frenzy = false;
    this.eachWallBrick('onLaunch');
    this.updateSnap();
    this.world.launch(angle);
    this.aimedSlot = -1; // le lancer est visé à l'arrêt : seul un renvoi peut faire « Dans le mille »
    this.consumables.fireOnLaunch();
    return true;
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

  // ───────────────────────── État pour le scoring et l'affichage ─────────────────────────

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

  /** Cartes encore sur le mur. */
  wallCards(): BrickCard[] {
    return this.world.bricks.filter((b) => b.alive && b.kind === 'brick').map((b) => this.cards.get(b.uid)!).filter(Boolean);
  }

  /** Met à jour les briques "aimantées" de la visée assistée (utiles + cibles ★, sauf Brouillard). */
  updateSnap() {
    const snap = this.world.snapSlots;
    snap.clear();
    if (!this.run || activeBoss(this.run)?.fog || this.run.wallMod?.mod.dark) return;
    const useful = this.hand.outs().useful;
    for (const b of this.world.bricks) {
      if (b.alive && b.kind === 'brick' && (b.star || useful.has(b.uid))) snap.add(b.id);
    }
  }

  /** Applique un encaissement : score, argent, Verre brisé, Reliques évolutives. */
  commitCashIn(res: ScoreResult): { destroyed: number } {
    const run = this.run!;
    if (!res.blocked && res.figure && activeBoss(run)?.oncePerFigure) this.hand.played.add(res.figure.id);
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

  // ───────────────────────── Copies de cartes limitées au Mur ─────────────────────────

  /** La brique change (valeur, couleur, enchantement…) pour ce Mur seulement ; `place` la repose (points de vie compris). */
  patchCard(brick: Brick, patch: Partial<Omit<BrickCard, 'uid'>>, place = false): BrickCard {
    const card = { ...this.cards.get(brick.uid)!, ...patch };
    this.cards.set(card.uid, card);
    if (place) this.world.setBrick(brick.id, card);
    return card;
  }

  /** Une copie limitée au Mur (Joker, Pinceau, brique vivante) redevient la vraie carte du deck. */
  restoreDeckCard(brick: Brick): BrickCard | undefined {
    const orig = this.run?.cards.find((c) => c.uid === brick.uid);
    if (orig) this.cards.set(orig.uid, orig);
    return orig;
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
        this.deck.refill();
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
      this.deck.discardBroken(card);
      run.stats.bricks++;
      const boss = activeBoss(run);
      const eclipsed = !!boss?.eclipse && card.color === run.eclipseColor && !isColorless(card);
      const touched = cause === 'ball' || cause === 'pierce';
      // Règle « brique de tête » : la viser est la règle, « Dans le mille » n'a plus lieu d'être
      const called = !run.rules.headRule && touched && brick.id === this.aimedSlot;
      if (touched) this.aimedSlot = -1;
      const { shard, entered, out, tags } = this.hand.take(brick, card, cause, hit, eclipsed, called);
      if (entered) this.checkShock(brick);
      // Effets de l'amélioration de la brique (Piñata, Bombe), puis des Reliques (Pinceau, Voisinage)
      const info: BreakInfo = { brick, card, cause, money: entered ? this.currentBall?.money ?? 0 : 0, tags, bomb: false };
      ENH[card.enh].onBreak?.(this.api, info);
      run.money += info.money;
      for (const r of [...run.relics]) r.def.onBrickBroken?.(r, this.api, info);
      if (this.world.gravity && this.settleIn < 0) this.settleIn = GRAVITY_DELAY;
      this.updateSnap();
      this.events.emit('brick', { brick, card, eclipsed, out, tags, shard, money: info.money, bomb: info.bomb, cause, dx, dy });
    });

    ev.on('paddleHit', ({ offset, extra }) => {
      const run = this.run;
      if (!run || extra) return;
      this.hand.rebound(offset);
      this.aimAt();
      const tide = (activeBoss(run)?.tide ?? 0) + (run.wallMod?.mod.tide ?? 0);
      if (tide) this.world.setTide(this.world.tide + tide);
      this.checkFrenzy();
      for (const r of [...run.relics]) r.def.onRebound?.(r, this.api);
      // Mimics : nouvelle valeur à chaque renvoi (copie limitée à ce Mur)
      this.eachWallBrick('onRebound');
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
      if (this.run && card) ENH[card.enh].onDamaged?.(this.api, brick);
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
      this.hand.resolveTrip();
      // Les balles supplémentaires éclatent : chacune multiplie la Main
      this.pot.airBalls = this.world.popExtras();
      if (this.pot.empty) this.events.emit('lancerEnd', { kind: 'empty', x });
      else this.events.emit('lancerEnd', { kind: 'cash', res: this.hand.score(offset, true), x });
    });

    ev.on('ballLost', ({ x }) => {
      const run = this.run;
      if (!run) return;
      this.hand.resolveTrip();
      run.stats.ballsLost++;
      // Copie : le Pacte du Diable peut détruire une Relique pendant le parcours
      for (const r of [...run.relics]) r.def.onBallLost?.(r, this.api);
      this.explosions = [];
      const keep = Math.max(0, ...run.relics.map((r) => r.def.keepOnLoss ?? 0));
      if (keep > 0 && !this.pot.empty) this.events.emit('lancerEnd', { kind: 'insured', res: this.hand.score(null, true, keep), x, keep });
      else this.events.emit('lancerEnd', { kind: 'lost', x, potLost: !this.pot.empty });
    });

    ev.on('wallCleared', () => {
      if (!this.run) return;
      this.refillIn = REFILL_DELAY;
      this.events.emit('cleared', {});
    });
  }

  /** Effet d'amélioration de chaque brique du mur (Reine au Lancer, Mimic au renvoi). */
  private eachWallBrick(hook: 'onLaunch' | 'onRebound') {
    for (const br of this.world.bricks) {
      const c = br.alive && br.kind === 'brick' ? this.cards.get(br.uid) : undefined;
      if (c) ENH[c.enh][hook]?.(this.api, br, c);
    }
  }

  /** Mémorise la brique que la balle va toucher en premier (même calcul que le guide doré). */
  private aimAt() {
    const b = this.world.ball;
    const id = predictPath(this.world, b.x, b.y, b.dx, b.dy, 2, null).brick;
    this.aimedSlot = id >= 0 && this.world.bricks[id].kind === 'brick' ? id : -1;
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
    const fig = evaluate(this.pot).figure;
    if (figureIndex(fig) < SHOCK_FIGURE) return;
    this.shockDone = true;
    for (const id of this.around(brick, RING)) this.explosions.push({ id, t: BOMB_DELAY * 2 });
    this.events.emit('bigFigure', { x: brick.x, y: brick.y, figure: fig! });
  }

  private applyGravity() {
    const moves = this.world.settle();
    if (!moves.length) return;
    // Les briques visées par l'Arbalète suivent leur chute
    const lasered = this.consumables.lasered;
    if (lasered.size) {
      const moved = new Map(moves.map((m) => [m.from, m.to]));
      this.consumables.lasered = new Set([...lasered].map((id) => moved.get(id) ?? id));
    }
    this.updateSnap();
    this.events.emit('settled', { moves });
  }

  // ───────────────────────── Géométrie du mur ─────────────────────────

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

  /** Emplacements voisins d'une brique, dans les limites du mur. */
  private around(brick: Brick, offsets: readonly Offset[]): number[] {
    const out: number[] = [];
    for (const [r, c] of offsets) {
      const rr = brick.row + r, cc = brick.col + c;
      if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) out.push(rr * COLS + cc);
    }
    return out;
  }

  /** Ce que les effets (Reliques, améliorations de briques) peuvent faire sur le Mur. */
  private makeApi(): EffectApi {
    const engine = this;
    return {
      get run() { return engine.run!; },
      world: this.world,
      get pot() { return engine.pot; },
      card: (uid) => this.cards.get(uid),
      patchCard: (brick, patch, place) => this.patchCard(brick, patch, place),
      rowNeighbors: (brick) => this.rowNeighbors(brick),
      around: (brick, offsets) => this.around(brick, offsets),
      explode: (slot, delay) => this.explosions.push({ id: slot, t: delay }),
      freeSlots: () => this.freeSlots(),
      spawnTemp: (slot, color, value, enh) => this.deck.spawnTemp(slot, color, value, enh),
      spawned: (ids) => this.events.emit('spawned', { ids }),
      painted: (ids, color) => this.events.emit('painted', { ids, color }),
      morphed: (ids) => this.events.emit('morphed', { ids }),
      fled: (from, to) => {
        this.updateSnap();
        this.events.emit('fled', { from, to });
      },
      relicLost: (index) => {
        const [lost] = this.run!.relics.splice(index, 1);
        if (lost) this.events.emit('relicLost', { def: lost.def });
      },
      movedSlot: (from, to) => this.consumables.moved(from, to),
    };
  }
}
