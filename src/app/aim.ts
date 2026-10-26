import * as THREE from 'three';
import { clamp } from '../core/math';
import type { GuidePath } from '../render/aim';
import {
  angleForPaddleX, BALL_R, bounceDir, FIELD, FOCUS_DIST, MAX_BOUNCE_ANGLE, MAX_LAUNCH_ANGLE, paddleXForAngle, predictPath, snapAngle, type World,
} from '../sim/world';
import type { GameCtx } from './context';

/** Ralenti à l'approche de la raquette (facteur de temps). */
const FOCUS_SCALE = 0.25;
/** Ralenti de la dernière chance (balle sous la raquette, Secousse disponible). */
const LAST_CHANCE_SCALE = 0.3;
/** Marge (au-delà de la raquette) pour verrouiller la raquette sous la balle à l'entrée du ralenti. */
const LOCK_REACH = 1.2;
/** Sensibilité de la visée du renvoi : radians par pixel de souris / doigt. */
const AIM_GAIN = (0.25 * Math.PI) / 180;
const AIM_GOLD = new THREE.Color('#ffd76a').multiplyScalar(1.6);
const AIM_DIM = new THREE.Color('#9fb4ff').multiplyScalar(0.8);

/**
 * La visée : angle du lancer, déplacement de la raquette, verrouillage sous la balle pour orienter le renvoi,
 * ralenti à l'approche de la raquette et guide doré.
 */
export class AimController {
  /** Angle visé au lancer. */
  angle = 0;
  /** Maintenir = viser (la raquette se fige), relâcher = lancer. */
  aiming = false;
  /** Visée du renvoi : raquette verrouillée sous la balle, le joueur oriente l'angle. */
  lock: { landX: number; angle: number } | null = null;
  /** Brique au bout du guide doré (-1 = aucune). */
  aimedBrick = -1;
  /** Facteur de temps (ralentis). */
  timeScale = 1;
  /** Position visée par la raquette. */
  paddleTarget = 0;
  private lockTried = false;
  private lockMouseX: number | null = null;
  /** Point d'impact prévu sur la raquette et distance à parcourir pour l'atteindre (balle descendante). */
  private landing: { x: number; dist: number } | null = null;
  /** Balle passée sous la raquette avec une Secousse en poche : ralenti de la dernière chance. */
  private lastChance = false;
  private launchTime = 0;
  private wasArmed = false;

  constructor(private readonly g: GameCtx) {}

  /** Bouton maintenu pendant le jeu après le lancer : attraper la balle. */
  get armed() {
    const { g } = this;
    return g.phase === 'play' && g.input.held && g.input.holdStart > this.launchTime;
  }

  launched() {
    this.launchTime = performance.now() + 1;
  }

  /** Une Secousse (ou l'abandon) fait perdre le verrouillage. */
  unlock() {
    this.lock = null;
    this.lockTried = false;
    this.lastChance = false;
  }

  /** Une image : raquette, verrouillage, ralenti, guide. `mirror` : contrôles inversés (Boss Le Miroir). */
  update(dt: number, mirror: number, fog: boolean) {
    const { g } = this;
    const { input, world } = g;
    const stage = g.view.stage;
    this.landing = this.predictLanding();

    // Visée du lancer (raquette figée) ou déplacement de la raquette
    const half = world.paddle.w / 2;
    if (g.phase === 'aim' && this.aiming && input.held) {
      const b = world.ball;
      if (input.mouseX !== null && !input.touch) {
        const p = stage.screenToWorld(input.mouseX, input.mouseY);
        if (p.y > b.y + 0.5) this.angle = Math.atan2(p.x - b.x, p.y - b.y);
      }
      this.angle += input.consumeBtnDrag() * 0.012 + input.keyDir * 1.6 * dt;
      this.angle = clamp(this.angle, -MAX_LAUNCH_ANGLE, MAX_LAUNCH_ANGLE);
      input.consumeDrag();
    } else if (this.updateLock(dt, mirror)) {
      // Raquette verrouillée : elle se place seule pour produire l'angle visé
      this.paddleTarget = paddleXForAngle(world, this.lock!.landX, this.lock!.angle);
    } else {
      if (input.mouseX !== null && !input.touch) {
        this.paddleTarget = mirror * stage.screenToWorldX(input.mouseX, input.mouseY);
      }
      this.paddleTarget += mirror * input.consumeDrag() * stage.worldPerPixel * 1.4;
      this.paddleTarget += mirror * input.keyDir * 24 * dt;
    }
    this.paddleTarget = clamp(this.paddleTarget, FIELD.left + half, FIELD.right - half);

    const armed = this.armed;
    if (armed && !this.wasArmed) g.view.paddle.hit(0.4);
    this.wasArmed = armed;

    // Focus : la balle ralentit quand elle approche de la raquette, pour viser le renvoi
    const ball = world.ball;
    const focus = g.phase === 'play' && !!this.landing && this.landing.dist < FOCUS_DIST && ball.y > FIELD.paddleY - 0.5;
    // Dernière chance : la balle a passé la raquette, une Secousse peut encore la sauver
    const chance = g.phase === 'play' && world.ballBelowPaddle && g.engine.wall.secoussesLeft > 0 && world.tiltsThisTrip === 0;
    if (chance && !this.lastChance) {
      g.sfx.armed();
      g.view.popup(ball.x, FIELD.paddleY - 0.5, 'SECOUSSE !', 'prow');
    }
    this.lastChance = chance;
    // Plus la Série monte, plus le ralenti est court : le rythme s'emballe
    const focusScale = FOCUS_SCALE + Math.min(0.2, g.engine.pot.streak * 0.03);
    const scale = chance ? LAST_CHANCE_SCALE : focus ? focusScale : 1;
    this.timeScale += (scale - this.timeScale) * Math.min(1, dt * (chance ? 30 : 12));
    this.updateGuide(fog);
  }

  /**
   * Au lancement : trajectoire selon l'angle visé.
   * En jeu, quand la balle redescend : point d'impact sur la raquette + trajectoire du renvoi
   * selon la position actuelle de la raquette. La brique visée s'allume.
   */
  private updateGuide(fog: boolean) {
    const { g } = this;
    const w = g.world;
    const b = w.ball;
    const paths: GuidePath[] = [];
    let marker: { x: number; y: number; ok: boolean } | null = null;
    this.aimedBrick = -1;
    const top = w.paddle.y + w.paddle.h / 2 + BALL_R;
    if (g.phase === 'aim' && b.stuck) {
      const sa = snapAngle(w, b.x, b.y, this.angle);
      const pr = predictPath(w, b.x, b.y, Math.sin(sa), Math.cos(sa), 2, null);
      paths.push({ pts: pr.pts, color: this.aiming ? AIM_GOLD : AIM_DIM, size: this.aiming ? 1.1 : 0.7 });
      this.aimedBrick = pr.brick;
    } else if (g.phase === 'play' && !b.stuck && b.dy < 0) {
      const incoming = predictPath(w, b.x, b.y, b.dx, b.dy, 4, top);
      paths.push({ pts: incoming.pts, color: AIM_DIM, size: 0.55 });
      if (incoming.landX !== null) {
        const half = w.paddle.w / 2 + BALL_R;
        const ok = Math.abs(incoming.landX - w.paddle.x) <= half;
        marker = { x: incoming.landX, y: w.paddle.y + w.paddle.h / 2 + 0.05, ok };
        if (ok && !this.armed) {
          const d = bounceDir(w, incoming.landX);
          const out = predictPath(w, incoming.landX, top, d.dx, d.dy, 2, null);
          paths.push({ pts: out.pts, color: AIM_GOLD, size: 1 });
          this.aimedBrick = out.brick;
        }
      }
    }
    if (fog || (this.aimedBrick >= 0 && w.bricks[this.aimedBrick].kind !== 'brick')) this.aimedBrick = -1;
    g.view.aim.set(paths, marker);
  }

  /**
   * Quand la balle entre dans la zone de ralenti, si la raquette est assez proche du point d'impact,
   * elle se verrouille dessous : le mouvement du joueur oriente alors finement le renvoi.
   * Retourne true si la raquette est verrouillée.
   */
  private updateLock(dt: number, mirror: number): boolean {
    const { g } = this;
    const { input } = g;
    const w = g.world;
    const b = w.ball;
    const descending = g.phase === 'play' && !b.stuck && b.dy < 0;
    if (!descending) {
      this.lock = null;
      this.lockTried = false;
      return false;
    }
    const land = this.landing;
    if (!this.lock && !this.lockTried && land && land.dist < FOCUS_DIST) {
      this.lockTried = true;
      if (Math.abs(w.paddle.x - land.x) <= w.paddle.w / 2 + BALL_R + LOCK_REACH) {
        const natural = angleForPaddleX(w, land.x, clampPaddle(w, w.paddle.x));
        this.lock = { landX: land.x, angle: natural };
        this.lockMouseX = input.mouseX;
        input.consumeDrag();
        g.sfx.armed();
      }
    }
    if (!this.lock) return false;
    let d = input.consumeDrag();
    if (!input.touch && input.mouseX !== null) {
      if (this.lockMouseX !== null) d += input.mouseX - this.lockMouseX;
      this.lockMouseX = input.mouseX;
    }
    // La raquette suit le mouvement (en plus fin) : vers la droite, elle se décale à droite
    // et la balle, touchée plus à gauche sur la raquette, part plus à gauche — comme sans verrouillage.
    this.lock.angle -= mirror * (d * AIM_GAIN + input.keyDir * 0.9 * dt);
    this.lock.angle = clamp(this.lock.angle, -MAX_BOUNCE_ANGLE * 0.98, MAX_BOUNCE_ANGLE * 0.98);
    return true;
  }

  /** Où et dans combien de distance la balle (descendante) atteindra la raquette ; null si une brique s'interpose. */
  private predictLanding(): { x: number; dist: number } | null {
    const { g } = this;
    const w = g.world;
    const b = w.ball;
    if (g.phase !== 'play' || b.stuck || b.dy >= 0) return null;
    const top = w.paddle.y + w.paddle.h / 2 + BALL_R;
    const inc = predictPath(w, b.x, b.y, b.dx, b.dy, 5, top);
    if (inc.landX === null) return null;
    let dist = 0;
    for (let i = 1; i < inc.pts.length; i++) {
      const p = inc.pts[i - 1], q = inc.pts[i];
      if (!Number.isNaN(p.x) && !Number.isNaN(q.x)) dist += Math.hypot(q.x - p.x, q.y - p.y);
    }
    return { x: inc.landX, dist };
  }
}

function clampPaddle(w: World, x: number) {
  const half = w.paddle.w / 2;
  return clamp(x, FIELD.left + half, FIELD.right - half);
}
