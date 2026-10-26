import type { BrickColor, Enh } from '../src/rules/bricks';
import type { PotBrick } from '../src/rules/pot';

let uid = 100_000;

/** Brique de Main minimale pour les tests. */
export function pb(value: number, color: BrickColor = 0, extra: Partial<PotBrick> & { enh?: Enh } = {}): PotBrick {
  return {
    uid: uid++, color, value, enh: 'none', edition: 'none', cause: 'ball',
    wallBounces: 0, sideBounces: 0, bumped: false, ported: false, fromAbove: false,
    trip: 0, star: false, called: false, row: 0, col: 0, vein: 0,
    ...extra,
  };
}
