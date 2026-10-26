import { cloneCard } from '../rules/bricks';
import { applyAstre, applyRune, type AstreDef, type RuneDef } from '../rules/consumables';
import type { ToolDef } from '../rules/tools';
import type { Engine } from './engine';

/** Résultat d'un consommable sans cible. */
export interface InstantResult { astre?: AstreDef; money?: number; split?: number; discards?: number }

/**
 * Consommables (Runes, Astres) et Outils : ils préparent le mur avant un Lancer.
 */
export class Consumables {
  /** Emplacements visés par l'Arbalète : pulvérisés au prochain Lancer. */
  lasered = new Set<number>();
  /** Rune de Scission : balles supplémentaires au prochain Lancer. */
  splitNext = 0;

  constructor(private readonly engine: Engine) {}

  /** Nouveau Mur. */
  startWall() {
    this.lasered.clear();
  }

  /** Une brique visée par l'Arbalète s'est déplacée (Fuyarde, gravité). */
  moved(from: number, to: number) {
    if (this.lasered.delete(from)) this.lasered.add(to);
  }

  /** Début du Lancer : la balle se divise (Scission), les briques visées par l'Arbalète sont pulvérisées. */
  fireOnLaunch() {
    const world = this.engine.world;
    // Rune de Scission : la balle part en éventail
    for (let k = 0; k < this.splitNext; k++) world.splitBall((k % 2 ? -1 : 1) * 0.3 * (1 + (k >> 1)));
    this.splitNext = 0;
    // L'Arbalète tire : ses briques entrent dans la Main
    for (const id of this.lasered) this.engine.world.destroyBrick(id, 'laser');
    this.lasered.clear();
  }

  /** Consommable sans cible (Astre, Ermite, Scission, Tri). Retourne false s'il faut choisir des briques. */
  useInstant(i: number): InstantResult | false {
    const { run: r, wall } = this.engine;
    const run = r!;
    const c = run.consumables[i];
    if (!c) return false;
    if (c.kind === 'astre') {
      run.consumables.splice(i, 1);
      applyAstre(run, c);
      return { astre: c };
    }
    if (c.targets > 0) return false;
    run.consumables.splice(i, 1);
    if (c.split) {
      this.splitNext += c.split;
      return { split: this.splitNext };
    }
    if (c.discards) {
      wall.discardsLeft += c.discards;
      wall.discardsMax += c.discards;
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
    const engine = this.engine;
    const run = engine.run!;
    const rune = run.consumables[index] as RuneDef;
    // Seules les briques encore sur le mur (sinon les cartes ne correspondent plus aux emplacements)
    const bricks = slotIds.map((id) => engine.world.bricks[id]).filter((b) => b.alive && b.kind === 'brick' && engine.cards.has(b.uid));
    // Une copie limitée au Mur redevient la vraie carte du deck avant d'être modifiée
    for (const b of bricks) engine.restoreDeckCard(b);
    const cards = bricks.map((b) => engine.cards.get(b.uid)!);
    run.consumables.splice(index, 1);
    if (rune.destroy) {
      const uids = new Set(cards.map((c) => c.uid));
      run.cards = run.cards.filter((c) => !uids.has(c.uid));
      bricks.forEach((b) => engine.world.setBrick(b.id, null));
    } else if (rune.duplicate) {
      const pile = engine.wall.drawPile;
      for (const c of cards) {
        const copy = cloneCard(c);
        run.cards.push(copy);
        engine.cards.set(copy.uid, copy);
        pile.splice(run.rng.int(pile.length + 1), 0, copy);
      }
    } else {
      applyRune(rune, cards);
      bricks.forEach((b, i) => engine.world.setBrick(b.id, cards[i]));
    }
    engine.updateSnap();
    return rune;
  }

  /** Utilise un Outil (1 fois par Mur) sur des emplacements du mur, dans l'ordre de sélection. */
  useTool(index: number, slotIds: number[]): ToolDef | null {
    const engine = this.engine;
    const t = engine.run!.tools[index];
    if (!t || t.used) return null;
    t.used = true;
    const bricks = slotIds.map((id) => engine.world.bricks[id]).filter((b) => b.alive && b.kind === 'brick');
    if (t.def.swap) {
      for (let i = 0; i + 1 < bricks.length; i += 2) {
        const a = engine.cards.get(bricks[i].uid), b = engine.cards.get(bricks[i + 1].uid);
        if (!a || !b) continue;
        engine.world.setBrick(bricks[i].id, b);
        engine.world.setBrick(bricks[i + 1].id, a);
      }
    }
    if (t.def.laser) bricks.forEach((b) => this.lasered.add(b.id));
    engine.updateSnap();
    return t.def;
  }
}
