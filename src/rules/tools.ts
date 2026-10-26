/**
 * Outils : achetés une fois, utilisables 1 fois par Mur avant un Lancer (comme les balles spéciales).
 * Ils agissent sur le mur pour préparer une Figure.
 */
export interface ToolDef {
  kind: 'tool';
  id: string;
  name: string;
  glyph: string;
  desc: string;
  price: number;
  /** Nombre de briques à choisir sur le mur. */
  targets: number;
  /** Échange de place les briques choisies deux à deux (1re ↔ 2e, 3e ↔ 4e). */
  swap?: boolean;
  /** Les briques choisies sont pulvérisées au début du prochain Lancer (elles entrent dans la Main). */
  laser?: boolean;
}

export interface ToolInstance {
  def: ToolDef;
  used: boolean;
}

export const MAX_TOOLS = 2;

/** Briques remplacées au plus par une Défausse. */
export const DISCARD_BRICKS = 3;

export function discardDesc(n: number) {
  return `Jusqu'à {k}${n} briques{/} du mur sont remplacées par les {k}prochaines de la pioche{/} (visibles à côté de la Pioche)`;
}

/** Défausse (v3) : pas un Outil acheté, mais elle se choisit sur le mur de la même façon. */
export const DISCARD_TOOL: ToolDef = {
  kind: 'tool', id: 'defausse', name: 'Défausse', glyph: '♻', price: 0, targets: DISCARD_BRICKS,
  desc: discardDesc(DISCARD_BRICKS),
};

export const TOOLS: ToolDef[] = [
  {
    kind: 'tool', id: 'echange', name: 'Pince', glyph: '⇄', price: 4, targets: 4, swap: true,
    desc: "{k}2 échanges{/} de place entre briques du mur (1re ↔ 2e, 3e ↔ 4e) pour préparer une {k}Figure{/}",
  },
  {
    kind: 'tool', id: 'trait', name: 'Arbalète', glyph: '➶', price: 4, targets: 2, laser: true,
    desc: 'Les {k}2 briques{/} choisies sont {k}pulvérisées{/} au début du prochain Lancer et {k}entrent dans la Main{/}',
  },
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<string, ToolDef>;
