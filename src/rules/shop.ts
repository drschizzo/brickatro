import { BALLS, type BallDef } from './balls';
import { randomFancyCard, type BrickCard, type BrickColor } from './bricks';
import { ASTRES, CONSUMABLE_PRICE, RUNES, type ConsumableDef } from './consumables';
import { RELIC_PRICE, RELICS, sumMod, type RelicDef, type Rarity } from './relics';
import type { Run } from './run';
import { MAX_TOOLS, TOOLS, type ToolDef } from './tools';

export type PackKind = 'briques' | 'astres' | 'runes';
export const PACKS: Record<PackKind, { name: string; glyph: string; desc: string; price: number }> = {
  briques: { name: 'Pack de Briques', glyph: '🧱', desc: 'Choisis 1 brique enchantée parmi 3 à ajouter à ton deck', price: 4 },
  astres: { name: "Pack d'Astres", glyph: '🪐', desc: 'Choisis 1 Astre parmi 3 (utilisé tout de suite)', price: 4 },
  runes: { name: 'Pack de Runes', glyph: '📜', desc: 'Choisis 1 Rune parmi 3', price: 4 },
};

export type ShopItem =
  | { type: 'relic'; def: RelicDef; price: number; poly?: boolean; sold?: boolean }
  | { type: 'consumable'; def: ConsumableDef; price: number; sold?: boolean }
  | { type: 'ball'; def: BallDef; price: number; sold?: boolean }
  | { type: 'tool'; def: ToolDef; price: number; sold?: boolean }
  | { type: 'pack'; pack: PackKind; price: number; sold?: boolean };

const RARITY_WEIGHT: Record<Rarity, number> = { commun: 70, rare: 26, légendaire: 5 };

/**
 * Tirage pondéré des Reliques : les archétypes déjà possédés sont favorisés (×3)
 * pour que les synergies émergent sans être garanties.
 */
export function rollRelics(run: Run, n: number, exclude: Set<string> = new Set()): RelicDef[] {
  const owned = new Set(run.relics.map((r) => r.def.id));
  const tags = new Set(run.relics.flatMap((r) => r.def.tags));
  // Règles v3 : plus de Filons, le Cartographe n'a plus d'effet
  const pool = RELICS.filter((d) => !owned.has(d.id) && !exclude.has(d.id) && !(run.ruleset === 'v3' && d.id === 'cartographe') && !(run.ruleset !== 'v3' && d.needsDiscard));
  const out: RelicDef[] = [];
  while (out.length < n && pool.length) {
    const weights = pool.map((d) => RARITY_WEIGHT[d.rarity] * (d.tags.some((t) => tags.has(t)) ? 3 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = run.rng.next() * total;
    let i = 0;
    while ((r -= weights[i]) > 0) i++;
    out.push(pool[i]);
    pool.splice(i, 1);
  }
  return out;
}

/** Article Relique : rarement Polychrome (×1.5 Mult en plus), bien plus souvent en mode infini. */
function relicItem(run: Run, def: RelicDef): ShopItem {
  const poly = run.rng.next() < (run.endless ? 0.25 : 0.04);
  return { type: 'relic', def, price: RELIC_PRICE[def.rarity] + (poly ? 3 : 0) + (run.tight ? 1 + Math.floor(run.ante / 3) : 0), poly };
}

/** Économie resserrée : les prix montent d'1 $ toutes les 3 Antes. */
const inflation = (run: Run) => (run.tight ? Math.floor(run.ante / 3) : 0);

/** Runes proposées : sans Défausse (règles d'origine), pas de Rune du Tri. */
const runePool = (run: Run) => (run.ruleset === 'v3' ? RUNES : RUNES.filter((r) => !r.discards));
export const rollConsumable = (run: Run): ConsumableDef => (run.rng.next() < 0.55 ? run.rng.pick(runePool(run)) : run.rng.pick(ASTRES));

export function generateShop(run: Run): ShopItem[] {
  const items: ShopItem[] = [];
  const up = inflation(run);
  for (const def of rollRelics(run, 2)) items.push(relicItem(run, def));
  for (let i = 0; i < (run.tight ? 1 : 2); i++) items.push({ type: 'consumable', def: rollConsumable(run), price: CONSUMABLE_PRICE + up });
  // Économie resserrée : une balle OU un Outil
  const gear = run.tight ? (run.rng.next() < 0.5 ? 'ball' : 'tool') : 'both';
  const ownedBalls = new Set(run.balls.map((b) => b.def.id));
  const balls = BALLS.filter((b) => !ownedBalls.has(b.id));
  if (balls.length && gear !== 'tool') {
    const def = run.rng.pick(balls);
    items.push({ type: 'ball', def, price: def.price + up });
  }
  const ownedTools = new Set(run.tools.map((t) => t.def.id));
  const tools = TOOLS.filter((t) => !ownedTools.has(t.id));
  if (tools.length && run.tools.length < MAX_TOOLS && gear !== 'ball') {
    const def = run.rng.pick(tools);
    items.push({ type: 'tool', def, price: def.price + up });
  }
  const packs: PackKind[] = ['briques', 'astres', 'runes'];
  run.rng.shuffle(packs);
  for (const p of packs.slice(0, run.tight ? 1 : 2)) items.push({ type: 'pack', pack: p, price: PACKS[p].price + up + (run.tight ? 1 : 0) });
  return items;
}

/** Ne relance que les Reliques et consommables (comme Balatro). */
export function rerollShop(run: Run, items: ShopItem[]): ShopItem[] {
  const keep = items.filter((i) => i.type === 'ball' || i.type === 'tool' || i.type === 'pack');
  const fresh: ShopItem[] = [];
  for (const def of rollRelics(run, 2)) fresh.push(relicItem(run, def));
  for (let i = 0; i < (run.tight ? 1 : 2); i++) fresh.push({ type: 'consumable', def: rollConsumable(run), price: CONSUMABLE_PRICE + inflation(run) });
  return [...fresh, ...keep];
}

export const rerollBaseCost = (run: Run) => Math.max(1, 5 - sumMod(run.relics, 'rerollDiscount'));

export function openPack(run: Run, kind: PackKind): (BrickCard | ConsumableDef)[] {
  if (kind === 'briques') {
    const colors = [...new Set(run.cards.map((c) => c.color))] as BrickColor[];
    return [0, 1, 2].map(() => randomFancyCard(run.rng, colors));
  }
  const pool: ConsumableDef[] = kind === 'astres' ? [...ASTRES] : [...runePool(run)];
  return run.rng.shuffle(pool).slice(0, 3);
}

export const sellPrice = (def: RelicDef) => Math.max(1, Math.floor(RELIC_PRICE[def.rarity] / 2));
