/**
 * Biomes : toutes les 2 Antes, le décor et la famille de mécaniques changent.
 * Chaque biome a ses motifs « signature » (voir layouts.ts) et sa teinte.
 */
export type BiomeId = 'atelier' | 'fonderie' | 'observatoire' | 'abime';

export interface BiomeDef {
  id: BiomeId;
  name: string;
  /** Mécanique mise en avant (bandeau d'entrée). */
  tagline: string;
  /** Décalage de teinte de la nébuleuse (0 = bleu nuit). */
  hue: number;
  /** Couleur des rails du cadre. */
  rail: string;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  atelier: { id: 'atelier', name: "L'Atelier", tagline: 'Les bases du métier', hue: 0, rail: '#4d73ff' },
  fonderie: { id: 'fonderie', name: 'La Fonderie', tagline: 'Tapis roulants : attends que la rangée s\'aligne', hue: 0.42, rail: '#ff8a3d' },
  observatoire: { id: 'observatoire', name: "L'Observatoire", tagline: 'Gravité : les briques tombent dans les trous', hue: 0.2, rail: '#b36bff' },
  abime: { id: 'abime', name: "L'Abîme", tagline: 'Interrupteurs : ferme les vannes pour enfermer la balle avec les briques', hue: 0.78, rail: '#2fe0b0' },
};

const ORDER: BiomeId[] = ['atelier', 'fonderie', 'observatoire', 'abime'];

/** Biome d'une Ante (au-delà de l'Ante 8, on reboucle). */
export const biomeOf = (ante: number): BiomeDef => BIOMES[ORDER[Math.floor((ante - 1) / 2) % ORDER.length]];
