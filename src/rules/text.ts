/**
 * Mini-markup des descriptions, façon Balatro : les mots-clés sont colorés pour que
 * les synergies sautent aux yeux. {m}+3 Mult{/} {c}+30 Jetons{/} {x}×2 Mult{/} {g}$3{/}
 * {feu}Feu{/} {eau}Eau{/} {foudre}Foudre{/} {terre}Terre{/} {k}mot-clé{/}
 */
export const rich = (s: string) => s.replace(/\{(\w+)\}(.*?)\{\/\}/g, '<span class="t-$1">$2</span>');
export const plain = (s: string) => s.replace(/\{(\w+)\}(.*?)\{\/\}/g, '$2');
