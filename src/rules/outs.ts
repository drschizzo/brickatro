import type { BrickCard } from './bricks';
import { COLOR_NAMES, COLOR_TAGS, isColorless } from './bricks';
import { evaluate, figureIndex, FIGURES, type FigureDef } from './figures';
import type { Pot, PotBrick } from './pot';

export interface Outs {
  /** uid des briques du mur qui améliorent la Figure. */
  useful: Set<number>;
  /** Pour l'affichage : les 2 meilleures Figures atteignables avec 1 brique et ce qu'il faut toucher. */
  targets: { figure: FigureDef; need: string }[];
}

/**
 * "Outs" (comme au poker) : quelles briques encore sur le mur feraient monter la Main
 * d'un cran si on les touchait maintenant (la Main garde ses 5 meilleures briques).
 */
export function computeOuts(pot: Pot, wall: BrickCard[]): Outs {
  const cur = figureIndex(evaluate(pot).figure);
  const byFigure = new Map<number, BrickCard[]>();
  const useful = new Set<number>();
  for (const c of wall) {
    // Joker : il prend la valeur qui arrange, il fait toujours monter la Main
    if (c.enh === 'joker') { useful.add(c.uid); continue; }
    const b: PotBrick = { uid: c.uid, color: c.color, value: c.value, enh: c.enh, edition: c.edition, wallBounces: 0, sideBounces: 0, cause: 'ball', bumped: false, ported: false, fromAbove: false, called: false, trip: 0, star: false, row: 0, col: 0, vein: 0 };
    const sim = pot.clone();
    sim.addBrick(b);
    const idx = figureIndex(evaluate(sim).figure);
    if (idx > cur && idx > 0) {
      useful.add(c.uid);
      byFigure.set(idx, [...(byFigure.get(idx) ?? []), c]);
    }
  }
  const targets = [...byFigure.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, 2)
    .map(([idx, cards]) => ({ figure: FIGURES[idx], need: describe(cards) }));
  return { useful, targets };
}

function describe(cards: BrickCard[]): string {
  const colored = cards.filter((c) => !isColorless(c));
  const colors = new Set(colored.map((c) => c.color));
  const values = [...new Set(colored.map((c) => c.value))].sort((a, b) => a - b);
  if (colors.size === 1 && values.length > 2) {
    const c = [...colors][0];
    return `une brique {${COLOR_TAGS[c]}}${COLOR_NAMES[c]}{/}`;
  }
  if (values.length && values.length <= 3) {
    const v = values.map((x) => `{k}${x}{/}`).join(' ou ');
    return colors.size === 1 ? `${v} {${COLOR_TAGS[[...colors][0]]}}${COLOR_NAMES[[...colors][0]]}{/}` : `un ${v}`;
  }
  return `${cards.length} briques possibles`;
}
