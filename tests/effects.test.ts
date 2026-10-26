import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { Engine } from '../src/engine/engine';
import { DECKS } from '../src/rules/decks';
import { RELIC_BY_ID } from '../src/rules/relics';
import { RULESETS } from '../src/rules/ruleset';
import { newCard, type Enh } from '../src/rules/bricks';
import { World } from '../src/sim/world';

function setup() {
  const engine = new Engine(new World(new Rng(1)), RULESETS.v3);
  engine.startRun(DECKS[0], 0, 42);
  return engine;
}

/** Transforme une brique vivante du mur et la renvoie. */
function make(engine: Engine, enh: Enh) {
  const b = engine.world.bricks.find((x) => x.alive && x.kind === 'brick')!;
  const card = { ...engine.cards.get(b.uid)!, enh };
  engine.cards.set(card.uid, card);
  engine.world.setBrick(b.id, card);
  return b;
}

describe('effets des améliorations', () => {
  it('Reine : pond une brique au Lancer', () => {
    const engine = setup();
    make(engine, 'reine');
    const spawned: number[] = [];
    engine.events.on('spawned', ({ ids }) => spawned.push(...ids));
    // Libère des cases autour de la Reine
    for (const b of engine.world.bricks) if (b.alive && b.kind === 'brick' && engine.cards.get(b.uid)?.enh !== 'reine') engine.world.setBrick(b.id, null);
    engine.launch(0);
    expect(spawned.length).toBe(1);
  });

  it('Piñata : 4 points de vie, cassée elle rapporte $3', () => {
    const engine = setup();
    const b = make(engine, 'pinata');
    expect(b.hp).toBe(4);
    const before = engine.run!.money;
    engine.launch(0);
    engine.world.destroyBrick(b.id, 'laser');
    expect(engine.run!.money).toBe(before + 3);
  });

  it('Bombe : casse ses voisines en croix', () => {
    const engine = setup();
    // Une Bombe et une voisine à droite (le premier mur est en damier)
    const b = make(engine, 'bombe');
    const nb = newCard(1, 5);
    engine.cards.set(nb.uid, nb);
    engine.world.setBrick(b.id + 1, nb);
    let bomb = false;
    engine.events.on('brick', (e) => { if (e.bomb) bomb = true; });
    engine.launch(0);
    const alive = () => engine.world.bricks.filter((x) => x.alive).length;
    const n = alive();
    engine.world.destroyBrick(b.id, 'laser');
    for (let i = 0; i < 20; i++) engine.step(1 / 120, { paddleTargetX: 0, catchArmed: false, speedMul: 1 });
    expect(bomb).toBe(true);
    expect(alive()).toBeLessThan(n - 1);
  });
});

describe('effets des Reliques', () => {
  it('Pacte du Diable : une balle perdue détruit une autre Relique', () => {
    const engine = setup();
    const run = engine.run!;
    run.relics.push({ def: RELIC_BY_ID.pacte, counter: 0 }, { def: RELIC_BY_ID.colosse, counter: 0 });
    const lost: string[] = [];
    engine.events.on('relicLost', ({ def }) => lost.push(def.id));
    engine.world.events.emit('ballLost', { x: 0 });
    expect(lost).toEqual(['colosse']);
    expect(run.relics.map((r) => r.def.id)).toEqual(['pacte']);
  });

  it('Maçon fou : un renvoi fait apparaître une brique 7', () => {
    const engine = setup();
    engine.run!.relics.push({ def: RELIC_BY_ID.macon, counter: 0 });
    const spawned: number[] = [];
    engine.events.on('spawned', ({ ids }) => spawned.push(...ids));
    for (const b of engine.world.bricks.slice(0, 20)) if (b.kind === 'brick') engine.world.setBrick(b.id, null);
    engine.launch(0);
    engine.world.events.emit('paddleHit', { x: 0, y: 0, offset: 0, speed: 13, extra: false });
    expect(spawned).toHaveLength(1);
    expect(engine.cards.get(engine.world.bricks[spawned[0]].uid)?.value).toBe(7);
  });

  it('Pinceau : les voisines de rangée prennent la couleur, le deck ne change pas', () => {
    const engine = setup();
    engine.run!.relics.push({ def: RELIC_BY_ID.pinceau, counter: 0 });
    const painted: number[] = [];
    engine.events.on('painted', ({ ids }) => painted.push(...ids));
    engine.launch(0);
    const target = engine.world.bricks.find((b) => b.alive && b.kind === 'brick' && b.col > 0 && b.col < 9)!;
    const deckBefore = engine.run!.cards.map((c) => c.color).join();
    engine.world.destroyBrick(target.id, 'laser');
    for (const id of painted) expect(engine.cards.get(engine.world.bricks[id].uid)?.color).toBe(engine.cards.get(target.uid)?.color);
    expect(engine.run!.cards.map((c) => c.color).join()).toBe(deckBefore);
  });
});
