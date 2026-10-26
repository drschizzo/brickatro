import type { Rng } from '../core/rng';
import { isColorless, type BrickCard } from './bricks';

/**
 * Pose des briques sur le mur.
 * - random : comme une donne mélangée.
 * - sorted : chaque segment de rangée est trié par valeur (gauche → droite).
 * - veins  : une part `order` des segments devient un Filon (Suite, Couleur ou Grappe),
 *            rempli en puisant dans le dessus de la pioche ; le reste est du bruit.
 * - blocks : Filons en blocs 2×3 (ou 2×2) — les ricochets cassent surtout des voisines,
 *            y compris au-dessus : un bloc se vide plus facilement qu'un segment de rangée.
 * - mixed  : blocs d'abord, puis Filons de rangée sur les emplacements restants.
 */
export type WallStyle = 'random' | 'sorted' | 'veins' | 'blocks' | 'mixed';
export type VeinKind = 'suite' | 'couleur' | 'grappe';

export interface WallStyleCfg {
  style: WallStyle;
  /** Part des segments transformés en Filon (0 à 1). */
  order: number;
  /** Cartes du dessus de la pioche examinées pour remplir un Filon (plus = Filons plus purs). */
  lookahead: number;
}

export const DEFAULT_WALL_STYLE: WallStyleCfg = { style: 'veins', order: 0.6, lookahead: 20 };

export const VEIN_NAMES: Record<VeinKind, string> = { suite: 'Filon Suite', couleur: 'Filon Couleur', grappe: 'Grappe' };

export interface Segment {
  /** Emplacements de gauche à droite. */
  slots: number[];
  kind: VeinKind | null;
}

interface Slot { id: number; row: number; col: number }

/**
 * Découpe les emplacements en segments horizontaux (un trou d'une case est toléré,
 * pas un bloc), puis coupe les segments longs en morceaux de 3 à 5.
 */
export function cutSegments(slots: Slot[], isBlock: (row: number, col: number) => boolean): number[][] {
  const byRow = new Map<number, Slot[]>();
  for (const s of slots) byRow.set(s.row, [...(byRow.get(s.row) ?? []), s]);
  const out: number[][] = [];
  for (const row of [...byRow.values()]) {
    row.sort((a, b) => a.col - b.col);
    let cur: Slot[] = [];
    const flush = () => {
      if (!cur.length) return;
      const parts = Math.ceil(cur.length / 5);
      const base = Math.floor(cur.length / parts);
      let extra = cur.length % parts;
      let i = 0;
      for (let p = 0; p < parts; p++) {
        const n = base + (extra-- > 0 ? 1 : 0);
        out.push(cur.slice(i, i + n).map((s) => s.id));
        i += n;
      }
      cur = [];
    };
    for (const s of row) {
      const prev = cur[cur.length - 1];
      const gap = prev ? s.col - prev.col : 1;
      if (prev && (gap > 2 || (gap === 2 && isBlock(s.row, s.col - 1)))) flush();
      cur.push(s);
    }
    flush();
  }
  return out;
}

const MIN_LEN: Record<VeinKind, number> = { suite: 3, couleur: 3, grappe: 2 };
const KIND_WEIGHTS: [VeinKind, number][] = [['suite', 0.4], ['couleur', 0.35], ['grappe', 0.25]];

/** Choisit quels segments deviennent des Filons, et de quel type. */
export function planVeins(segs: number[][], cfg: WallStyleCfg, rng: Rng): Segment[] {
  return segs.map((slots) => {
    if (cfg.style !== 'veins' || rng.next() >= cfg.order) return { slots, kind: null };
    const ok = KIND_WEIGHTS.filter(([k]) => slots.length >= MIN_LEN[k]);
    if (!ok.length) return { slots, kind: null };
    let r = rng.next() * ok.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of ok) if ((r -= w) < 0) return { slots, kind: k };
    return { slots, kind: ok[ok.length - 1][0] };
  });
}

/** Tire une carte : la première du dessus de pioche qui vérifie `pred`, sinon la carte du dessus. */
export type DrawFn = (pred?: (c: BrickCard) => boolean) => BrickCard | null;

const byValue = (a: BrickCard | null, b: BrickCard | null) => (a?.value ?? 99) - (b?.value ?? 99);
const valued = (c: BrickCard) => !isColorless(c);

/** Remplit un segment selon son type. Renvoie les cartes de gauche à droite. */
export function fillSegment(seg: Segment, style: WallStyle, draw: DrawFn): (BrickCard | null)[] {
  const n = seg.slots.length;
  const cards: (BrickCard | null)[] = [];
  switch (seg.kind) {
    case null:
      for (let i = 0; i < n; i++) cards.push(draw());
      return style === 'sorted' ? cards.sort(byValue) : cards;
    case 'suite': {
      // On part d'une valeur assez basse pour pouvoir monter de n crans
      const first = draw((c) => valued(c) && c.value <= 11 - n);
      cards.push(first);
      let v = first && valued(first) ? first.value : 0;
      while (cards.length < n) {
        const c = draw((x) => valued(x) && x.value === v + 1);
        cards.push(c);
        if (c && valued(c) && c.value === v + 1) v++;
      }
      return cards.sort(byValue);
    }
    case 'couleur': {
      const first = draw(valued);
      cards.push(first);
      while (cards.length < n) cards.push(first && valued(first) ? draw((c) => valued(c) && c.color === first.color) : draw());
      return cards.sort(byValue);
    }
    case 'grappe': {
      // Des paquets de 2 (ou 3 en fin de segment) de même valeur
      const groups: (BrickCard | null)[][] = [];
      let left = n;
      while (left > 0) {
        const size = left === 3 ? 3 : Math.min(2, left);
        const first = draw(valued);
        const g = [first];
        for (let i = 1; i < size; i++) g.push(first && valued(first) ? draw((c) => valued(c) && c.value === first.value) : draw());
        groups.push(g);
        left -= size;
      }
      return groups.sort((a, b) => byValue(a[0], b[0])).flat();
    }
  }
}

// ───────────────────────── Blocs 2D ─────────────────────────

export interface Block {
  /** Emplacements par rangée (de haut en bas), chaque rangée de gauche à droite. */
  rows: number[][];
  kind: VeinKind;
}

const BLOCK_WEIGHTS: [VeinKind, number][] = [['couleur', 0.4], ['grappe', 0.35], ['suite', 0.25]];

/**
 * Cherche des rectangles 2×3 (sinon 2×2) d'emplacements de briques contigus et en garde une part `order`.
 * Renvoie les blocs et les emplacements restants.
 */
export function cutBlocks(slots: Slot[], cols: number, order: number, rng: Rng): { blocks: Block[]; rest: Slot[] } {
  const free = new Map<number, Slot>(slots.map((s) => [s.row * cols + s.col, s]));
  const blocks: Block[] = [];
  const sorted = [...slots].sort((a, b) => a.row - b.row || a.col - b.col);
  for (const s of sorted) {
    if (!free.has(s.row * cols + s.col)) continue;
    for (const w of [3, 2]) {
      const ids: number[][] = [];
      for (let r = 0; r < 2; r++) {
        const row: number[] = [];
        for (let c = 0; c < w; c++) {
          const k = (s.row + r) * cols + s.col + c;
          if (s.col + c < cols && free.has(k)) row.push(free.get(k)!.id);
        }
        ids.push(row);
      }
      if (ids.every((r) => r.length === w)) {
        if (rng.next() < order) {
          for (let r = 0; r < 2; r++) for (let c = 0; c < w; c++) free.delete((s.row + r) * cols + s.col + c);
          let x = rng.next() * BLOCK_WEIGHTS.reduce((t, [, p]) => t + p, 0);
          const kind = BLOCK_WEIGHTS.find(([, p]) => (x -= p) < 0)?.[0] ?? 'couleur';
          blocks.push({ rows: ids, kind });
        }
        break;
      }
    }
  }
  return { blocks, rest: [...free.values()] };
}

/** Remplit un bloc. Renvoie les cartes rangée par rangée (même forme que `rows`). */
export function fillBlock(block: Block, draw: DrawFn): (BrickCard | null)[][] {
  const w = block.rows[0].length;
  const n = w * 2;
  let flat: (BrickCard | null)[] = [];
  switch (block.kind) {
    case 'couleur': {
      const first = draw(valued);
      flat.push(first);
      while (flat.length < n) flat.push(first && valued(first) ? draw((c) => valued(c) && c.color === first.color) : draw());
      flat.sort(byValue);
      break;
    }
    case 'suite': {
      // Valeurs qui se suivent : rangée du haut puis rangée du bas
      const first = draw((c) => valued(c) && c.value <= 11 - n);
      flat.push(first);
      let v = first && valued(first) ? first.value : 0;
      while (flat.length < n) {
        const c = draw((x) => valued(x) && x.value === v + 1);
        flat.push(c);
        if (c && valued(c) && c.value === v + 1) v++;
      }
      flat.sort(byValue);
      break;
    }
    case 'grappe': {
      // Une valeur par rangée : brelan en haut, brelan en bas (paires en 2×2) → Full à portée
      for (let r = 0; r < 2; r++) {
        const used = flat.filter(Boolean).map((c) => c!.value);
        const first = draw((c) => valued(c) && !used.includes(c.value));
        const row = [first];
        while (row.length < w) row.push(first && valued(first) ? draw((c) => valued(c) && c.value === first.value) : draw());
        flat = flat.concat(row);
      }
      break;
    }
  }
  return [flat.slice(0, w), flat.slice(w)];
}
