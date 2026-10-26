import { ANTE_BASE, ANTE_BASE_V3 } from './decks';
import { DEFAULT_WALL_STYLE, type WallStyleCfg } from './veins';

export type RulesetId = 'classic' | 'v3';

/**
 * Jeu de règles d'un run : figé au début du run et lu partout (moteur, boutique, HUD, banc).
 * C'est la seule source de vérité : aucun réglage de règles ne vit ailleurs.
 */
export interface Rules {
  readonly id: RulesetId;
  /** Une carte par trajet : seule une brique touchée entre dans la Main, les autres sont des Éclats. */
  readonly headRule: boolean;
  /**
   * 'first' : la 1re brique touchée du trajet entre dans la Main.
   * 'best'  : à la fin du trajet (renvoi ou encaissement), la meilleure brique cassée par la balle entre dans la Main.
   */
  readonly headMode: 'first' | 'best';
  /** Jetons d'un Éclat, en part de la valeur de la brique. */
  readonly shardRate: number;
  /** Suite et Couleur à 4 briques. */
  readonly shortFigures: boolean;
  /** Jokers posés sur le front du mur à chaque pose. */
  readonly jokersPerWall: number;
  /** Défausses par Mur (0 = pas de Défausse, et les bonus de Défausse ne s'appliquent pas). */
  readonly discardsPerWall: number;
  /** Commandes à chaque Mur. */
  readonly orders: boolean;
  /** Économie resserrée : récompenses réduites, boutique plus chère et moins garnie, Lancer de secours payant. */
  readonly tightEconomy: boolean;
  /** Atelier en boutique (retirer / retailler des briques du deck). */
  readonly atelier: boolean;
  /** Objectifs de base par Ante, et échelle supplémentaire (banc). */
  readonly anteBase: readonly number[];
  readonly targetScale: number;
  /** Pose des briques. */
  readonly wallStyle: Readonly<WallStyleCfg>;
}

const deepFreeze = <T extends object>(o: T): T => {
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return Object.freeze(o);
};

export const RULESETS: Record<RulesetId, Rules> = {
  /** Règles d'origine : la Main garde les 5 meilleures briques cassées, Filons, économie d'origine. */
  classic: deepFreeze({
    id: 'classic', headRule: false, headMode: 'first', shardRate: 0.5, shortFigures: false,
    jokersPerWall: 0, discardsPerWall: 0, orders: false, tightEconomy: false, atelier: false,
    anteBase: ANTE_BASE, targetScale: 1, wallStyle: { ...DEFAULT_WALL_STYLE },
  }),
  /**
   * Une carte par trajet (la meilleure brique cassée par la balle), les autres sont des Éclats ;
   * Suite et Couleur à 4 ; 1 Joker sur le front du mur ; Commandes ; économie resserrée ; Atelier.
   * Les Filons ne pilotaient pas les Figures (banc) : les Commandes les remplacent.
   */
  v3: deepFreeze({
    id: 'v3', headRule: true, headMode: 'best', shardRate: 0.5, shortFigures: true,
    jokersPerWall: 1, discardsPerWall: 2, orders: true, tightEconomy: true, atelier: true,
    anteBase: ANTE_BASE_V3, targetScale: 1, wallStyle: { ...DEFAULT_WALL_STYLE, style: 'random' },
  }),
};

/** Un jeu de règles avec des surcharges (banc, prototypes), figé lui aussi. */
export function makeRules(base: RulesetId, overrides: Partial<Omit<Rules, 'id'>> = {}): Rules {
  return deepFreeze({ ...RULESETS[base], ...overrides, wallStyle: { ...(overrides.wallStyle ?? RULESETS[base].wallStyle) } });
}

/** Les Filons existent-ils avec ces règles (Cartographe, affichage) ? */
export const hasVeins = (r: Rules) => r.wallStyle.style !== 'random' && r.wallStyle.style !== 'sorted';
