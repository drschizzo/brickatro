import type { BrickCard, BrickColor, Enh } from './bricks';
import type { FigureId } from './figures';

export interface RuneDef {
  kind: 'rune';
  id: string;
  name: string;
  glyph: string;
  desc: string;
  /** Nombre de briques à cibler sur le mur (0 = effet immédiat). */
  targets: number;
  enh?: Enh;
  color?: BrickColor;
  destroy?: boolean;
  duplicate?: boolean;
  /** +n à la valeur (max 10). */
  valueUp?: number;
  /** La 1re brique choisie devient une copie de la 2e. */
  convert?: boolean;
  doubleMoney?: number;
  /** Multiballe : la balle se divise en n+1 au prochain Lancer. */
  split?: number;
  /** Défausses en plus pour ce Mur (règles v3). */
  discards?: number;
}

export interface AstreDef {
  kind: 'astre';
  id: string;
  name: string;
  glyph: string;
  figure: FigureId;
  desc: string;
}

export type ConsumableDef = RuneDef | AstreDef;

export const RUNES: RuneDef[] = [
  { kind: 'rune', id: 'r-verre', name: 'Rune du Verre', glyph: 'ᚷ', desc: '2 briques deviennent {k}Verre{/}', targets: 2, enh: 'verre' },
  { kind: 'rune', id: 'r-or', name: "Rune de l'Or", glyph: 'ᚠ', desc: '2 briques deviennent {k}Or{/}', targets: 2, enh: 'or' },
  { kind: 'rune', id: 'r-acier', name: "Rune d'Acier", glyph: 'ᛁ', desc: '2 briques deviennent {k}Acier{/}', targets: 2, enh: 'acier' },
  { kind: 'rune', id: 'r-bombe', name: 'Rune Explosive', glyph: 'ᚺ', desc: '1 brique devient {k}Bombe{/}', targets: 1, enh: 'bombe' },
  { kind: 'rune', id: 'r-chance', name: 'Rune de Chance', glyph: 'ᛃ', desc: '2 briques deviennent {k}Chance{/}', targets: 2, enh: 'chance' },
  { kind: 'rune', id: 'r-bonus', name: 'Rune du Bonus', glyph: 'ᛒ', desc: '2 briques deviennent {k}Bonus{/}', targets: 2, enh: 'bonus' },
  { kind: 'rune', id: 'r-mult', name: 'Rune du Mult', glyph: 'ᛗ', desc: '2 briques deviennent {k}Mult{/}', targets: 2, enh: 'mult' },
  { kind: 'rune', id: 'r-pierre', name: 'Rune de Pierre', glyph: 'ᛟ', desc: '1 brique devient {k}Pierre{/}', targets: 1, enh: 'pierre' },
  { kind: 'rune', id: 'r-feu', name: 'Rune du Feu', glyph: 'ᚲ', desc: '3 briques deviennent {feu}Feu{/} (rouges), pour toujours. Utile pour viser une {k}Couleur{/} et nourrir les Reliques {feu}Feu{/}', targets: 3, color: 0 },
  { kind: 'rune', id: 'r-eau', name: "Rune de l'Eau", glyph: 'ᛚ', desc: '3 briques deviennent {eau}Eau{/} (bleues), pour toujours. Utile pour viser une {k}Couleur{/} et nourrir les Reliques {eau}Eau{/}', targets: 3, color: 1 },
  { kind: 'rune', id: 'r-foudre', name: 'Rune de la Foudre', glyph: 'ᛊ', desc: '3 briques deviennent {foudre}Foudre{/} (jaunes), pour toujours. Utile pour viser une {k}Couleur{/} et nourrir les Reliques {foudre}Foudre{/}', targets: 3, color: 2 },
  { kind: 'rune', id: 'r-terre', name: 'Rune de la Terre', glyph: 'ᛞ', desc: '3 briques deviennent {terre}Terre{/} (vertes), pour toujours. Utile pour viser une {k}Couleur{/} et nourrir les Reliques {terre}Terre{/}', targets: 3, color: 3 },
  { kind: 'rune', id: 'r-mort', name: 'Rune de la Mort', glyph: 'ᛉ', desc: '{k}Détruit{/} 2 briques de ton deck', targets: 2, destroy: true },
  { kind: 'rune', id: 'r-reflet', name: 'Rune du Reflet', glyph: 'ᛜ', desc: '{k}Duplique{/} 1 brique dans ton deck', targets: 1, duplicate: true },
  { kind: 'rune', id: 'r-force', name: 'Rune de Force', glyph: 'ᚢ', desc: '{k}+1 valeur{/} à 2 briques (max 10)', targets: 2, valueUp: 1 },
  { kind: 'rune', id: 'r-mue', name: 'Rune de la Mue', glyph: 'ᛇ', desc: 'La {k}1re brique{/} choisie devient une {k}copie{/} de la 2e', targets: 2, convert: true },
  { kind: 'rune', id: 'r-scission', name: 'Rune de Scission', glyph: 'ᛥ', desc: 'Au {k}prochain Lancer{/}, la balle se {k}divise en 3{/}. Tant qu\'une balle vole, la Main vit', targets: 0, split: 2 },
  { kind: 'rune', id: 'r-reine', name: 'Rune de la Reine', glyph: '♛', desc: '1 brique devient {k}Reine{/} : elle pond une brique à chaque Lancer', targets: 1, enh: 'reine' },
  { kind: 'rune', id: 'r-pinata', name: 'Rune Piñata', glyph: '🪅', desc: '1 brique devient {k}Piñata{/} : 3 coups pour la casser, puis {g}$3{/} et une balle bonus', targets: 1, enh: 'pinata' },
  { kind: 'rune', id: 'r-tri', name: 'Rune du Tri', glyph: 'ᛏ', desc: '{k}+2 Défausses{/} pour ce Mur', targets: 0, discards: 2 },
  { kind: 'rune', id: 'r-ermite', name: "Rune de l'Ermite", glyph: 'ᚾ', desc: '{k}Double{/} ton argent (max {g}+$20{/})', targets: 0, doubleMoney: 20 },
];

export const ASTRES: AstreDef[] = [
  { kind: 'astre', id: 'a-pluton', name: 'Pluton', glyph: '♇', figure: 'haute', desc: '{k}Brique haute{/} +1 niveau ({c}+10{/} / {m}+1{/})' },
  { kind: 'astre', id: 'a-mercure', name: 'Mercure', glyph: '☿', figure: 'paire', desc: '{k}Paire{/} +1 niveau ({c}+15{/} / {m}+1{/})' },
  { kind: 'astre', id: 'a-uranus', name: 'Uranus', glyph: '♅', figure: 'doublepaire', desc: '{k}Double paire{/} +1 niveau ({c}+20{/} / {m}+1{/})' },
  { kind: 'astre', id: 'a-venus', name: 'Vénus', glyph: '♀', figure: 'brelan', desc: '{k}Brelan{/} +1 niveau ({c}+20{/} / {m}+2{/})' },
  { kind: 'astre', id: 'a-saturne', name: 'Saturne', glyph: '♄', figure: 'suite', desc: '{k}Suite{/} +1 niveau ({c}+30{/} / {m}+3{/})' },
  { kind: 'astre', id: 'a-jupiter', name: 'Jupiter', glyph: '♃', figure: 'couleur', desc: '{k}Couleur{/} +1 niveau ({c}+15{/} / {m}+2{/})' },
  { kind: 'astre', id: 'a-terre', name: 'Terre', glyph: '🜨', figure: 'full', desc: '{k}Full{/} +1 niveau ({c}+25{/} / {m}+2{/})' },
  { kind: 'astre', id: 'a-mars', name: 'Mars', glyph: '♂', figure: 'carre', desc: '{k}Carré{/} +1 niveau ({c}+30{/} / {m}+3{/})' },
  { kind: 'astre', id: 'a-neptune', name: 'Neptune', glyph: '♆', figure: 'quinteflush', desc: '{k}Quinte flush{/} +1 niveau ({c}+40{/} / {m}+4{/})' },
];

export const CONSUMABLE_PRICE = 3;
export const MAX_CONSUMABLES = 2;

export function applyRune(rune: RuneDef, cards: BrickCard[]) {
  if (rune.convert && cards.length >= 2) {
    const [a, b] = cards;
    a.color = b.color;
    a.value = b.value;
    a.enh = b.enh;
    a.edition = b.edition;
    return;
  }
  for (const c of cards) {
    if (rune.enh) c.enh = rune.enh;
    if (rune.color !== undefined) c.color = rune.color;
    if (rune.valueUp) c.value = Math.min(10, c.value + rune.valueUp);
  }
}
