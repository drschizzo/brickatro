import type { Run } from './run';
import type { PackKind } from './shop';

/** Récompense pour avoir passé un Petit ou un Grand Mur (comme les Skip de Balatro). */
export interface SkipReward {
  id: 'cash' | PackKind;
  name: string;
  glyph: string;
  desc: string;
  money?: number;
  pack?: PackKind;
}

export function rollSkip(run: Run): SkipReward {
  const money = 6 + run.ante;
  const pool: SkipReward[] = [
    { id: 'cash', name: 'Prime', glyph: '💰', desc: `{g}+$${money}{/} tout de suite`, money },
    { id: 'astres', name: "Pack d'Astres offert", glyph: '🪐', desc: '1 Astre parmi 3', pack: 'astres' },
    { id: 'runes', name: 'Pack de Runes offert', glyph: '📜', desc: '1 Rune parmi 3', pack: 'runes' },
    { id: 'briques', name: 'Pack de Briques offert', glyph: '🧱', desc: '1 brique enchantée parmi 3', pack: 'briques' },
  ];
  return run.rng.pick(pool);
}
