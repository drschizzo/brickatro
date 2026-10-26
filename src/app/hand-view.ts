import { clamp, fmt } from '../core/math';
import { BRICK_COLORS } from '../render/palette';
import { figureDesc, figureIndex } from '../rules/figures';
import { PROWESS } from '../rules/prowess';
import { activeBoss } from '../rules/run';
import { frenzyStreak, seriesMult, type ScoreResult } from '../rules/scoring';
import { FIELD } from '../sim/world';
import type { GameCtx } from './context';
import { FX } from './view';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * La Main à l'écran : aperçu live (Figure, Jetons × Mult, Prouesses, briques utiles)
 * et séquence d'encaissement où chaque étape du scoring est rejouée et "sentie".
 */
export class HandView {
  /** Part de l'objectif restant que la Main couvrirait (0-1) : fait chauffer la scène. */
  heat = 0;
  /** Briques du mur qui feraient monter la Main (surbrillance). */
  useful = new Set<number>();
  private lastFigureIdx = -1;
  private scoringStart = 0;

  constructor(private readonly g: GameCtx) {}

  /** Nouveau Lancer : la prochaine Figure atteinte sera annoncée. */
  newLancer() {
    this.lastFigureIdx = -1;
  }

  /** Aperçu live du Pot + annonce quand la Figure monte en gamme. */
  refresh(fromBrick = false) {
    const { g } = this;
    const { engine, hud, world } = g;
    const run = engine.run;
    if (!run) return;
    const hand = engine.hand;
    const live = engine.pot;
    // Aperçu : les balles en l'air compteraient si on encaissait maintenant
    if (g.phase === 'play') live.airBalls = world.extras.length;
    // v3 : la Main affichée inclut la meilleure brique du trajet en cours (ce qu'on encaisserait maintenant)
    const pot = hand.previewPot();
    const lead = pot !== live ? hand.tripLead() : null;
    const res = hand.score(null, false, 1, pot);
    const idx = figureIndex(res.figure);
    const upgraded = fromBrick && idx > this.lastFigureIdx && idx >= 1;
    this.lastFigureIdx = idx;
    if (upgraded && res.figure) {
      const v = g.view;
      const b = world.ball;
      v.stage.ripple3D(b.x, b.y, 0.5);
      v.stage.punch(0.025 + idx * 0.006);
      v.sparks.burst(b.x, b.y, FX.GOLD, 24, 1.1);
      hud.banner(res.figure.name.toUpperCase() + ' !', figureDesc(res.figure, run.rules.shortFigures), '#fe5f55');
      g.sfx.figure(idx);
      v.stage.shake.add(0.3);
      v.stage.kick(0.5);
      g.hitstop = Math.max(g.hitstop, 0.1);
    }
    const wall = engine.wall;
    this.heat = clamp(res.total / Math.max(1, wall.target - wall.score), 0, 1);
    hud.setPot(res.figure?.name ?? null, res.level, res.chips, res.mult, res.total, this.heat, upgraded);
    hud.setFigures(res.figure?.id ?? null, run.levels, hand.played);
    hud.setProwess(res.prowess.map((p) => `${PROWESS[p.id].glyph} ${PROWESS[p.id].name}${p.count > 1 ? ' ×' + p.count : ''}`),
      { streak: live.streak, mult: seriesMult(live.streak, run.relics) },
      { frenzy: live.frenzy, air: world.extras.length, toFrenzy: frenzyStreak(run.relics) - live.streak });
    hud.setHand(pot.bricks, pot.size, res.scoringUids, lead?.pb.uid ?? null);
    hud.setShards(run.rules.headRule ? pot.shards : 0, pot.shardChips, hand.tripCount);
    // Outs : quelles briques du mur feraient monter la Main
    const fog = !!activeBoss(run)?.fog;
    const outs = hand.outs();
    this.useful = fog ? new Set() : outs.useful;
    hud.setOuts(outs.targets.map((t) => ({ figure: t.figure.name, need: t.need })), pot.empty, fog, res.blocked, engine.orders, run.rules.headRule && run.rules.headMode === 'best');
  }

  /** La séquence d'encaissement. `then` : suite de la partie (sauf si le run a été quitté entre-temps). */
  async cashIn(res: ScoreResult, x: number, then: () => void) {
    const { g } = this;
    const { hud, sfx, engine } = g;
    const v = g.view;
    const gen = g.gen;
    g.setPhase('scoring');
    this.scoringStart = performance.now();
    g.updateHint();
    hud.potState('scoring');
    hud.setPot(res.figure?.name ?? null, res.level, 0, 0, 0, this.heat);
    await this.quick(250);
    if (gen !== g.gen) return;
    const anchor = hud.anchor('pot');
    for (let i = 0; i < res.steps.length; i++) {
      const s = res.steps[i];
      const kind = s.money ? 'money' : s.xmult !== undefined ? 'xmult' : s.mult && !s.chips ? 'mult' : 'chips';
      if (kind === 'money') sfx.coin();
      else sfx.step(i, kind);
      hud.setPot(res.figure?.name ?? null, res.level, s.chipsAfter, s.multAfter, Math.floor(s.chipsAfter * s.multAfter), this.heat);
      if (s.chips) hud.tickChips();
      if (s.mult || s.xmult !== undefined) hud.tickMult();
      if (s.source.kind === 'relic') {
        hud.triggerRelic(s.source.index, s.label, kind);
      } else if (kind === 'money') {
        const m = hud.anchor('money');
        hud.popup(m.x, m.y, s.label, 'money');
      } else if (s.source.kind === 'brick') {
        const h = hud.handAnchor();
        hud.popup(h.x + v.fxRng.range(-60, 60), h.y, s.label, kind);
      } else {
        hud.popup(anchor.x + v.fxRng.range(-50, 50), anchor.y, s.label, kind);
      }
      v.stage.shake.add(kind === 'xmult' ? 0.25 : 0.06);
      if (kind === 'xmult') v.stage.kick(0.35);
      const c = s.source.kind === 'brick' && s.source.color >= 0 ? BRICK_COLORS[s.source.color] : kind === 'chips' ? FX.CHIPS : kind === 'money' ? FX.GOLD : FX.MULT;
      v.particles.burst(x + v.fxRng.range(-1, 1), FIELD.paddleY + 0.6, c, 6, 0.6, 0, 1);
      // Le rythme accélère : plus il y a d'étapes, plus ça s'emballe
      await this.quick(Math.max(70, 360 - i * 40));
      if (gen !== g.gen) return;
    }
    await this.quick(200);
    if (gen !== g.gen) return;

    const total = res.total;
    const wall = engine.wall;
    if (res.blocked) hud.banner('ANNULÉ', res.blocked, '#ff3d5a');
    // Un seul encaissement brise tout le mur : le score s'embrase
    const onFire = !res.blocked && total >= wall.target;
    const { destroyed } = engine.commitCashIn(res);
    g.progress.handScored(total);
    const power = clamp(total / wall.target, 0.15, 1);
    sfx.cashIn(power);
    g.hitstop = 0.12;
    this.cashInBurst(x, power);
    if (onFire) {
      hud.banner(`+${fmt(total)}`, `🔥 En feu ! ${res.figure?.name ?? ''}`, '#ff7a1f');
      hud.scoreFlames();
      v.stage.shake.add(0.5);
      for (let i = 0; i < 5; i++) {
        setTimeout(() => v.particles.burst(v.fxRng.range(-7, 7), v.fxRng.range(-8, 2), FX.MULT, 30, 1.5, 0, 1.4), i * 90);
      }
    } else if (!res.blocked) hud.banner(`+${fmt(total)}`, res.figure?.name ?? '', '#ffc53d');
    hud.setScore(wall.score, wall.target);
    if (destroyed) {
      sfx.glass();
      hud.popup(anchor.x, anchor.y + 40, `${destroyed} Verre${destroyed > 1 ? 's' : ''} brisé${destroyed > 1 ? 's' : ''} !`, 'dim');
    }
    g.refreshHud();
    await this.quick(750);
    if (gen !== g.gen) return;
    hud.potState('idle');
    then();
  }

  /** L'explosion dorée de l'encaissement, proportionnelle à la part de l'objectif marquée. */
  private cashInBurst(x: number, power: number) {
    const v = this.g.view;
    const stage = v.stage;
    stage.shake.add(0.3 + power * 0.6);
    stage.kick(0.5 + power);
    v.rings.spawn(x, FIELD.paddleY, FX.GOLD, 6 + power * 10, 0.7);
    stage.ripple3D(x, FIELD.paddleY, 0.6 + power * 0.8);
    stage.punch(0.02 + power * 0.06);
    v.beams.spawn(x, FIELD.paddleY, FX.GOLD, power, stage.camera);
    // Comètes dorées qui filent vers le compteur de score
    const sr = document.getElementById('score')!.getBoundingClientRect();
    const target = stage.screenToWorld(sr.left + sr.width / 2, sr.top + sr.height / 2);
    v.comets.launch({ x, y: FIELD.paddleY + 0.5 }, target, FX.GOLD, Math.round(10 + power * 30));
    stage.whiteFlash(power * 0.5);
    stage.lightFlash(x, FIELD.paddleY + 1, FX.GOLD, 30 + power * 40, 0.8);
    v.sparks.burst(x, FIELD.paddleY + 0.5, FX.GOLD, Math.round(20 + power * 50), 1.2, 0, 1);
    v.particles.burst(x, FIELD.paddleY + 0.5, FX.GOLD, Math.round(30 + power * 80), 1 + power, 0, 1.2);
  }

  /** Attente de la séquence d'encaissement : maintenir le clic l'accélère (×4). */
  private quick(ms: number) {
    // Un nouvel appui seulement : le clic maintenu pour attraper la balle ne compte pas
    const input = this.g.input;
    const fast = input.held && input.holdStart > this.scoringStart;
    return wait(fast ? ms / 4 : ms);
  }
}
