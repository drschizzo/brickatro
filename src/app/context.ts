import type { Sfx } from '../audio/sfx';
import type { Engine } from '../engine/engine';
import type { AstreDef } from '../rules/consumables';
import type { Input } from '../input';
import type { Progress } from '../meta/progress';
import type { World } from '../sim/world';
import type { Hud } from '../ui/hud';
import type { Screens } from '../ui/screens';
import type { View } from './view';

/**
 * Phases de la partie :
 * menu → (between : intro de Boss, encaissement de fin de Mur, boutique) → aim ⇄ target → play → scoring → aim…
 */
export type Phase = 'menu' | 'between' | 'aim' | 'target' | 'play' | 'scoring';

/** Transitions permises (une transition inattendue est signalée en développement). */
export const TRANSITIONS: Record<Phase, readonly Phase[]> = {
  menu: ['menu', 'between', 'aim'],
  between: ['between', 'aim', 'menu'],
  aim: ['aim', 'target', 'play', 'between', 'menu'],
  target: ['aim', 'menu'],
  play: ['scoring', 'aim', 'between', 'menu'],
  scoring: ['aim', 'between', 'menu'],
};

/**
 * Ce que les contrôleurs de la présentation partagent : le moteur, la vue, le HUD, le son, les entrées,
 * et quelques actions de la partie (Game l'implémente).
 */
export interface GameCtx {
  readonly engine: Engine;
  readonly world: World;
  readonly view: View;
  readonly hud: Hud;
  readonly screens: Screens;
  readonly sfx: Sfx;
  readonly input: Input;
  readonly progress: Progress;
  readonly phase: Phase;
  /** Génération du run : change quand on en commence ou en quitte un (les séquences asynchrones s'arrêtent). */
  readonly gen: number;
  /** Gel de la simulation (le rendu continue). */
  hitstop: number;
  setPhase(p: Phase): void;
  enterAim(): void;
  refreshHud(): void;
  refreshResources(): void;
  refreshPot(fromBrick?: boolean): void;
  updateHint(): void;
  /** Un Astre vient d'être appliqué : bandeau et Main mise à jour. */
  announceAstre(a: AstreDef): void;
}
