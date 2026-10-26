import type { Rng } from '../core/rng';
import type { Layout } from '../sim/world';
import { biomeOf, type BiomeId } from './biomes';

/**
 * Motifs de murs (8 rangées × 10 colonnes).
 * '.' vide · 'b' brique · '*' brique sur cible ★ (relancée) · '#' bloc indestructible
 * · 'o' bumper · 'P' / 'Q' portails reliés deux à deux
 * · 'S' interrupteur · 'G' vanne fermée · 'g' vanne ouverte (chaque interrupteur les inverse).
 */
export interface LayoutDef extends Layout {
  id: string;
  name: string;
  /** Biomes où le motif peut sortir. */
  biomes: BiomeId[];
  /** Motif signature du biome (mécanique du biome) : tiré en priorité. */
  signature?: boolean;
  /** Assez simple pour le tout premier mur. */
  starter?: boolean;
}

export const LAYOUTS: LayoutDef[] = [
  // ───────── L'Atelier (Antes 1-2) ─────────
  {
    id: 'classique', name: 'Classique', biomes: ['atelier'], starter: true,
    rows: ['..........', 'bbbbbbbbbb', 'bbbb**bbbb', 'bbbbbbbbbb', '..........', '..........', '..........', '..........'],
  },
  {
    id: 'pyramide', name: 'Pyramide', biomes: ['atelier'], starter: true,
    rows: ['....**....', '...bbbb...', '..bbbbbb..', '.bbbbbbbb.', 'bbbbbbbbbb', '..........', '..........', '..........'],
  },
  {
    id: 'damier', name: 'Damier', biomes: ['atelier'], starter: true,
    rows: ['b.b.b.b.b.', '.b.b.b.b.b', 'b.b.*.b.b.', '.b.b.*.b.b', 'b.b.b.b.b.', '.b.b.b.b.b', '..........', '..........'],
  },
  {
    id: 'colonnes', name: 'Colonnes', biomes: ['atelier'], starter: true,
    rows: ['bb..bb..bb', 'bb..bb..bb', 'bb..**..bb', 'bb..bb..bb', 'bb..bb..bb', '..........', '..........', '..........'],
  },
  {
    id: 'diamant', name: 'Diamant', biomes: ['atelier'],
    rows: ['....bb....', '...bbbb...', '..bb**bb..', '.bbbbbbbb.', '..bbbbbb..', '...bbbb...', '....bb....', '..........'],
  },
  {
    id: 'cage', name: 'La Cage', biomes: ['atelier', 'abime'],
    rows: ['##########', '#bbbbbbbb#', '#bb*bb*bb#', '#bbbbbbbb#', '###....###', '..........', '..........', '..........'],
  },
  {
    id: 'rempart', name: 'Rempart', biomes: ['atelier', 'fonderie'],
    rows: ['bbbbbbbbbb', 'bbbb**bbbb', 'bbbbbbbbbb', '..........', '##..##..##', '..........', '..........', '..........'],
  },
  {
    id: 'flipper', name: 'Flipper', biomes: ['atelier', 'fonderie'],
    rows: ['.bbbbbbbb.', '.bbb**bbb.', '.bbbbbbbb.', '..........', '..o....o..', '....o.....', '..........', '..........'],
  },
  // ───────── La Fonderie (Antes 3-4) : tapis roulants ─────────
  {
    id: 'tapis', name: 'Tapis roulant', biomes: ['fonderie'],
    rows: ['..........', 'bbbbbbbb..', '..bb**bbbb', 'bbbbbbbb..', '..........', '..........', '..........', '..........'],
    moving: [0, 1.3, 1.3, 1.3, 0, 0, 0, 0],
  },
  {
    id: 'convoyeur', name: 'Convoyeur', biomes: ['fonderie'], signature: true,
    rows: ['bbbbbbbbbb', 'bbb..bbb..', '..........', '..bbb..bbb', 'bbbb**bbbb', '..........', '..........', '..........'],
    belts: [0, 1.4, 0, -1.4, 0, 0, 0, 0],
  },
  {
    id: 'laminoir', name: 'Laminoir', biomes: ['fonderie'], signature: true,
    rows: ['bbbbbbbbbb', '.bb.bb.bb.', 'b..b**b..b', '.bb.bb.bb.', '..........', '..........', '..........', '..........'],
    belts: [0, 1.1, -1.7, 1.1, 0, 0, 0, 0],
  },
  {
    id: 'chaine', name: 'Chaîne de montage', biomes: ['fonderie'], signature: true,
    rows: ['..........', 'bbbb..bbbb', '..........', 'b**b..bbbb', '..........', 'bbbb..bbbb', '..........', '..........'],
    belts: [0, -0.9, 0, 1.5, 0, -2.1, 0, 0],
  },
  {
    id: 'portails', name: 'Portails', biomes: ['fonderie', 'observatoire'],
    rows: ['P........Q', 'bbbbbbbbbb', 'bbbb**bbbb', 'bbbbbbbbbb', '####..####', '..........', 'Q........P', '..........'],
  },
  // ───────── L'Observatoire (Antes 5-6) : gravité ─────────
  {
    id: 'sablier', name: 'Sablier', biomes: ['observatoire'], signature: true, gravity: true,
    rows: ['bbbbbbbbbb', '.bbbbbbbb.', '..bb**bb..', '...#..#...', '..bbbbbb..', '.bbbbbbbb.', '..........', '..........'],
  },
  {
    id: 'eboulis', name: 'Éboulis', biomes: ['observatoire'], signature: true, gravity: true,
    rows: ['bbbbbbbbbb', 'bbbbbbbbbb', 'bbbb**bbbb', 'bbbbbbbbbb', 'bbbbbbbbbb', '..........', '..........', '..........'],
  },
  {
    id: 'stalactites', name: 'Stalactites', biomes: ['observatoire'], signature: true, gravity: true,
    rows: ['##########', 'bbbbbbbbbb', 'b.bb**bb.b', 'b.bbbbbb.b', 'b..bbbb..b', '...b..b...', '..........', '..........'],
  },
  {
    id: 'spirale', name: 'Spirale', biomes: ['observatoire', 'abime'],
    rows: ['bbbbbbbbbb', '.........b', 'bbbbbbb..b', 'b....*b..b', 'b.bb*bb..b', 'b........b', 'bbbbbbbbbb', '..........'],
  },
  {
    id: 'arche', name: "L'Arche", biomes: ['observatoire', 'abime'],
    rows: ['bbbbbbbbbb', 'bb......bb', 'bb.o**o.bb', 'bb......bb', 'bb######bb', '..........', '..........', '..........'],
  },
  // ───────── L'Abîme (Antes 7-8) : interrupteurs et vannes ─────────
  {
    id: 'ecluse', name: 'Écluse', biomes: ['abime'], signature: true,
    rows: ['#S......S#', '#bbbbbbbb#', '#bb*bb*bb#', '#bbbbbbbb#', '#gggggggg#', '..........', '..........', '..........'],
  },
  {
    id: 'coffre', name: 'Le Coffre', biomes: ['abime'], signature: true,
    rows: ['bbbbbbbbbb', '.GGGGGGGG.', '.GbbbbbbG.', '.Gbb**bbG.', '.GbbbbbbG.', '.gggSSggg.', '..........', '..........'],
  },
  {
    id: 'alternance', name: 'Alternance', biomes: ['abime'], signature: true,
    rows: ['bbbbbbbbbb', 'bbbb**bbbb', 'bbbbbbbbbb', 'GgGgGgGgGg', 'bbbbbbbbbb', 'gGgGgGgGgG', '..........', 'S........S'],
  },
  {
    id: 'forteresse', name: 'Forteresse', biomes: ['abime'],
    rows: ['bbbbbbbbbb', 'b##b**b##b', 'bbbbbbbbbb', '#.#.##.#.#', '..........', '...o..o...', '..........', '..........'],
  },
];

export const LAYOUT_BY_ID = Object.fromEntries(LAYOUTS.map((l) => [l.id, l])) as Record<string, LayoutDef>;

/** Motif du biome de l'Ante : la mécanique du biome sort 60 % du temps, le tout premier mur reste simple. */
export function pickLayout(rng: Rng, ante: number, wallIdx: number, avoid: string | null): LayoutDef {
  const biome = biomeOf(ante).id;
  const first = ante === 1 && wallIdx === 0;
  const pool = LAYOUTS.filter((l) => l.biomes.includes(biome) && l.id !== avoid && (!first || l.starter));
  const sig = pool.filter((l) => l.signature);
  return rng.pick(sig.length && rng.next() < 0.6 ? sig : pool);
}
