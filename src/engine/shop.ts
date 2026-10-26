import { canRemove, canRetail, removePrice, RETAIL_PRICE, type AtelierVisit } from '../rules/atelier';
import { applyAstre, type AstreDef } from '../rules/consumables';
import { MAX_RELICS, type RelicDef } from '../rules/relics';
import { advanceWall } from '../rules/run';
import { generateShop, openPack, rerollBaseCost, rerollShop, rollRelics, sellPrice, type ShopItem } from '../rules/shop';
import { rollSkip, type SkipReward } from '../rules/skips';
import { MAX_TOOLS } from '../rules/tools';
import { rollWallMod, type WallModOffer } from '../rules/wallmods';
import type { Engine } from './engine';

export type PackOptions = ReturnType<typeof openPack>;

/** Récompense d'un Mur maudit brisé en argent, si plus de place pour une Relique. */
export const CURSE_FALLBACK_MONEY = 10;

/**
 * La boutique entre deux Murs : articles, relances, packs, Reliques, Atelier, malédictions et Mur passé.
 */
export class Shop {
  items: ShopItem[] = [];
  rerollCount = 0;
  /** Récompense si on passe le prochain Mur (null si c'est un Boss). */
  skipReward: SkipReward | null = null;
  /** Malédiction proposée pour le prochain Mur. */
  wallModOffer: WallModOffer | null = null;
  /** Services de l'Atelier déjà utilisés pendant cette visite. */
  atelier: AtelierVisit = { removed: false, retailed: false };

  constructor(private readonly engine: Engine) {}

  private get run() {
    return this.engine.run!;
  }

  open(): ShopItem[] {
    const run = this.run;
    this.items = generateShop(run);
    this.rerollCount = 0;
    this.atelier = { removed: false, retailed: false };
    this.skipReward = run.wallIdx !== 1 ? rollSkip(run) : null; // le mur suivant n'est pas un Boss
    this.wallModOffer = run.wallIdx !== 1 ? rollWallMod(run) : null;
    run.pendingMod = null;
    return this.items;
  }

  get rerollCost() {
    return rerollBaseCost(this.run) + this.rerollCount;
  }

  reroll(): boolean {
    const run = this.run;
    if (run.money < this.rerollCost) return false;
    run.money -= this.rerollCost;
    this.rerollCount++;
    this.items = rerollShop(run, this.items);
    return true;
  }

  /** Achète un article. Pour un pack, retourne les options à choisir (via pickPack). */
  buy(i: number): { ok: false; reason: string } | { ok: true; options?: PackOptions; astre?: AstreDef } {
    const run = this.run;
    const it = this.items[i];
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
        applyAstre(run, it.def);
        return { ok: true, astre: it.def };
      }
      run.consumables.push(it.def);
    } else if (it.type === 'ball') run.balls.push({ def: it.def, used: false });
    else if (it.type === 'tool') run.tools.push({ def: it.def, used: false });
    else return { ok: true, options: openPack(run, it.pack) };
    return { ok: true };
  }

  /** Choix dans un pack ouvert. Retourne l'Astre appliqué s'il y en a un. */
  pickPack(options: PackOptions, pick: number | null): { astre?: AstreDef; ok: boolean } {
    const run = this.run;
    if (pick === null) return { ok: true };
    const o = options[pick];
    if ('uid' in o) {
      run.cards.push(o);
      return { ok: true };
    }
    if (o.kind === 'astre') {
      applyAstre(run, o);
      return { ok: true, astre: o };
    }
    if (run.consumables.length < run.maxConsumables) {
      run.consumables.push(o);
      return { ok: true };
    }
    return { ok: false };
  }

  sell(i: number) {
    const run = this.run;
    const r = run.relics[i];
    if (!r) return;
    run.money += sellPrice(r.def);
    run.relics.splice(i, 1);
  }

  /** Déplace une Relique d'un emplacement (l'ordre compte au scoring). */
  move(i: number, dir: number) {
    const run = this.run;
    const j = i + dir;
    if (j < 0 || j >= run.relics.length) return;
    [run.relics[i], run.relics[j]] = [run.relics[j], run.relics[i]];
  }

  // ───────────────────────── Atelier ─────────────────────────

  get atelierOpen() {
    return !!this.engine.run?.rules.atelier;
  }

  /** Retire une brique du deck. */
  atelierRemove(uid: number): boolean {
    const run = this.run;
    if (!this.atelierOpen || !canRemove(run, this.atelier) || !run.cards.some((c) => c.uid === uid)) return false;
    run.money -= removePrice(run);
    run.removals++;
    run.cards = run.cards.filter((c) => c.uid !== uid);
    this.atelier.removed = true;
    return true;
  }

  /** Retaille une brique du deck : ±1 à sa valeur. */
  atelierRetail(uid: number, delta: 1 | -1): boolean {
    const run = this.run;
    const card = run.cards.find((c) => c.uid === uid);
    if (!this.atelierOpen || !canRetail(run, this.atelier, card, delta)) return false;
    run.money -= RETAIL_PRICE;
    card!.value += delta;
    this.atelier.retailed = true;
    return true;
  }

  // ───────────────────────── Malédictions ─────────────────────────

  /** Accepte (ou refuse) la malédiction proposée pour le prochain Mur. */
  acceptWallMod(on: boolean) {
    this.run.pendingMod = on ? this.wallModOffer : null;
  }

  /**
   * Récompense d'un Mur maudit brisé (si c'est une Relique) : 2 Reliques rares au choix,
   * ou de l'argent s'il n'y a plus de place. null si la malédiction rapportait autre chose.
   */
  curseReward(): { money: number } | { choices: RelicDef[] } | null {
    const run = this.run;
    if (run.wallMod?.reward.kind !== 'relic') return null;
    if (run.relics.length >= MAX_RELICS) {
      run.money += CURSE_FALLBACK_MONEY;
      return { money: CURSE_FALLBACK_MONEY };
    }
    const rare = rollRelics(run, 8).filter((d) => d.rarity !== 'commun');
    return { choices: (rare.length >= 2 ? rare : rollRelics(run, 2)).slice(0, 2) };
  }

  /** Prend une Relique offerte (récompense d'un Mur maudit). */
  takeRelic(def: RelicDef): boolean {
    const run = this.run;
    if (run.relics.length >= MAX_RELICS) return false;
    run.relics.push({ def, counter: 0 });
    return true;
  }

  // ───────────────────────── Sortie ─────────────────────────

  /** Quitte la boutique et passe au mur suivant. Retourne true si une nouvelle Ante commence. */
  leave(): boolean {
    const newAnte = advanceWall(this.run);
    this.engine.startWall();
    return newAnte;
  }

  /** Quitte la boutique en passant le prochain Mur (Petit ou Grand) contre sa récompense. */
  skipNextWall(): { newAnte: boolean; reward: SkipReward; options?: PackOptions } | null {
    const run = this.run;
    const reward = this.skipReward;
    if (!reward) return null;
    this.skipReward = null;
    run.pendingMod = null;
    const a = advanceWall(run);
    if (reward.money) run.money += reward.money;
    const options = reward.pack ? openPack(run, reward.pack) : undefined;
    const b = this.leave();
    return { newAnte: a || b, reward, options };
  }
}
