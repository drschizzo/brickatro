import { isColorless, type BrickCard } from './bricks';
import type { Run } from './run';

/**
 * L'Atelier (boutique, règles v3) : on sculpte son deck pour que les briques atteignables
 * servent les Figures qu'on vise.
 * - Retirer une brique du deck : plus cher à chaque fois, le deck garde au moins ATELIER_MIN_DECK briques
 *   (en dessous, les murs se vident).
 * - Retailler : ±1 à la valeur d'une brique (1 à 10). Pas de valeur libre : c'est un petit casse-tête, pas un Joker.
 * Un seul service de chaque par visite de boutique.
 */
export const ATELIER_MIN_DECK = 28;
export const RETAIL_PRICE = 1;
export const removePrice = (run: Run) => 2 + Math.floor(run.removals / 2);

export interface AtelierVisit {
  removed: boolean;
  retailed: boolean;
}

export const canRemove = (run: Run, visit: AtelierVisit) =>
  !visit.removed && run.cards.length > ATELIER_MIN_DECK && run.money >= removePrice(run);

export const canRetail = (run: Run, visit: AtelierVisit, card: BrickCard | undefined, delta: number) =>
  !visit.retailed && run.money >= RETAIL_PRICE && !!card && !isColorless(card) && card.value + delta >= 1 && card.value + delta <= 10;
