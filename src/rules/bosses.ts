export interface BossDef {
  id: string;
  name: string;
  glyph: string;
  color: string;
  desc: string;
  paddleMul?: number;
  speedMul?: number;
  mirror?: boolean;
  /** Ni couleur ni valeur visibles. */
  fog?: boolean;
  /** Descente du mur à chaque rebond raquette. */
  tide?: number;
  /** Une couleur au hasard ne compte plus. */
  eclipse?: boolean;
  /** Taille de la Main. */
  handSize?: number;
  /** Chaque main de poker ne rapporte qu'une fois par Mur. */
  oncePerFigure?: boolean;
  /** Une valeur imposée (tirée au hasard) doit être dans la Main. */
  requiredValue?: boolean;
  /** Toutes les rangées oscillent. */
  pendulum?: number;
  /** Motif imposé. */
  layout?: string;
  /** Ante minimale d'apparition. */
  minAnte?: number;
  /** Boss de contrôle (raquette, balle, mur qui bouge) : à partir de l'Ante COMBO_ANTE, il s'ajoute à un Boss de Main. */
  control?: boolean;
}

/** À partir de cette Ante, chaque Boss combine une contrainte sur la Main et une contrainte de contrôle. */
export const COMBO_ANTE = 5;

/** Boss pensés pour contrer une stratégie précise (comme les Boss Blinds de Balatro). */
export const BOSSES: BossDef[] = [
  { id: 'brouillard', name: 'Le Brouillard', glyph: '🙈', color: '#8f99c2', desc: 'Les briques ne montrent {k}ni couleur ni valeur{/}', fog: true },
  { id: 'silex', name: 'Le Silex', glyph: '🪨', color: '#c27a3d', desc: 'La Main ne garde que {k}4 briques{/} : ni Suite, ni Couleur, ni Full', handSize: 4, minAnte: 2 },
  { id: 'oeil', name: "L'Œil", glyph: '👀', color: '#b85cff', desc: 'Chaque {k}main de poker{/} ne rapporte qu\'{k}une seule fois{/} sur ce Mur', oncePerFigure: true, minAnte: 2 },
  { id: 'cloche', name: 'La Cloche', glyph: '🔔', color: '#ffc53d', desc: 'La {k}valeur imposée{/} doit être cassée pendant le Lancer, sinon la Main vaut 0', requiredValue: true, minAnte: 2 },
  { id: 'eclipse', name: "L'Éclipse", glyph: '🌑', color: '#555a7a', desc: 'Une couleur est {k}éteinte{/} : ses briques n\'entrent pas dans la Main', eclipse: true },
  { id: 'pendule', control: true, name: 'Le Pendule', glyph: '🕰', color: '#3fd18f', desc: 'Toutes les rangées {k}oscillent{/}', pendulum: 1.4 },
  { id: 'forteresse', name: 'La Forteresse', glyph: '🏯', color: '#9fb4ff', desc: 'Un mur truffé de {k}blocs indestructibles{/}', layout: 'forteresse', minAnte: 2 },
  { id: 'maree', control: true, name: 'La Marée', glyph: '🌊', color: '#2d9cff', desc: 'Le mur {k}descend{/} à chaque rebond sur la raquette', tide: 0.25 },
  { id: 'miroir', control: true, name: 'Le Miroir', glyph: '🔮', color: '#b85cff', desc: 'Les contrôles sont {k}inversés{/}', mirror: true },
  { id: 'nain', control: true, name: 'Le Nain', glyph: '🔨', color: '#fe5f55', desc: 'Raquette {k}35% plus petite{/}', paddleMul: 0.65 },
  { id: 'tempete', control: true, name: 'La Tempête', glyph: '💨', color: '#3fd18f', desc: 'Balle {k}30% plus rapide{/}', speedMul: 1.3 },
];

/** Tire un Boss adapté à l'Ante (différent du précédent). Dès l'Ante COMBO_ANTE : Boss de Main + Boss de contrôle. */
export function pickBoss(next: () => number, ante: number, avoid: string | null): BossDef {
  const prev = new Set(avoid?.split('+') ?? []);
  const pick = (pool: BossDef[]) => pool[Math.floor(next() * pool.length)];
  const open = BOSSES.filter((b) => (b.minAnte ?? 1) <= ante && !prev.has(b.id));
  if (ante < COMBO_ANTE) return pick(open);
  return combineBosses(pick(open.filter((b) => !b.control)), pick(open.filter((b) => b.control)));
}

export const BOSS_BY_ID = Object.fromEntries(BOSSES.map((b) => [b.id, b])) as Record<string, BossDef>;

/** Boss d'après son identifiant (« main+contrôle » pour un Boss combiné), pour reprendre un run sauvegardé. */
export function bossById(id: string): BossDef | null {
  const [a, b] = id.split('+').map((x) => BOSS_BY_ID[x]);
  if (!a) return null;
  return b ? combineBosses(a, b) : a;
}

/** Boss combiné : une contrainte sur la Main et une contrainte de contrôle. */
function combineBosses(hand: BossDef, ctrl: BossDef): BossDef {
  return {
    ...ctrl, ...hand, control: false,
    id: `${hand.id}+${ctrl.id}`,
    name: `${hand.name} & ${ctrl.name.replace(/^(Le |La |L')/, '')}`,
    glyph: hand.glyph + ctrl.glyph,
    desc: `${ctrl.desc} · ${hand.desc}`,
  };
}
