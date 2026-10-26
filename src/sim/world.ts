import { Emitter } from '../core/events';
import { clamp, damp } from '../core/math';
import type { Rng } from '../core/rng';
import { ENH, type BrickColor, type Enh } from '../rules/bricks';
import type { VeinKind } from '../rules/veins';

export type { BrickColor } from '../rules/bricks';

/** Simulation pure (aucune dépendance au rendu). Unités monde, origine au centre du terrain. */
export const FIELD = {
  left: -8,
  right: 8,
  top: 13,
  bottom: -13,
  paddleY: -11,
} as const;

export const COLS = 10;
export const ROWS = 8;
export const BRICK_W = 1.42;
export const BRICK_H = 0.62;
const GAP_X = 0.1;
const GAP_Y = 0.16;
const WALL_TOP_Y = 10;
const MAX_TIDE = 6;

export const BALL_R = 0.3;
export const BASE_SPEED = 13;
const MAX_SPEED = 32;
const SPEED_GAIN = 1.085; // par rebond raquette — c'est le risque qui monte
/** Secousse : poussée latérale maximale sur la direction de la balle (≈ 25° à la verticale). */
const TILT_PUSH = 0.45;
/** Distance horizontale balle → raquette pour une poussée maximale. */
const TILT_REACH = 4;
const MAX_BOUNCE_ANGLE = (65 * Math.PI) / 180;
export const MAX_LAUNCH_ANGLE = (62 * Math.PI) / 180;
const MIN_DY = 0.28;
export const PADDLE_W = 3.2;
export const BUMPER_R = 0.55;
export const PORTAL_R = 0.6;
/** Visée assistée : un tir qui passe à moins de cet angle d'une brique "aimantée" se cale dessus. */
export const AIM_ASSIST = (4.5 * Math.PI) / 180;

export type SlotKind = 'empty' | 'brick' | 'block';

export interface Brick {
  id: number;
  row: number;
  col: number;
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  w: number;
  h: number;
  /** Type d'emplacement : brique du deck, bloc indestructible ou vide. */
  kind: SlotKind;
  /** Emplacement cible ★ : la brique cassée ici est relancée. */
  star: boolean;
  /** Filon de l'emplacement (0 = aucun) et son type, pour l'affichage. */
  vein: number;
  veinKind: VeinKind | null;
  color: BrickColor;
  alive: boolean;
  /** uid de la carte du deck posée dans cet emplacement */
  uid: number;
  hp: number;
  moveAmp: number;
  moveSpeed: number;
  movePhase: number;
  /** Tapis roulant : vitesse de défilement (unités/s, le signe donne le sens), la rangée boucle. */
  belt: number;
  /** Interrupteur : bloc qui ouvre/ferme les vannes quand la balle le touche. */
  isSwitch: boolean;
  /** Vanne : bloc qui s'ouvre (alive = false) ou se ferme à chaque interrupteur. */
  gate: boolean;
}

export interface Bumper {
  x: number;
  y: number;
  r: number;
}

export interface Portal {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
}

export interface Ball {
  /** Identifiant stable (rendu des balles supplémentaires). */
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  stuck: boolean;
  stuckOffset: number;
  /** Briques traversables restantes pour ce trajet (balle Lourde). */
  pierceLeft: number;
  /** Frénésie : briques traversées en brûlant (elles comptent comme touchées par la balle). */
  burnLeft: number;
  /** Contacts depuis le dernier renvoi (Prouesses). */
  hit: HitInfo;
  portalCd: number;
}

/** Balles supplémentaires en jeu au maximum (multiballe). */
export const MAX_EXTRAS = 4;
const newHit = (): HitInfo => ({ wallBounces: 0, sideBounces: 0, bumped: false, ported: false, fromAbove: false });

export interface Paddle {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
}

export interface BallMods {
  pierce: number;
  wrap: boolean;
  noSpeedGain: boolean;
}

export interface SimInput {
  paddleTargetX: number;
  catchArmed: boolean;
  speedMul: number;
}

/** Un motif de mur : 8 lignes de 10 caractères + rangées mobiles. */
export interface Layout {
  rows: string[];
  /** Amplitude du mouvement latéral par rangée (0 = fixe). */
  moving?: number[];
  /** Tapis roulants : vitesse de défilement par rangée (0 = fixe). */
  belts?: number[];
  /** Gravité : les briques tombent dans les cases libérées en dessous. */
  gravity?: boolean;
}

/** Période de boucle des tapis : une brique sort entièrement du cadre avant de réapparaître de l'autre côté. */
const BELT_SPAN = FIELD.right - FIELD.left + BRICK_W + GAP_X;
const wrapBelt = (x: number) => -BELT_SPAN / 2 + ((((x + BELT_SPAN / 2) % BELT_SPAN) + BELT_SPAN) % BELT_SPAN);

export type BreakCause = 'ball' | 'pierce' | 'explosion' | 'laser';

/** Comment la brique a été touchée : sert aux Prouesses. */
export interface HitInfo {
  wallBounces: number;
  /** Rebonds sur les murs latéraux et les bumpers seulement (pour la Prouesse Bande). */
  sideBounces: number;
  bumped: boolean;
  ported: boolean;
  fromAbove: boolean;
}

export type SimEvents = {
  brickBroken: { brick: Brick; x: number; y: number; dx: number; dy: number; cause: BreakCause; hit: HitInfo };
  brickDamaged: { brick: Brick; x: number; y: number };
  blockHit: { brick: Brick; x: number; y: number };
  bumperHit: { bumper: Bumper; x: number; y: number };
  portal: { fromX: number; fromY: number; toX: number; toY: number };
  /** extra : renvoi d'une balle supplémentaire (sans effet sur la Série). */
  paddleHit: { x: number; y: number; offset: number; speed: number; extra: boolean };
  /** Raquette jumelle (au plafond) touchée. */
  twinHit: { x: number; y: number };
  /** Multiballe : une balle apparaît, se perd, éclate à l'encaissement ou prend la relève de la balle perdue. */
  split: { x: number; y: number };
  extraLost: { x: number };
  extraPopped: { x: number; y: number };
  promoted: { x: number; y: number };
  wallHit: { x: number; y: number; nx: number; ny: number };
  caught: { x: number; y: number; offset: number };
  ballLost: { x: number };
  wallCleared: Record<string, never>;
  launched: { x: number; y: number };
  wrapped: { fromX: number; toX: number; y: number };
  switched: { brick: Brick; open: boolean };
  netSaved: { x: number; y: number };
  tilted: { x: number; y: number; kind: TiltKind };
};

/** Secousse en vol : poussée, sauvetage sous la raquette, ou TILT (2e Secousse du même trajet). */
export type TiltKind = 'nudge' | 'save' | 'tilt';

export class World {
  readonly events = new Emitter<SimEvents>();
  readonly bricks: Brick[] = [];
  bumpers: Bumper[] = [];
  portals: Portal[] = [];
  readonly ball: Ball = { id: 0, x: 0, y: 0, dx: 0, dy: 1, speed: BASE_SPEED, stuck: true, stuckOffset: 0, pierceLeft: 0, burnLeft: 0, hit: newHit(), portalCd: 0 };
  /** Balles supplémentaires : elles cassent des briques pour la même Main mais ne s'attrapent pas. */
  extras: Ball[] = [];
  private nextBallId = 1;
  readonly paddle: Paddle = { x: 0, y: FIELD.paddleY, w: PADDLE_W, h: 0.42, vx: 0 };
  /** Raquette jumelle au plafond, en miroir (Relique Raquette siamoise). */
  twin = false;
  readonly twinPaddle: Paddle = { x: 0, y: FIELD.top - 1.1, w: PADDLE_W * 0.8, h: 0.42, vx: 0 };
  /** Frénésie : la balle traverse 1 brique par trajet en brûlant. */
  frenzy = false;
  ballMods: BallMods = { pierce: 0, wrap: false, noSpeedGain: false };
  /** Emplacements vers lesquels la visée est aimantée (briques utiles, cibles ★). */
  snapSlots = new Set<number>();
  aimAssist = AIM_ASSIST;
  tide = 0; // Boss "La Marée" : descente du mur
  /** Filets restants pour ce Lancer (Relique Filet). */
  netLeft = 0;
  /** Mur à gravité (voir settle). */
  gravity = false;
  private switchCooldown = 0;
  time = 0;
  /** Multiplicateur de vitesse du dernier pas (pour prédire la position des rangées mobiles). */
  speedMul = 1;
  /** Temps depuis le dernier contact raquette / brique (anti-blocage). */
  private idle = 0;
  private unstick = 0;
  /** Secousses depuis le dernier contact raquette (ou le lancer). */
  tiltsThisTrip = 0;

  constructor(_rng: Rng) {
    const totalW = COLS * BRICK_W + (COLS - 1) * GAP_X;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = -totalW / 2 + BRICK_W / 2 + c * (BRICK_W + GAP_X);
        const y = WALL_TOP_Y - r * (BRICK_H + GAP_Y);
        this.bricks.push({
          id: r * COLS + c, row: r, col: c, x, y, baseX: x, baseY: y, w: BRICK_W, h: BRICK_H,
          kind: 'empty', star: false, vein: 0, veinKind: null, color: 0, alive: false, uid: 0, hp: 1,
          moveAmp: 0, moveSpeed: 0, movePhase: 0, belt: 0, isSwitch: false, gate: false,
        });
      }
    }
    this.resetBall();
  }

  /**
   * Applique un motif. '.' vide · 'b' brique · '*' brique sur cible ★ · '#' bloc indestructible
   * · 'o' bumper · 'P' / 'Q' portails (2 de chaque lettre sont reliés).
   * Retourne les emplacements à remplir avec des briques du deck.
   */
  setLayout(layout: Layout, extraMove = 0): number[] {
    this.bumpers = [];
    this.portals = [];
    const portalPts: Record<string, { x: number; y: number }[]> = {};
    const slots: number[] = [];
    this.time = 0;
    for (const b of this.bricks) {
      const ch = layout.rows[b.row]?.[b.col] ?? '.';
      b.alive = false;
      b.uid = 0;
      b.star = ch === '*';
      b.vein = 0;
      b.veinKind = null;
      b.isSwitch = ch === 'S';
      b.gate = ch === 'G' || ch === 'g';
      b.belt = layout.belts?.[b.row] ?? 0;
      b.kind = ch === 'b' || ch === '*' ? 'brick' : ch === '#' || b.isSwitch || b.gate ? 'block' : 'empty';
      b.x = b.baseX;
      b.y = b.baseY - this.tide;
      const amp = Math.max(layout.moving?.[b.row] ?? 0, extraMove);
      b.moveAmp = amp;
      b.moveSpeed = 0.9 + (b.row % 3) * 0.25;
      b.movePhase = b.row * 1.7;
      if (b.kind === 'brick') slots.push(b.id);
      if (b.kind === 'block') { b.alive = ch !== 'g'; b.hp = Infinity; }
      if (ch === 'o') this.bumpers.push({ x: b.baseX, y: b.baseY, r: BUMPER_R });
      if (ch === 'P' || ch === 'Q') (portalPts[ch] ??= []).push({ x: b.baseX, y: b.baseY });
    }
    this.gravity = !!layout.gravity;
    this.switchCooldown = 0;
    for (const pts of Object.values(portalPts)) {
      if (pts.length >= 2) this.portals.push({ ax: pts[0].x, ay: pts[0].y, bx: pts[1].x, by: pts[1].y, r: PORTAL_R });
    }
    return slots;
  }

  /** Pose une carte du deck dans un emplacement (ou le vide). */
  setBrick(id: number, card: { uid: number; color: BrickColor; enh: Enh } | null) {
    const b = this.bricks[id];
    if (b.kind === 'block') return;
    if (!card) {
      b.alive = false;
      b.uid = 0;
      return;
    }
    b.kind = 'brick';
    b.alive = true;
    b.uid = card.uid;
    b.color = card.color;
    b.hp = ENH[card.enh].hp ?? 1;
  }

  setTide(v: number) {
    this.tide = Math.min(MAX_TIDE, v);
    for (const b of this.bricks) b.y = b.baseY - this.tide;
  }

  /** Briques destructibles restantes (les blocs ne comptent pas). */
  aliveCount() {
    let n = 0;
    for (const b of this.bricks) if (b.alive && b.kind === 'brick') n++;
    return n;
  }

  resetBall() {
    const b = this.ball;
    this.extras = [];
    this.frenzy = false;
    b.stuck = true;
    b.stuckOffset = 0;
    b.speed = BASE_SPEED;
    b.dx = 0;
    b.dy = 1;
    b.x = this.paddle.x;
    b.y = this.paddle.y + this.paddle.h / 2 + BALL_R;
  }

  /** Lance la balle selon un angle (radians, 0 = vertical) choisi par le joueur. */
  launch(angle: number) {
    const b = this.ball;
    if (!b.stuck) return;
    b.stuck = false;
    b.speed = BASE_SPEED;
    b.pierceLeft = this.ballMods.pierce;
    b.burnLeft = 0;
    this.tiltsThisTrip = 0;
    const a = snapAngle(this, b.x, b.y, clamp(angle, -MAX_LAUNCH_ANGLE, MAX_LAUNCH_ANGLE));
    b.dx = Math.sin(a);
    b.dy = Math.cos(a);
    b.hit = newHit();
    this.events.emit('launched', { x: b.x, y: b.y });
  }

  /** La balle est passée sous la raquette (on peut encore la sauver d'une Secousse). */
  get ballBelowPaddle() {
    const b = this.ball;
    return !b.stuck && b.dy < 0 && b.y < this.paddle.y + this.paddle.h / 2 - 0.1;
  }

  /**
   * Secousse : la balle est poussée vers la raquette (jusqu'à ≈ 25°). Sous la raquette, elle remonte (sauvetage).
   * Une 2e Secousse dans le même trajet fait TILT : la balle est perdue.
   */
  tilt(): TiltKind | null {
    const b = this.ball;
    if (b.stuck) return null;
    this.tiltsThisTrip++;
    if (this.tiltsThisTrip > 1) {
      this.events.emit('tilted', { x: b.x, y: b.y, kind: 'tilt' });
      this.loseBall(true);
      return 'tilt';
    }
    const save = this.ballBelowPaddle;
    if (save) b.dy = Math.max(0.6, Math.abs(b.dy));
    b.dx += clamp((this.paddle.x - b.x) / TILT_REACH, -1, 1) * TILT_PUSH;
    this.fixDirection(b);
    const kind: TiltKind = save ? 'save' : 'nudge';
    this.events.emit('tilted', { x: b.x, y: b.y, kind });
    return kind;
  }

  /**
   * Balle principale perdue : une balle supplémentaire prend la relève (la Main survit),
   * sauf TILT qui fait tout tomber.
   */
  private loseBall(tilt = false) {
    const b = this.ball;
    if (!tilt && this.extras.length) {
      const e = this.extras.shift()!;
      const x = b.x;
      Object.assign(b, { x: e.x, y: e.y, dx: e.dx, dy: e.dy, speed: e.speed, pierceLeft: e.pierceLeft, burnLeft: e.burnLeft, hit: e.hit, portalCd: e.portalCd, stuck: false });
      this.tiltsThisTrip = 0;
      this.events.emit('extraLost', { x });
      this.events.emit('promoted', { x: b.x, y: b.y });
      return;
    }
    this.events.emit('ballLost', { x: b.x });
    this.resetBall();
  }

  /** Multiballe : une balle de plus part de (x, y) dans la direction donnée. */
  spawnExtra(x: number, y: number, dx: number, dy: number, speed = this.ball.speed): boolean {
    if (this.extras.length >= MAX_EXTRAS || this.ball.stuck) return false;
    const l = Math.hypot(dx, dy) || 1;
    const e: Ball = {
      id: this.nextBallId++, x, y, dx: dx / l, dy: dy / l, speed: Math.max(BASE_SPEED, speed), stuck: false, stuckOffset: 0,
      pierceLeft: this.ballMods.pierce, burnLeft: this.frenzy ? 1 : 0, hit: newHit(), portalCd: 0.3,
    };
    this.fixDirection(e);
    this.extras.push(e);
    this.events.emit('split', { x, y });
    return true;
  }

  /** La balle principale se divise : une copie part avec un angle décalé. */
  splitBall(angle = 0.35): boolean {
    const b = this.ball;
    const c = Math.cos(angle), s = Math.sin(angle);
    return this.spawnExtra(b.x, b.y, b.dx * c - b.dy * s, b.dx * s + b.dy * c);
  }

  /** Encaissement : les balles supplémentaires éclatent. Retourne leur nombre. */
  popExtras(): number {
    const n = this.extras.length;
    for (const e of this.extras) this.events.emit('extraPopped', { x: e.x, y: e.y });
    this.extras = [];
    return n;
  }

  /** Toutes les balles en jeu (la principale d'abord). */
  get balls(): Ball[] {
    return this.extras.length ? [this.ball, ...this.extras] : [this.ball];
  }

  /** Déplace une brique vivante vers un emplacement libre (brique Fuyarde). */
  moveBrick(from: number, to: number) {
    const a = this.bricks[from], b = this.bricks[to];
    if (!a.alive || b.alive || b.kind === 'block') return;
    Object.assign(b, { kind: 'brick', alive: true, uid: a.uid, color: a.color, hp: a.hp, vein: a.vein, veinKind: a.veinKind });
    a.alive = false;
    a.uid = 0;
  }

  /** Destruction externe (explosions de Bombe). */
  destroyBrick(id: number, cause: BreakCause = 'explosion') {
    const br = this.bricks[id];
    if (!br?.alive || br.kind !== 'brick') return;
    br.alive = false;
    this.events.emit('brickBroken', {
      brick: br, x: br.x, y: br.y, dx: 0, dy: 0, cause,
      hit: newHit(),
    });
    if (this.aliveCount() === 0) this.events.emit('wallCleared', {});
  }

  /** Rangées mobiles : met à jour les positions (aussi utilisé hors jeu pour l'animation). */
  moveRows(dt: number) {
    this.time += dt;
    for (const b of this.bricks) {
      if (b.belt) { b.x = wrapBelt(b.baseX + b.belt * this.time); continue; }
      if (!b.moveAmp) continue;
      const half = b.w / 2;
      b.x = clamp(b.baseX + b.moveAmp * Math.sin(this.time * b.moveSpeed + b.movePhase), FIELD.left + half, FIELD.right - half);
    }
  }

  /** Brique qui bouge (rangée mobile ou tapis) : sa position dépend du temps. */
  isMoving(b: Brick) {
    return !!(b.moveAmp || b.belt);
  }

  /**
   * Gravité : dans chaque colonne, les briques glissent vers le bas dans les emplacements
   * de briques libres (un bloc arrête la chute). Retourne les déplacements effectués.
   */
  settle(): { from: number; to: number }[] {
    const moves: { from: number; to: number }[] = [];
    for (let c = 0; c < COLS; c++) {
      // Tronçons de colonne séparés par les blocs (les cases vides du motif se traversent)
      const runs: Brick[][] = [[]];
      for (let r = 0; r < ROWS; r++) {
        const b = this.bricks[r * COLS + c];
        if (b.kind === 'block') runs.push([]);
        else if (b.kind === 'brick') runs[runs.length - 1].push(b);
      }
      for (const run of runs) {
        const full = run.filter((b) => b.alive).map((b) => ({ id: b.id, uid: b.uid, color: b.color, hp: b.hp, vein: b.vein, veinKind: b.veinKind }));
        const start = run.length - full.length;
        run.forEach((slot, i) => {
          const src = i >= start ? full[i - start] : null;
          if (src && src.id !== slot.id) moves.push({ from: src.id, to: slot.id });
          slot.alive = !!src;
          slot.uid = src?.uid ?? 0;
          slot.vein = src?.vein ?? 0;
          slot.veinKind = src?.veinKind ?? null;
          if (src) { slot.color = src.color; slot.hp = src.hp; }
        });
      }
    }
    return moves;
  }

  /** Interrupteur : les vannes ouvertes se ferment et inversement (sauf si la balle est dedans). */
  private toggleGates(sw: Brick) {
    if (this.switchCooldown > 0) return;
    this.switchCooldown = 0.3;
    let open = false;
    for (const g of this.bricks) {
      if (!g.gate) continue;
      if (!g.alive && this.balls.some((ball) => Math.abs(ball.x - g.x) < g.w / 2 + BALL_R && Math.abs(ball.y - g.y) < g.h / 2 + BALL_R)) continue;
      g.alive = !g.alive;
      if (!g.alive) open = true;
    }
    this.events.emit('switched', { brick: sw, open });
  }

  /** Position x d'une brique mobile dans `dt` secondes. */
  brickXAt(b: Brick, dt: number) {
    if (b.belt) return wrapBelt(b.baseX + b.belt * (this.time + dt));
    if (!b.moveAmp) return b.x;
    const half = b.w / 2;
    return clamp(b.baseX + b.moveAmp * Math.sin((this.time + dt) * b.moveSpeed + b.movePhase), FIELD.left + half, FIELD.right - half);
  }

  step(dt: number, input: SimInput) {
    this.speedMul = input.speedMul;
    const p = this.paddle;
    const half = p.w / 2;
    const prevX = p.x;
    const target = clamp(input.paddleTargetX, FIELD.left + half, FIELD.right - half);
    p.x = damp(p.x, target, 28, dt);
    p.vx = (p.x - prevX) / dt;
    if (this.twin) {
      const tp = this.twinPaddle;
      tp.w = p.w * 0.8;
      const tx = clamp(-p.x, FIELD.left + tp.w / 2, FIELD.right - tp.w / 2);
      tp.vx = (tx - tp.x) / dt;
      tp.x = tx;
    }
    this.moveRows(dt);
    this.switchCooldown = Math.max(0, this.switchCooldown - dt);
    this.idle = this.ball.stuck ? 0 : this.idle + dt;

    const b = this.ball;
    if (b.stuck) {
      b.stuckOffset = clamp(b.stuckOffset, -half, half);
      b.x = p.x + b.stuckOffset;
      b.y = p.y + p.h / 2 + BALL_R;
      return;
    }
    // Les balles supplémentaires d'abord : la principale peut être attrapée (et les faire éclater)
    for (let i = this.extras.length - 1; i >= 0; i--) {
      const e = this.extras[i];
      if (this.moveBall(e, dt, input, false) === 'lost') {
        this.extras.splice(i, 1);
        this.events.emit('extraLost', { x: e.x });
      }
    }
    if (this.moveBall(b, dt, input, true) === 'lost') this.loseBall();
  }

  /** Avance une balle par sous-pas : on ne bouge jamais de plus d'un demi-rayon (pas de tunneling). */
  private moveBall(b: Ball, dt: number, input: SimInput, primary: boolean): 'ok' | 'stop' | 'lost' {
    b.portalCd = Math.max(0, b.portalCd - dt);
    const speed = b.speed * input.speedMul;
    const dist = speed * dt;
    const n = Math.max(1, Math.ceil(dist / (BALL_R * 0.5)));
    const sd = dist / n;
    for (let i = 0; i < n; i++) {
      b.x += b.dx * sd;
      b.y += b.dy * sd;
      if (this.collideWalls(b)) continue;
      if (this.collidePaddle(b, primary && input.catchArmed, primary)) return 'stop';
      if (this.collideTwin(b)) continue;
      this.collidePortals(b);
      this.collideBumpers(b);
      this.collideBricks(b);
      if (primary && b.y < FIELD.bottom - 1 && this.netLeft > 0 && b.dy < 0) {
        // Relique Filet : la balle rebondit au lieu d'être perdue
        this.netLeft--;
        b.y = 2 * (FIELD.bottom - 1) - b.y;
        b.dy = Math.abs(b.dy);
        this.fixDirection(b);
        this.events.emit('netSaved', { x: b.x, y: FIELD.bottom - 1 });
        continue;
      }
      if (b.y < FIELD.bottom - 1) return 'lost';
    }
    return 'ok';
  }

  private collideWalls(b: Ball): boolean {
    let hit = false;
    if (this.ballMods.wrap && (b.x < FIELD.left - BALL_R || b.x > FIELD.right + BALL_R)) {
      const from = b.x;
      b.x = b.x < 0 ? FIELD.right + BALL_R * 0.9 : FIELD.left - BALL_R * 0.9;
      this.events.emit('wrapped', { fromX: from, toX: b.x, y: b.y });
    } else if (!this.ballMods.wrap) {
      // Réflexion miroir (et non simple replacement) : la trajectoire reste exacte, le guide aussi
      if (b.x - BALL_R < FIELD.left) {
        b.x = 2 * (FIELD.left + BALL_R) - b.x;
        b.dx = Math.abs(b.dx);
        this.events.emit('wallHit', { x: FIELD.left, y: b.y, nx: 1, ny: 0 });
        b.hit.sideBounces++;
        hit = true;
      } else if (b.x + BALL_R > FIELD.right) {
        b.x = 2 * (FIELD.right - BALL_R) - b.x;
        b.dx = -Math.abs(b.dx);
        this.events.emit('wallHit', { x: FIELD.right, y: b.y, nx: -1, ny: 0 });
        b.hit.sideBounces++;
        hit = true;
      }
    }
    if (b.y + BALL_R > FIELD.top) {
      b.y = 2 * (FIELD.top - BALL_R) - b.y;
      b.dy = -Math.abs(b.dy);
      this.events.emit('wallHit', { x: b.x, y: FIELD.top, nx: 0, ny: -1 });
      hit = true;
    }
    if (hit) {
      b.hit.wallBounces++;
      // Anti-blocage : si la balle tourne en rond sans rien toucher, on dévie légèrement sa trajectoire
      if (this.idle > 12) {
        const a = (this.unstick++ % 2 ? 1 : -1) * 0.2;
        const c = Math.cos(a), s = Math.sin(a);
        [b.dx, b.dy] = [b.dx * c - b.dy * s, b.dx * s + b.dy * c];
        this.idle = 8;
      }
      this.fixDirection(b);
    }
    return hit;
  }

  private collidePaddle(b: Ball, catchArmed: boolean, primary: boolean): boolean {
    const p = this.paddle;
    if (b.dy >= 0) return false;
    const top = p.y + p.h / 2;
    if (b.y - BALL_R > top || b.y < p.y) return false;
    const half = p.w / 2;
    if (b.x < p.x - half - BALL_R || b.x > p.x + half + BALL_R) return false;

    // Ramène la balle au point de contact exact (sinon x dérive selon la pénétration du sous-pas
    // et le renvoi ne correspond plus au guide de visée)
    const overlap = top + BALL_R - b.y;
    if (overlap > 0 && b.dy < -1e-6) b.x += b.dx * (overlap / b.dy);
    b.y = top + BALL_R;
    const offset = clamp((b.x - p.x) / (half + BALL_R * 0.5), -1, 1);
    b.hit = newHit();
    this.idle = 0;
    if (primary) this.tiltsThisTrip = 0;
    if (catchArmed) {
      b.stuck = true;
      b.stuckOffset = clamp(b.x - p.x, -half, half);
      this.events.emit('caught', { x: b.x, y: b.y, offset });
      return true;
    }
    const a = primary ? snapAngle(this, b.x, b.y, offset * MAX_BOUNCE_ANGLE) : offset * MAX_BOUNCE_ANGLE;
    b.dx = Math.sin(a);
    b.dy = Math.cos(a);
    if (!this.ballMods.noSpeedGain) b.speed = Math.min(MAX_SPEED, b.speed * SPEED_GAIN);
    this.events.emit('paddleHit', { x: b.x, y: b.y, offset, speed: b.speed, extra: !primary });
    // Après l'événement : la Frénésie peut s'être déclenchée sur ce renvoi
    b.pierceLeft = this.ballMods.pierce;
    b.burnLeft = this.frenzy ? 1 : 0;
    return false;
  }

  /** Raquette jumelle au plafond : renvoie la balle vers le bas selon le point de contact. */
  private collideTwin(b: Ball): boolean {
    if (!this.twin || b.dy <= 0) return false;
    const tp = this.twinPaddle;
    const bottom = tp.y - tp.h / 2;
    if (b.y + BALL_R < bottom || b.y > tp.y) return false;
    const half = tp.w / 2;
    if (b.x < tp.x - half - BALL_R || b.x > tp.x + half + BALL_R) return false;
    b.y = bottom - BALL_R;
    const offset = clamp((b.x - tp.x) / (half + BALL_R * 0.5), -1, 1);
    const a = offset * MAX_BOUNCE_ANGLE;
    b.dx = Math.sin(a);
    b.dy = -Math.cos(a);
    this.fixDirection(b);
    b.hit.wallBounces++;
    this.events.emit('twinHit', { x: b.x, y: b.y });
    return true;
  }

  private collidePortals(b: Ball) {
    if (b.portalCd > 0) return;
    for (const p of this.portals) {
      for (const [fx, fy, tx, ty] of [[p.ax, p.ay, p.bx, p.by], [p.bx, p.by, p.ax, p.ay]]) {
        if (Math.hypot(b.x - fx, b.y - fy) < p.r) {
          b.x = tx + b.dx * (p.r + BALL_R + 0.05);
          b.y = ty + b.dy * (p.r + BALL_R + 0.05);
          b.portalCd = 0.3;
          b.hit.ported = true;
          this.events.emit('portal', { fromX: fx, fromY: fy, toX: tx, toY: ty });
          return;
        }
      }
    }
  }

  private collideBumpers(b: Ball) {
    for (const bp of this.bumpers) {
      const dx = b.x - bp.x, dy = b.y - bp.y;
      const d = Math.hypot(dx, dy);
      if (d >= bp.r + BALL_R || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d;
      const dot = b.dx * nx + b.dy * ny;
      if (dot < 0) {
        b.dx -= 2 * dot * nx;
        b.dy -= 2 * dot * ny;
      }
      b.x = bp.x + nx * (bp.r + BALL_R + 0.01);
      b.y = bp.y + ny * (bp.r + BALL_R + 0.01);
      if (!this.ballMods.noSpeedGain) b.speed = Math.min(MAX_SPEED, b.speed * 1.03);
      this.fixDirection(b);
      b.hit.bumped = true;
      b.hit.wallBounces++;
      b.hit.sideBounces++;
      this.events.emit('bumperHit', { bumper: bp, x: b.x, y: b.y });
      return;
    }
  }

  private collideBricks(b: Ball) {
    let best: Brick | null = null;
    let bestPen = 0, bnx = 0, bny = 0, bcx = 0, bcy = 0;
    for (const br of this.bricks) {
      if (!br.alive) continue;
      const hw = br.w / 2, hh = br.h / 2;
      if (Math.abs(b.x - br.x) > hw + BALL_R || Math.abs(b.y - br.y) > hh + BALL_R) continue;
      const cx = clamp(b.x, br.x - hw, br.x + hw);
      const cy = clamp(b.y, br.y - hh, br.y + hh);
      let nx = b.x - cx, ny = b.y - cy;
      const d = Math.hypot(nx, ny);
      if (d >= BALL_R) continue;
      let pen: number;
      if (d > 1e-6) {
        nx /= d;
        ny /= d;
        pen = BALL_R - d;
      } else {
        const px = hw + BALL_R - Math.abs(b.x - br.x);
        const py = hh + BALL_R - Math.abs(b.y - br.y);
        if (px < py) { nx = Math.sign(b.x - br.x) || 1; ny = 0; pen = px; }
        else { nx = 0; ny = Math.sign(b.y - br.y) || 1; pen = py; }
      }
      if (pen > bestPen) {
        best = br; bestPen = pen; bnx = nx; bny = ny; bcx = cx; bcy = cy;
      }
    }
    if (!best) return;

    // Balle Lourde / Frénésie : traverse sans rebondir (sauf sur une brique blindée intacte et les blocs)
    const through = best.kind === 'brick' && best.hp <= 1;
    const pierce = through && b.pierceLeft > 0;
    const burn = through && !pierce && b.burnLeft > 0;
    if (burn) b.burnLeft--;
    else if (!pierce) {
      const dot = b.dx * bnx + b.dy * bny;
      if (dot < 0) {
        b.dx -= 2 * dot * bnx;
        b.dy -= 2 * dot * bny;
      }
      b.x += bnx * bestPen;
      b.y += bny * bestPen;
      this.fixDirection(b);
    } else {
      b.pierceLeft--;
    }

    if (best.kind === 'block') {
      b.hit.wallBounces++;
      this.events.emit('blockHit', { brick: best, x: bcx, y: bcy });
      if (best.isSwitch) this.toggleGates(best);
      return;
    }
    if (best.hp > 1) {
      best.hp--;
      this.events.emit('brickDamaged', { brick: best, x: bcx, y: bcy });
      return;
    }
    best.alive = false;
    this.idle = 0;
    const hit: HitInfo = { ...b.hit, fromAbove: bny > 0.5 };
    b.hit = newHit();
    this.events.emit('brickBroken', { brick: best, x: bcx, y: bcy, dx: b.dx, dy: b.dy, cause: pierce ? 'pierce' : 'ball', hit });
    if (this.aliveCount() === 0) this.events.emit('wallCleared', {});
  }

  /** Normalise et empêche les trajectoires quasi horizontales (boucles infinies). */
  private fixDirection(b: Ball) {
    if (Math.abs(b.dy) < MIN_DY) {
      b.dy = (b.dy >= 0 ? 1 : -1) * MIN_DY;
      b.dx = Math.sign(b.dx || 1) * Math.sqrt(1 - MIN_DY * MIN_DY);
    }
    const l = Math.hypot(b.dx, b.dy);
    b.dx /= l;
    b.dy /= l;
  }
}

export interface Prediction {
  pts: { x: number; y: number }[];
  /** Brique atteinte en fin de trajectoire, -1 sinon. */
  brick: number;
  /** x où la balle atteint la hauteur `stopY` (descente vers la raquette), null sinon. */
  landX: number | null;
}

/** Entrée d'un rayon dans une boîte (demi-tailles hx, hy) : t et axe de la face d'entrée. */
function slabEntry(x: number, y: number, dx: number, dy: number, cx: number, cy: number, hx: number, hy: number) {
  let tx0 = -Infinity, tx1 = Infinity, ty0 = -Infinity, ty1 = Infinity;
  if (Math.abs(dx) < 1e-9) { if (x < cx - hx || x > cx + hx) return null; }
  else { tx0 = (cx - hx - x) / dx; tx1 = (cx + hx - x) / dx; if (tx0 > tx1) [tx0, tx1] = [tx1, tx0]; }
  if (Math.abs(dy) < 1e-9) { if (y < cy - hy || y > cy + hy) return null; }
  else { ty0 = (cy - hy - y) / dy; ty1 = (cy + hy - y) / dy; if (ty0 > ty1) [ty0, ty1] = [ty1, ty0]; }
  const t0 = Math.max(tx0, ty0);
  if (t0 > Math.min(tx1, ty1) || t0 <= 0.02) return null;
  return { t: t0, axis: tx0 > ty0 ? 'x' : 'y' };
}

/**
 * Intersection exacte rayon / rectangle à coins arrondis (somme de Minkowski d'une brique
 * et du rayon de la balle) : c'est exactement la zone où la balle touche la brique.
 */
function rayRoundRect(x: number, y: number, dx: number, dy: number, cx: number, cy: number, hw: number, hh: number, R: number) {
  let best: { t: number; nx: number; ny: number } | null = null;
  const a = slabEntry(x, y, dx, dy, cx, cy, hw + R, hh);
  if (a && a.axis === 'x') best = { t: a.t, nx: Math.sign(x + dx * a.t - cx), ny: 0 };
  const b = slabEntry(x, y, dx, dy, cx, cy, hw, hh + R);
  if (b && b.axis === 'y' && (!best || b.t < best.t)) best = { t: b.t, nx: 0, ny: Math.sign(y + dy * b.t - cy) };
  for (const [kx, ky] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const px = cx + kx * hw, py = cy + ky * hh;
    const t = rayCircle(x, y, dx, dy, px, py, R);
    if (t === Infinity || (best && t >= best.t)) continue;
    const hx = x + dx * t, hy = y + dy * t;
    if ((hx - px) * kx < 0 || (hy - py) * ky < 0) continue; // pas dans le quadrant du coin
    best = { t, nx: (hx - px) / R, ny: (hy - py) / R };
  }
  return best;
}

/** Intersection rayon / cercle (premier t > eps), Infinity sinon. */
function rayCircle(x: number, y: number, dx: number, dy: number, cx: number, cy: number, r: number) {
  const ox = x - cx, oy = y - cy;
  const b = ox * dx + oy * dy;
  const c = ox * ox + oy * oy - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 0.02 ? t : Infinity;
}

/**
 * Lancer de rayon (cercle balayé ≈ rayon contre formes élargies) avec rebonds sur murs,
 * blocs et bumpers, et passage par les portails. Sert au guide de visée.
 */
export function predictPath(w: World, x: number, y: number, dx: number, dy: number, maxBounces: number, stopY: number | null): Prediction {
  const pts = [{ x, y }];
  const R = BALL_R;
  const speed = Math.max(1, (w.ball.stuck ? BASE_SPEED : w.ball.speed) * w.speedMul);
  let traveled = 0;
  for (let bounce = 0; bounce <= maxBounces + 1; bounce++) {
    let tMin = 60;
    let kind: 'none' | 'wallX' | 'wrapX' | 'wallY' | 'brick' | 'block' | 'bumper' | 'portal' | 'stop' | 'twin' = 'none';
    let hit = -1;
    let nx = 0, ny = 0, tpx = 0, tpy = 0;
    if (!w.ballMods.wrap) {
      if (dx < -1e-6) { const t = (FIELD.left + R - x) / dx; if (t >= 0 && t < tMin) { tMin = t; kind = 'wallX'; } }
      if (dx > 1e-6) { const t = (FIELD.right - R - x) / dx; if (t >= 0 && t < tMin) { tMin = t; kind = 'wallX'; } }
    } else {
      // Balle Fantôme : elle sort d'un côté et réapparaît de l'autre (même seuil que collideWalls)
      if (dx < -1e-6) { const t = (FIELD.left - R - x) / dx; if (t >= 0 && t < tMin) { tMin = t; kind = 'wrapX'; } }
      if (dx > 1e-6) { const t = (FIELD.right + R - x) / dx; if (t >= 0 && t < tMin) { tMin = t; kind = 'wrapX'; } }
    }
    if (dy > 1e-6) { const t = (FIELD.top - R - y) / dy; if (t >= 0 && t < tMin) { tMin = t; kind = 'wallY'; } }
    if (w.twin && dy > 1e-6) {
      const tp = w.twinPaddle;
      const t = (tp.y - tp.h / 2 - R - y) / dy;
      if (t > 0.02 && t < tMin && Math.abs(x + dx * t - tp.x) <= tp.w / 2 + R) { tMin = t; kind = 'twin'; }
    }
    if (dy < -1e-6 && stopY !== null) { const t = (stopY - y) / dy; if (t >= 0 && t < tMin) { tMin = t; kind = 'stop'; } }
    for (const br of w.bricks) {
      if (!br.alive) continue;
      // Rangées mobiles : on vise la position qu'aura la brique quand la balle y arrivera
      let bx = br.x;
      if (w.isMoving(br)) {
        const tReach = Math.abs(dy) > 1e-6 ? Math.max(0, (br.y - y) / dy) : 0;
        bx = w.brickXAt(br, (traveled + tReach) / speed);
        const h0 = rayRoundRect(x, y, dx, dy, bx, br.y, br.w / 2, br.h / 2, R);
        if (h0) bx = w.brickXAt(br, (traveled + h0.t) / speed);
      }
      const h = rayRoundRect(x, y, dx, dy, bx, br.y, br.w / 2, br.h / 2, R);
      if (h && h.t < tMin) {
        tMin = h.t;
        hit = br.id;
        kind = br.kind === 'block' ? 'block' : 'brick';
        nx = h.nx;
        ny = h.ny;
      }
    }
    for (const bp of w.bumpers) {
      const t = rayCircle(x, y, dx, dy, bp.x, bp.y, bp.r + R);
      if (t < tMin) {
        tMin = t; kind = 'bumper';
        const hx = x + dx * t, hy = y + dy * t;
        const d = Math.hypot(hx - bp.x, hy - bp.y) || 1;
        nx = (hx - bp.x) / d; ny = (hy - bp.y) / d;
      }
    }
    for (const p of w.portals) {
      for (const [fx, fy, ex, ey] of [[p.ax, p.ay, p.bx, p.by], [p.bx, p.by, p.ax, p.ay]]) {
        const t = rayCircle(x, y, dx, dy, fx, fy, p.r);
        if (t < tMin) { tMin = t; kind = 'portal'; tpx = ex; tpy = ey; }
      }
    }
    x += dx * tMin;
    y += dy * tMin;
    traveled += tMin;
    pts.push({ x, y });
    if (kind === 'brick') return { pts, brick: hit, landX: null };
    if (kind === 'stop') return { pts, brick: -1, landX: x };
    if (kind === 'none') break;
    if (kind === 'wallX') dx = -dx;
    else if (kind === 'wrapX') {
      x = dx < 0 ? FIELD.right + R * 0.9 : FIELD.left - R * 0.9;
      pts.push({ x: NaN, y: NaN }, { x, y });
    }
    else if (kind === 'wallY') dy = -dy;
    else if (kind === 'twin') {
      const tp = w.twinPaddle;
      const a = clamp((x - tp.x) / (tp.w / 2 + R * 0.5), -1, 1) * MAX_BOUNCE_ANGLE;
      dx = Math.sin(a);
      dy = -Math.cos(a);
    }
    else if (kind === 'bumper' || kind === 'block') {
      const dot = dx * nx + dy * ny;
      dx -= 2 * dot * nx;
      dy -= 2 * dot * ny;
    } else if (kind === 'portal') {
      // Saut : on coupe le tracé et on repart de la sortie
      x = tpx + dx * (PORTAL_R + R + 0.05);
      y = tpy + dy * (PORTAL_R + R + 0.05);
      pts.push({ x: NaN, y: NaN }, { x, y });
    }
  }
  return { pts, brick: -1, landX: null };
}

/** Direction de sortie après un rebond sur la raquette à l'abscisse x. */
export function bounceDir(w: World, x: number): { dx: number; dy: number; offset: number } {
  const p = w.paddle;
  const offset = clamp((x - p.x) / (p.w / 2 + BALL_R * 0.5), -1, 1);
  const a = snapAngle(w, x, p.y + p.h / 2 + BALL_R, offset * MAX_BOUNCE_ANGLE);
  return { dx: Math.sin(a), dy: Math.cos(a), offset };
}

/** Position de raquette qui renvoie la balle (contact en landX) selon l'angle voulu. */
export function paddleXForAngle(w: World, landX: number, angle: number): number {
  const half = w.paddle.w / 2;
  const offset = clamp(angle / MAX_BOUNCE_ANGLE, -0.98, 0.98);
  return clamp(landX - offset * (half + BALL_R * 0.5), FIELD.left + half, FIELD.right - half);
}

/** Angle naturel de renvoi pour une raquette en px et un contact en landX. */
export function angleForPaddleX(w: World, landX: number, px: number): number {
  const offset = clamp((landX - px) / (w.paddle.w / 2 + BALL_R * 0.5), -1, 1);
  return offset * MAX_BOUNCE_ANGLE;
}

export { MAX_BOUNCE_ANGLE };

/**
 * Visée assistée : si un tir direct vers une brique aimantée est à moins de `aimAssist`
 * de l'angle naturel, la balle part vers son centre. Le guide l'affiche (même fonction).
 */
export function snapAngle(w: World, x: number, y: number, a: number): number {
  if (!w.snapSlots.size || w.aimAssist <= 0) return a;
  let best = a;
  let bestD = w.aimAssist;
  for (const id of w.snapSlots) {
    const br = w.bricks[id];
    if (!br?.alive || br.kind !== 'brick') continue;
    const tx = w.isMoving(br) ? w.brickXAt(br, Math.hypot(br.x - x, br.y - y) / Math.max(1, w.ball.speed * w.speedMul)) : br.x;
    const t = Math.atan2(tx - x, br.y - y);
    const d = Math.abs(t - a);
    if (d >= bestD) continue;
    if (predictPath(w, x, y, Math.sin(t), Math.cos(t), 0, null).brick !== id) continue;
    best = t;
    bestD = d;
  }
  return best;
}
