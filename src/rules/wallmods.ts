import type { Run } from './run';

/**
 * Murs maudits : en boutique, on peut accepter une malédiction sur le prochain Mur (pas un Boss)
 * contre une récompense versée si on le brise. Le joueur choisit son chaos, il ne le subit pas.
 */
export interface WallModDef {
  id: string;
  name: string;
  glyph: string;
  desc: string;
  /** Les briques ne se voient qu'autour de la balle. */
  dark?: boolean;
  /** Descente du mur à chaque renvoi (comme La Marée). */
  tide?: number;
  speedMul?: number;
  paddleMul?: number;
  /** Nombre de briques du mur qui deviennent vivantes (pour ce Mur). */
  living?: number;
  /** Toutes les briques résistent à un coup. */
  armored?: boolean;
}

export interface WallModReward {
  kind: 'money' | 'relic';
  money?: number;
  label: string;
}

export interface WallModOffer {
  mod: WallModDef;
  reward: WallModReward;
}

export const WALL_MODS: WallModDef[] = [
  { id: 'nuit', name: 'Nuit noire', glyph: '🌘', desc: 'Les briques ne se voient qu\'{k}autour de la balle{/}', dark: true },
  { id: 'crue', name: 'La Crue', glyph: '🌊', desc: 'Le mur {k}descend{/} à chaque renvoi', tide: 0.3 },
  { id: 'blinde', name: 'Mur blindé', glyph: '🛡', desc: 'Toutes les briques {k}résistent à un coup{/}', armored: true },
  { id: 'vivant', name: 'Mur vivant', glyph: '🐛', desc: '{k}8 briques{/} deviennent vivantes : Mimic, Reine, Fuyarde, Piñata', living: 8 },
  { id: 'vent', name: 'Vent fou', glyph: '🌪', desc: 'Balle {k}25% plus rapide{/}', speedMul: 1.25 },
  { id: 'etau', name: 'L\'Étau', glyph: '🗜', desc: 'Raquette {k}30% plus petite{/}', paddleMul: 0.7 },
];

export function rollWallMod(run: Run): WallModOffer {
  const mod = run.rng.pick(WALL_MODS);
  const money = 6 + run.ante * 2;
  const reward: WallModReward = run.rng.next() < 0.5
    ? { kind: 'relic', label: 'une {k}Relique rare{/} au choix' }
    : { kind: 'money', money, label: `{g}+$${money}{/}` };
  return { mod, reward };
}
