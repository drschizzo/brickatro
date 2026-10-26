export interface BallDef {
  id: string;
  name: string;
  glyph: string;
  desc: string;
  price: number;
  pierce?: number;
  wrap?: boolean;
  noSpeedGain?: boolean;
  /** $ par brique cassée */
  money?: number;
  /** Mult ajouté au Pot à chaque rebond sur un mur */
  wallMult?: number;
}

/** Le sac de balles : la Standard est illimitée, les spéciales servent 1 fois par Mur. */
export const BALLS: BallDef[] = [
  { id: 'standard', name: 'Standard', glyph: '●', desc: 'La balle de base. Illimitée.', price: 0 },
  { id: 'lourde', name: 'Lourde', glyph: '⬤', desc: '{k}Traverse 3 briques{/} par trajet sans rebondir', price: 6, pierce: 3 },
  { id: 'comete', name: 'Comète', glyph: '☄', desc: 'Sa vitesse {k}n\'augmente jamais{/}', price: 5, noSpeedGain: true },
  { id: 'doree', name: 'Dorée', glyph: '🟡', desc: '{g}+$1{/} par brique cassée', price: 6, money: 1 },
  { id: 'fantome', name: 'Fantôme', glyph: '👻', desc: '{k}Traverse les murs latéraux{/} (réapparaît de l\'autre côté)', price: 5, wrap: true },
  { id: 'rebond', name: 'Ressort', glyph: '🌀', desc: '{m}+1 Mult{/} à chaque rebond sur un mur', price: 6, wallMult: 1 },
];

export const BALL_BY_ID = Object.fromEntries(BALLS.map((b) => [b.id, b])) as Record<string, BallDef>;
