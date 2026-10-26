import { Rng } from '../core/rng';
import { BALL_BY_ID } from './balls';
import { bossById } from './bosses';
import { reserveUids, type BrickCard, type BrickColor } from './bricks';
import { ASTRES, RUNES, type ConsumableDef } from './consumables';
import { DECKS, STAKES } from './decks';
import type { FigureLevels } from './figures';
import { RELIC_BY_ID } from './relics';
import type { Rules } from './ruleset';
import type { Run } from './run';
import { TOOL_BY_ID } from './tools';
import { WALL_MODS, type WallModOffer, type WallModReward } from './wallmods';

/** Version du format : un run sauvegardé dans un autre format est ignoré. */
export const RUN_SAVE_VERSION = 1;

type SavedMod = { mod: string; reward: WallModReward } | null;

/**
 * Un run sauvegardé : uniquement des données (identifiants au lieu des définitions, état du hasard),
 * pour le stocker en JSON et le reprendre plus tard exactement au même point.
 */
export interface RunSave {
  v: number;
  seed: number;
  rng: number;
  deck: string;
  stakeIdx: number;
  ante: number;
  wallIdx: number;
  boss: string;
  eclipseColor: BrickColor;
  bossValue: number;
  lastLayout: string | null;
  money: number;
  cards: BrickCard[];
  relics: { id: string; counter: number; poly?: boolean }[];
  consumables: string[];
  maxConsumables: number;
  balls: { id: string; used: boolean }[];
  tools: { id: string; used: boolean }[];
  levels: FigureLevels;
  stats: Run['stats'];
  endless: boolean;
  pendingMod: SavedMod;
  wallMod: SavedMod;
  removals: number;
  rules: Rules;
}

const CONSUMABLE_BY_ID = Object.fromEntries([...RUNES, ...ASTRES].map((c) => [c.id, c])) as Record<string, ConsumableDef>;
const WALL_MOD_BY_ID = Object.fromEntries(WALL_MODS.map((m) => [m.id, m]));

const saveMod = (m: WallModOffer | null): SavedMod => (m ? { mod: m.mod.id, reward: { ...m.reward } } : null);
const loadMod = (m: SavedMod): WallModOffer | null => (m && WALL_MOD_BY_ID[m.mod] ? { mod: WALL_MOD_BY_ID[m.mod], reward: m.reward } : null);
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function saveRun(run: Run): RunSave {
  return {
    v: RUN_SAVE_VERSION,
    seed: run.seed, rng: run.rng.state, deck: run.deck.id, stakeIdx: run.stakeIdx,
    ante: run.ante, wallIdx: run.wallIdx, boss: run.boss.id, eclipseColor: run.eclipseColor, bossValue: run.bossValue,
    lastLayout: run.lastLayout, money: run.money, cards: copy(run.cards),
    relics: run.relics.map((r) => ({ id: r.def.id, counter: r.counter, ...(r.poly ? { poly: true } : {}) })),
    consumables: run.consumables.map((c) => c.id), maxConsumables: run.maxConsumables,
    balls: run.balls.map((b) => ({ id: b.def.id, used: b.used })),
    tools: run.tools.map((t) => ({ id: t.def.id, used: t.used })),
    levels: { ...run.levels }, stats: { ...run.stats }, endless: run.endless,
    pendingMod: saveMod(run.pendingMod), wallMod: saveMod(run.wallMod), removals: run.removals, rules: copy(run.rules),
  };
}

/** Reprend un run sauvegardé ; null si la sauvegarde est d'un autre format ou cite un contenu qui n'existe plus. */
export function loadRun(s: RunSave): Run | null {
  if (s?.v !== RUN_SAVE_VERSION) return null;
  const deck = DECKS.find((d) => d.id === s.deck);
  const stake = STAKES[s.stakeIdx];
  const boss = bossById(s.boss);
  const relics = s.relics.map((r) => RELIC_BY_ID[r.id] && { def: RELIC_BY_ID[r.id], counter: r.counter, ...(r.poly ? { poly: true } : {}) });
  const consumables = s.consumables.map((id) => CONSUMABLE_BY_ID[id]);
  const balls = s.balls.map((b) => BALL_BY_ID[b.id] && { def: BALL_BY_ID[b.id], used: b.used });
  const tools = s.tools.map((t) => TOOL_BY_ID[t.id] && { def: TOOL_BY_ID[t.id], used: t.used });
  if (!deck || !stake || !boss || [...relics, ...consumables, ...balls, ...tools].some((x) => !x)) return null;
  reserveUids(s.cards);
  return {
    seed: s.seed, rng: Rng.fromState(s.rng), deck, stakeIdx: s.stakeIdx, stake,
    ante: s.ante, wallIdx: s.wallIdx, boss, eclipseColor: s.eclipseColor, bossValue: s.bossValue,
    lastLayout: s.lastLayout, money: s.money, cards: copy(s.cards),
    relics, consumables, maxConsumables: s.maxConsumables, balls, tools,
    levels: { ...s.levels }, stats: { ...s.stats }, endless: s.endless,
    pendingMod: loadMod(s.pendingMod), wallMod: loadMod(s.wallMod), removals: s.removals,
    rules: Object.freeze({ ...s.rules, wallStyle: Object.freeze({ ...s.rules.wallStyle }), anteBase: Object.freeze([...s.rules.anteBase]) }),
  };
}
