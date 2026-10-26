import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine';
import { DECKS } from '../src/rules/decks';
import { RELIC_BY_ID } from '../src/rules/relics';
import { RULESETS } from '../src/rules/ruleset';
import { RUNES } from '../src/rules/consumables';
import { World } from '../src/sim/world';
import { pickBoss } from '../src/rules/bosses';

/** Ce qui décrit un Mur posé : motif, briques et cartes, objectif, ressources. */
function wallState(e: Engine) {
  return {
    layout: e.layout?.id,
    bricks: e.world.bricks.map((b) => (b.alive ? `${b.kind}:${e.cards.get(b.uid)?.value}:${e.cards.get(b.uid)?.color}:${e.cards.get(b.uid)?.enh}:${b.hp}` : '-')).join(' '),
    wall: { ...e.wall, drawPile: e.wall.drawPile.map((c) => c.uid), discard: e.wall.discard.length },
    orders: e.orders.map((o) => JSON.stringify(o)),
    money: e.run!.money,
  };
}

describe('sauvegarde de run', () => {
  it('reprendre au début d\'un Mur redonne exactement le même Mur et la même suite de hasard', () => {
    const a = new Engine(new World(), RULESETS.v3);
    a.startRun(DECKS[0], 1, 1234);
    const run = a.run!;
    run.relics.push({ def: RELIC_BY_ID.inflation, counter: 2 }, { def: RELIC_BY_ID.souffleur, counter: 0, poly: true });
    run.consumables.push(RUNES[0]);
    run.money = 37;
    a.consumables.splitNext = 2;
    a.shop.open();
    a.shop.leave();
    const saved = JSON.parse(JSON.stringify(a.checkpoint));
    const expected = wallState(a);

    const b = new Engine(new World(), RULESETS.classic);
    expect(b.resume(saved)).toBe(true);
    expect(wallState(b)).toEqual(expected);
    expect(b.run!.relics.map((r) => [r.def.id, r.counter, !!r.poly])).toEqual([['inflation', 2, false], ['souffleur', 0, true]]);
    expect(b.run!.rules.id).toBe('v3');
    expect(b.consumables.splitNext).toBe(2);
    expect([b.run!.rng.next(), b.run!.rng.next()]).toEqual([a.run!.rng.next(), a.run!.rng.next()]);
  });

  it('un Boss combiné se retrouve', () => {
    const a = new Engine(new World(), RULESETS.v3);
    a.startRun(DECKS[0], 0, 99);
    a.run!.ante = 6;
    a.run!.wallIdx = 2;
    a.run!.boss = pickBoss(() => 0.42, 6, null);
    expect(a.run!.boss.id).toContain('+');
    a.startWall();
    const b = new Engine(new World());
    b.resume(JSON.parse(JSON.stringify(a.checkpoint)));
    expect(b.run!.boss).toEqual(a.run!.boss);
  });

  it('une sauvegarde d\'un autre format est refusée', () => {
    const b = new Engine(new World());
    expect(b.resume({ run: { v: 0 } as never, splitNext: 0 })).toBe(false);
    expect(b.run).toBeNull();
  });
});
