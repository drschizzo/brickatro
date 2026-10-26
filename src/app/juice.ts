import { BRICK_COLORS } from '../render/palette';
import { seriesMult } from '../rules/scoring';
import { FIELD } from '../sim/world';
import type { GameCtx } from './context';
import { FX } from './view';

/**
 * Le "juice" : chaque évènement de la simulation et du moteur se voit et s'entend
 * (particules, anneaux, secousses, sons, textes flottants). Aucune règle ici.
 */
export function bindJuice(g: GameCtx, card: (uid: number) => { enh: string } | undefined) {
  const v = g.view;
  const ev = g.world.events;
  const en = g.engine.events;

  ev.on('launched', ({ x, y }) => {
    g.sfx.launch();
    v.rings.spawn(x, y, FX.WHITE, 1.5);
  });

  ev.on('brickBroken', ({ brick, dx, dy, cause }) => {
    const col = BRICK_COLORS[brick.color];
    v.particles.burst(brick.x, brick.y, col, cause === 'explosion' ? 20 : 14, cause === 'explosion' ? 1.4 : 1, dx * 0.3, dy * 0.3);
    v.sparks.burst(brick.x, brick.y, col, 12, 1, dx * 0.4, dy * 0.4);
    v.stage.lightFlash(brick.x, brick.y, col, 16, 0.3);
    v.rings.spawn(brick.x, brick.y, col, 1.6, 0.3);
    v.bricks.shockwave(brick.x, brick.y, 3);
  });

  en.on('tripCard', ({ x, y, color }) => {
    // Mode v3 : au renvoi, la meilleure brique du trajet entre dans la Main (traînée depuis son emplacement)
    const a = g.hud.handAnchor();
    const to = v.stage.screenToWorld(a.x, a.y + 20);
    v.comets.launch({ x, y }, to, BRICK_COLORS[color], 6);
    v.rings.spawn(x, y, BRICK_COLORS[color], 1.4, 0.3);
    g.sfx.figure(2);
    g.refreshPot(true);
  });

  en.on('brick', ({ brick, card, eclipsed, out, tags, shard, money, bomb, cause }) => {
    // v3 : une brique touchée par la balle est candidate à la Main (choisie au renvoi), on montre sa valeur
    const candidate = shard && g.engine.run?.rules.headMode === 'best' && (cause === 'ball' || cause === 'pierce');
    const lead = candidate && g.engine.hand.tripLead()?.pb.uid === card.uid;
    if (shard && !lead) {
      // Éclat : seulement des Jetons (une candidate battue par une meilleure brique du trajet aussi)
      g.sfx.brick(g.engine.pot.broken);
      v.popup(brick.x, brick.y, `éclat +${g.engine.hand.shardChips(card)}`, 'dim');
    } else if (lead) {
      // Meilleure brique du trajet pour l'instant : elle entrera dans la Main au renvoi
      g.sfx.brick(g.engine.pot.broken);
      v.popup(brick.x, brick.y, `${card.enh === 'pierre' ? '◆' : card.enh === 'joker' ? '★' : card.value} → Main`, 'chips');
    } else if (eclipsed) {
      v.popup(brick.x, brick.y, 'Éteinte', 'dim');
      g.sfx.wall();
    } else {
      g.sfx.brick(g.engine.pot.broken);
      v.popup(brick.x, brick.y, card.enh === 'pierre' ? '◆' : String(card.value), 'chips');
      if (tags.length) {
        v.popup(brick.x, brick.y + 1.1, tags.join(' · ').toUpperCase() + ' !', 'prow');
        g.sfx.figure(2 + tags.length);
        v.stage.kick(0.2 * tags.length);
      }
      if (out) {
        const a = g.hud.handAnchor();
        g.hud.popup(a.x - 70, a.y + 10, out.enh === 'pierre' ? '◆ écartée' : `${out.value} écarté`, 'dim');
      }
      if (money) v.popup(brick.x + 0.6, brick.y + 0.5, `+$${money}`, 'money');
    }
    if (bomb) {
      v.stage.ripple3D(brick.x, brick.y, 1);
      v.stage.punch(0.03);
      v.stage.lightFlash(brick.x, brick.y, FX.MULT, 40, 0.5);
      g.sfx.boom();
      v.stage.shake.add(0.4);
      v.stage.kick(0.5);
      v.rings.spawn(brick.x, brick.y, FX.MULT, 5, 0.45);
      g.hitstop = Math.max(g.hitstop, 0.08);
    }
    v.ball.impact(1);
    v.stage.shake.add(0.1 + Math.min(0.15, g.engine.pot.bricks.length * 0.008));
    g.hitstop = Math.max(g.hitstop, 0.03);
    g.refreshPot(true);
    g.refreshResources();
  });

  ev.on('bumperHit', ({ bumper, x, y }) => {
    v.terrain.hitBumper(bumper);
    v.stage.lightFlash(bumper.x, bumper.y, FX.PINK, 14, 0.25);
    v.sparks.burst(x, y, FX.PINK, 8, 0.7);
    g.sfx.paddle(6);
    v.particles.burst(x, y, FX.PINK, 10, 0.8);
    v.rings.spawn(bumper.x, bumper.y, FX.PINK, 2.2, 0.3);
    v.stage.shake.add(0.08);
    v.ball.impact(1);
  });

  ev.on('netSaved', ({ x, y }) => {
    g.sfx.clang();
    v.rings.spawn(x, y, FX.TEAL, 3, 0.45);
    v.sparks.burst(x, y, FX.TEAL, 16, 1);
    v.stage.lightFlash(x, y, FX.TEAL, 22, 0.4);
    v.popup(x, y + 1.5, 'Filet !', 't-k');
  });
  ev.on('switched', ({ brick, open }) => {
    const c = open ? FX.TEAL : FX.TOOL;
    g.sfx.clang();
    v.rings.spawn(brick.x, brick.y, c, 2.6, 0.4);
    v.stage.lightFlash(brick.x, brick.y, c, 18, 0.35);
    for (const gate of g.world.bricks) if (gate.gate) v.bricks.pulse(gate.id, 3);
    v.popup(brick.x, brick.y, open ? 'Vannes ouvertes' : 'Vannes fermées', 't-k');
  });
  ev.on('blockHit', ({ brick, x, y }) => {
    g.sfx.wall();
    v.bricks.pulse(brick.id, 2);
    v.particles.burst(x, y, FX.WHITE, 4, 0.4);
    v.ball.impact(0.6);
  });

  ev.on('portal', ({ fromX, fromY, toX, toY }) => {
    v.rings.spawn(fromX, fromY, FX.PURPLE, 2.5, 0.35);
    v.rings.spawn(toX, toY, FX.CYAN, 2.5, 0.35);
    v.particles.burst(toX, toY, FX.CYAN, 12, 0.7);
    v.stage.ripple3D(toX, toY, 0.45);
    v.stage.lightFlash(toX, toY, FX.CYAN, 18, 0.35);
    g.sfx.rune();
    v.stage.kick(0.25);
  });

  ev.on('brickDamaged', ({ brick, x, y }) => {
    const pinata = card(brick.uid)?.enh === 'pinata';
    g.sfx.clang();
    v.bricks.pulse(brick.id, pinata ? 9 : 5);
    v.particles.burst(x, y, pinata ? BRICK_COLORS[v.fxRng.int(4)] : FX.WHITE, pinata ? 14 : 8, 0.6);
    v.popup(brick.x, brick.y, pinata ? ['Pif !', 'Paf !', 'Pouf !'][brick.hp % 3] : 'Clang !', pinata ? 'prow' : 'dim');
    v.ball.impact(1);
  });

  ev.on('twinHit', ({ x, y }) => {
    v.twin.hit(1);
    g.sfx.paddle(g.engine.pot.streak);
    v.rings.spawn(x, y, FX.PURPLE, 1.6, 0.3);
    v.sparks.burst(x, y, FX.PURPLE, 10, 0.6, 0, -1);
    v.stage.lightFlash(x, y - 0.5, FX.PURPLE, 10, 0.2);
    if (g.engine.run && g.phase === 'play') v.popup(x, y - 1.2, `SÉRIE ${g.engine.pot.streak} ×${seriesMult(g.engine.pot.streak, g.engine.run.relics)}`, 'mult');
    g.refreshPot();
  });

  ev.on('split', ({ x, y }) => {
    g.sfx.rune();
    v.rings.spawn(x, y, FX.CYAN, 2.6, 0.4);
    v.sparks.burst(x, y, FX.CYAN, 18, 0.9);
    v.stage.lightFlash(x, y, FX.CYAN, 20, 0.3);
    v.stage.kick(0.3);
    v.popup(x, y + 1, 'SCISSION !', 'prow');
    g.refreshPot();
  });
  ev.on('extraLost', ({ x }) => {
    g.sfx.wall();
    v.particles.burst(x, FIELD.bottom + 0.5, FX.CYAN, 16, 0.8, 0, 1);
    g.refreshPot();
  });
  ev.on('extraPopped', ({ x, y }) => {
    v.rings.spawn(x, y, FX.GOLD, 2.4, 0.4);
    v.particles.burst(x, y, FX.GOLD, 20, 1);
    v.popup(x, y + 0.8, '+×0.5', 'mult');
    g.sfx.coin();
  });
  ev.on('promoted', ({ x, y }) => {
    v.ball.reset(x, y);
    g.sfx.armed();
    g.hud.banner('RELÈVE !', 'Une autre balle vole encore : la Main est sauve', '#9fe8ff');
    v.rings.spawn(x, y, FX.CYAN, 3, 0.45);
    g.refreshPot();
  });

  ev.on('paddleHit', ({ x, y, speed, extra }) => {
    if (extra) {
      g.sfx.paddle(2);
      v.paddle.hit(0.5);
      v.rings.spawn(x, y, FX.CYAN, 1, 0.25);
      v.sparks.burst(x, y, FX.CYAN, 6, 0.5, 0, 1);
      return;
    }
    g.sfx.paddle(g.engine.pot.rebounds);
    if (g.engine.run && g.engine.pot.streak > 0) v.popup(x, y + 1.2, `SÉRIE ${g.engine.pot.streak} ×${seriesMult(g.engine.pot.streak, g.engine.run.relics)}`, 'mult');
    v.paddle.hit(1);
    v.ball.impact(1.2);
    v.stage.shake.add(0.07);
    v.particles.burst(x, y, v.ball.color, 8, 0.6, 0, 1);
    v.rings.spawn(x, y, FX.MULT, 1.2 + speed * 0.05, 0.3);
    v.sparks.burst(x, y, v.ball.color, 10, 0.6, 0, 1);
    v.stage.lightFlash(x, y + 0.5, v.ball.color, 10, 0.2);
    g.refreshPot();
  });

  ev.on('wallHit', ({ x, y }) => {
    const sm = g.engine.currentBall?.wallMult;
    if (sm && g.phase === 'play') v.popup(x, y, `+${sm} Mult`, 'mult');
    if (g.phase === 'play') g.refreshPot();
    g.sfx.wall();
    v.ball.impact(0.5);
    v.frame3d.pulse(x, y, 0.8);
    v.sparks.burst(x, y, FX.WHITE, 5, 0.5);
  });

  ev.on('wrapped', ({ fromX, toX, y }) => {
    v.rings.spawn(fromX, y, FX.PURPLE, 1.5, 0.3);
    v.rings.spawn(toX, y, FX.PURPLE, 1.5, 0.3);
    g.sfx.wall();
  });

  ev.on('caught', ({ x, y }) => {
    v.paddle.hit(1.5);
    v.rings.spawn(x, y, FX.GOLD, 3, 0.5);
    v.particles.burst(x, y, FX.GOLD, 24, 1, 0, 1);
    g.hitstop = 0.08;
  });

  en.on('cleared', () => {
    g.hud.banner('MUR PULVÉRISÉ !', 'Nouvelles briques', '#3fd18f');
    v.stage.ripple3D(0, 6, 1.4);
    v.stage.whiteFlash(0.4);
    v.stage.shake.add(0.5);
    v.stage.kick(0.6);
    g.hitstop = 0.25;
    g.sfx.win();
  });

  en.on('frenzy', ({ x, y }) => {
    g.hud.banner('FRÉNÉSIE !', 'La balle brûle et traverse une brique par trajet', '#ff5a1f');
    g.sfx.figure(6);
    v.stage.shake.add(0.5);
    v.stage.kick(0.7);
    v.stage.whiteFlash(0.25);
    v.stage.lightFlash(x, y, FX.MULT, 40, 0.6);
    v.rings.spawn(x, y, FX.MULT, 5, 0.5);
    v.sparks.burst(x, y, FX.MULT, 40, 1.3);
    g.hitstop = Math.max(g.hitstop, 0.12);
    g.refreshPot();
  });
  en.on('bigFigure', ({ x, y, figure }) => {
    g.hud.banner(`${figure.name.toUpperCase()} !!!`, 'Onde de choc', '#ffc53d');
    g.sfx.boom();
    g.sfx.figure(8);
    g.hitstop = Math.max(g.hitstop, 0.32);
    v.stage.whiteFlash(0.6);
    v.stage.ripple3D(x, y, 1.6);
    v.stage.punch(0.08);
    v.stage.shake.add(0.9);
    v.stage.kick(1);
    v.rings.spawn(x, y, FX.GOLD, 9, 0.7);
    v.rings.spawn(x, y, FX.WHITE, 5, 0.5);
    v.sparks.burst(x, y, FX.GOLD, 60, 1.6);
    v.particles.burst(x, y, FX.GOLD, 60, 1.6);
    v.bricks.shockwave(x, y, 10);
  });
  en.on('spawned', ({ ids }) => {
    v.bricks.spawn(ids);
    for (const id of ids) {
      const b = g.world.bricks[id];
      v.sparks.burst(b.x, b.y, FX.WHITE, 8, 0.5);
    }
    g.sfx.shuffle();
    g.refreshPot();
  });
  en.on('morphed', ({ ids }) => {
    for (const id of ids) {
      const b = g.world.bricks[id];
      v.bricks.pulse(id, 4);
      v.sparks.burst(b.x, b.y, FX.PURPLE, 6, 0.5);
    }
  });
  en.on('fled', ({ from, to }) => {
    const a = g.world.bricks[from], b = g.world.bricks[to];
    v.particles.burst(a.x, a.y, FX.TEAL, 16, 0.8);
    v.bricks.spawn([to]);
    v.popup(b.x, b.y + 0.8, 'Fuyarde !', 'prow');
    g.sfx.shuffle();
    g.refreshPot();
  });
  en.on('relicLost', ({ def }) => {
    g.hud.banner('PACTE DU DIABLE', `${def.glyph} ${def.name} est détruite`, '#ff3d5a');
    g.sfx.glass();
    v.stage.shake.add(0.4);
    g.refreshHud();
  });

  en.on('settled', ({ moves }) => {
    v.bricks.drop(moves);
    g.sfx.shuffle();
  });
  en.on('painted', ({ ids, color }) => {
    const fx = BRICK_COLORS[color];
    for (const id of ids) {
      const b = g.world.bricks[id];
      v.bricks.pulse(id, 5);
      v.particles.burst(b.x, b.y, fx, 6, 0.5);
    }
  });
  en.on('refilled', () => {
    v.bricks.spawn();
    g.refreshResources();
    g.refreshPot();
  });
}
