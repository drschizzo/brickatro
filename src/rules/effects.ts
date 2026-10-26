import type { BrickCard, BrickColor, Enh } from './bricks';
import type { Pot } from './pot';
import type { Run } from './run';
import type { Brick, BreakCause, World } from '../sim/world';

/**
 * Ce que les effets (Reliques, briques enchantées ou vivantes) peuvent faire sur le Mur en cours.
 * Implémenté par le moteur : un nouvel effet s'écrit dans sa définition, sans toucher au moteur.
 */
export interface EffectApi {
  readonly run: Run;
  readonly world: World;
  readonly pot: Pot;
  /** Carte posée dans un emplacement du mur (copie limitée au Mur comprise). */
  card(uid: number): BrickCard | undefined;
  /**
   * Copie de carte limitée à ce Mur : la brique change (valeur, couleur, enchantement…) mais le deck ne change pas.
   * `place` repose la brique (points de vie compris) ; sinon seule la carte change.
   */
  patchCard(brick: Brick, patch: Partial<Omit<BrickCard, 'uid'>>, place?: boolean): BrickCard;
  /** Voisine la plus proche de chaque côté dans la rangée, à 2 cases au plus (un bloc arrête la recherche). */
  rowNeighbors(brick: Brick): Brick[];
  /** Emplacements voisins (décalages rangée / colonne, dans cet ordre), dans les limites du mur. */
  around(brick: Brick, offsets: readonly Offset[]): number[];
  /** Casse un emplacement après un court délai (explosion). */
  explode(slot: number, delay: number): void;
  /** Emplacements libres où une brique peut apparaître (loin des bumpers, portails et balles). */
  freeSlots(): number[];
  /** Pose une brique temporaire (pour ce Mur seulement). */
  spawnTemp(slot: number, color: BrickColor, value: number, enh?: Enh): void;
  /** Événements du moteur (pour le rendu). */
  spawned(ids: number[]): void;
  painted(ids: number[], color: BrickColor): void;
  morphed(ids: number[]): void;
  fled(from: number, to: number): void;
  relicLost(index: number): void;
  /** Les emplacements visés par l'Arbalète suivent une brique qui se déplace. */
  movedSlot(from: number, to: number): void;
}

/** Une brique vient de casser (règles déjà appliquées : Main ou Éclat). */
export interface BreakInfo {
  brick: Brick;
  card: BrickCard;
  cause: BreakCause;
  /** Argent gagné et étiquettes affichées, que l'effet peut compléter. */
  money: number;
  tags: string[];
  /** La brique a explosé (Bombe) : le rendu fait trembler. */
  bomb: boolean;
}

export type Offset = readonly [row: number, col: number];
/** Les 8 cases autour, rangée par rangée. */
export const RING: readonly Offset[] = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
/** Les 4 cases en croix. */
export const CROSS: readonly Offset[] = RING.filter(([r, c]) => !r || !c);

/** Délai d'une explosion de Bombe (secondes de jeu). */
export const BOMB_DELAY = 0.08;
