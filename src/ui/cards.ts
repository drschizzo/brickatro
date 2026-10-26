import { EDITION, ENH, cardLabel, colorText, isColorless, type BrickCard, type BrickColor } from '../rules/bricks';
import type { BallDef } from '../rules/balls';
import type { ConsumableDef } from '../rules/consumables';
import { DISCARD_BRICKS, discardDesc, type ToolDef } from '../rules/tools';
import { ARCHETYPE_NAMES, type Archetype, type RelicDef, type RelicInstance } from '../rules/relics';
import { PACKS, type PackKind } from '../rules/shop';
import { rich } from '../rules/text';
import { BRICK_CSS } from '../render/palette';

const tagsHtml = (tags: Archetype[], owned?: Set<Archetype>) =>
  `<div class="tags">${tags.map((t) => `<span class="tag ${owned?.has(t) ? 'on' : ''}">${ARCHETYPE_NAMES[t]}</span>`).join('')}</div>`;

/** Petite carte (HUD) avec infobulle. */
const POLY_TXT = '<br><span class="t-poly">Polychrome</span> : ' + rich('{x}×1.5 Mult{/} en plus');

export function relicSmall(r: RelicInstance, i: number) {
  return `<div class="card ${r.def.rarity} ${r.poly ? 'poly' : ''}" data-i="${i}" style="--d:${(i * 0.12).toFixed(2)}s">
    <div class="g">${r.def.glyph}</div><div class="n">${r.def.name}</div>
    <div class="tip"><b class="tn">${r.def.name}</b>${rich(r.def.desc(r))}${r.poly ? POLY_TXT : ''}${tagsHtml(r.def.tags)}</div>
  </div>`;
}

export function consumableSmall(c: ConsumableDef, i: number, usable: boolean) {
  return `<div class="card ${c.kind} ${usable ? 'usable' : ''}" data-i="${i}" style="--d:${(i * 0.15).toFixed(2)}s">
    <div class="g">${c.glyph}</div><div class="n">${c.name}</div>
    <div class="tip"><b class="tn">${c.name}</b>${rich(c.desc)}${usable ? '<br><br><span class="t-k">Clic : utiliser</span>' : c.kind === 'rune' ? '<br><br>Utilisable avant un Lancer' : ''}</div>
  </div>`;
}

export function ballSmall(b: BallDef, i: number, selected: boolean, used: boolean) {
  return `<div class="card ball usable ${selected ? 'selected' : ''} ${used ? 'used' : ''}" data-i="${i}" style="--d:${(i * 0.1).toFixed(2)}s">
    <div class="g">${b.glyph}</div>
    <div class="tip"><b class="tn">Balle ${b.name} <span class="t-k">[${i + 1}]</span></b>${rich(b.desc)}${i > 0 ? '<br>1 utilisation par Mur.' : ''}</div>
  </div>`;
}

export function toolSmall(t: ToolDef, i: number, usable: boolean, used: boolean) {
  return `<div class="card tool ${usable && !used ? 'usable' : ''} ${used ? 'used' : ''}" data-i="${i}" style="--d:${(i * 0.1).toFixed(2)}s">
    <div class="g">${t.glyph}</div>
    <div class="tip"><b class="tn">${t.name}</b>${rich(t.desc)}<br><br>${used ? 'Déjà utilisé sur ce Mur.' : usable ? '<span class="t-k">Clic : utiliser</span> (1 fois par Mur)' : '1 fois par Mur, avant un Lancer.'}</div>
  </div>`;
}

/** Défausse : toujours en tête des Outils, avec le nombre restant pour ce Mur. */
export function discardSmall(left: number, max: number, usable: boolean, size = DISCARD_BRICKS) {
  const on = usable && left > 0;
  return `<div class="card tool discard ${on ? 'usable' : ''} ${left <= 0 ? 'used' : ''}" data-i="-1">
    <div class="g">♻</div><span class="cnt">${left}/${max}</span>
    <div class="tip"><b class="tn">Défausse</b>${rich(discardDesc(size))}<br><br>${left <= 0 ? 'Plus de Défausse sur ce Mur.' : on ? `<span class="t-k">Clic</span> ou <kbd>R</kbd> : défausser (${left} restante${left > 1 ? 's' : ''} sur ce Mur)` : `${max} par Mur, avant un Lancer.`}</div>
  </div>`;
}

/** Grande carte (boutique, choix, collection). */
export function relicBig(def: RelicDef, i: number, opts: { price?: number; poor?: boolean; owned?: Set<Archetype>; poly?: boolean } = {}) {
  return `<div class="bigcard ${def.rarity} ${opts.poor ? 'poor' : ''} ${opts.poly ? 'poly' : ''}" data-i="${i}" style="--d:${(i * 0.08).toFixed(2)}s">
    ${opts.price !== undefined ? `<div class="price">$${opts.price}</div>` : ''}
    <div class="g">${def.glyph}</div><div class="n">${def.name}</div>
    <div class="desc">${rich(def.desc({ def, counter: 0 }))}${opts.poly ? POLY_TXT : ''}</div>
    ${tagsHtml(def.tags, opts.owned)}
    <div class="rar">${opts.poly ? 'polychrome · ' : ''}${def.rarity}</div>
  </div>`;
}

export function consumableBig(c: ConsumableDef, i: number, opts: { price?: number; poor?: boolean } = {}) {
  return `<div class="bigcard ${c.kind} ${opts.poor ? 'poor' : ''}" data-i="${i}" style="--d:${(i * 0.08).toFixed(2)}s">
    ${opts.price !== undefined ? `<div class="price">$${opts.price}</div>` : ''}
    <div class="g">${c.glyph}</div><div class="n">${c.name}</div>
    <div class="desc">${rich(c.desc)}</div>
    <div class="rar">${c.kind === 'rune' ? 'Rune' : 'Astre'}</div>
  </div>`;
}

export function ballBig(b: BallDef, i: number, opts: { price?: number; poor?: boolean } = {}) {
  return `<div class="bigcard ball ${opts.poor ? 'poor' : ''}" data-i="${i}" style="--d:${(i * 0.08).toFixed(2)}s">
    ${opts.price !== undefined ? `<div class="price">$${opts.price}</div>` : ''}
    <div class="g">${b.glyph}</div><div class="n">Balle ${b.name}</div>
    <div class="desc">${rich(b.desc)}<br>1 utilisation par Mur.</div>
    <div class="rar">Balle</div>
  </div>`;
}

export function toolBig(t: ToolDef, i: number, opts: { price?: number; poor?: boolean } = {}) {
  return `<div class="bigcard tool ${opts.poor ? 'poor' : ''}" data-i="${i}" style="--d:${(i * 0.08).toFixed(2)}s">
    ${opts.price !== undefined ? `<div class="price">$${opts.price}</div>` : ''}
    <div class="g">${t.glyph}</div><div class="n">${t.name}</div>
    <div class="desc">${rich(t.desc)}<br>${rich('{k}1 fois par Mur{/}')}</div>
    <div class="rar">Outil</div>
  </div>`;
}

export function packBig(kind: PackKind, i: number, opts: { price?: number; poor?: boolean } = {}) {
  const p = PACKS[kind];
  return `<div class="bigcard pack ${opts.poor ? 'poor' : ''}" data-i="${i}" style="--d:${(i * 0.08).toFixed(2)}s">
    ${opts.price !== undefined ? `<div class="price">$${opts.price}</div>` : ''}
    <div class="g">${p.glyph}</div><div class="n">${p.name}</div>
    <div class="desc">${p.desc}</div>
    <div class="rar">Pack</div>
  </div>`;
}

export function brickBig(c: BrickCard, i: number) {
  const d = [c.enh !== 'none' ? `<span class="t-k">${ENH[c.enh].name}</span> : ${rich(ENH[c.enh].desc)}` : '',
    c.edition !== 'none' ? `<span class="t-k">${EDITION[c.edition].name}</span> : ${rich(EDITION[c.edition].desc)}` : ''].filter(Boolean).join('<br>');
  return `<div class="bigcard brick commun" data-i="${i}" style="--d:${(i * 0.08).toFixed(2)}s">
    <div class="swatch ed-${c.edition}" style="background:${c.enh === 'pierre' ? '#777' : BRICK_CSS[c.color]}"><b>${c.enh === 'pierre' ? '◆' : c.value}</b></div>
    <div class="n">${rich(cardLabel(c))}</div>
    <div class="desc">${d}</div>
    <div class="rar">Brique</div>
  </div>`;
}

/** Inclinaison 3D façon carte Balatro sous le pointeur. */
export function tilt(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.bigcard').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `rotateY(${x * 26}deg) rotateX(${-y * 26}deg) scale(1.06)`;
    });
    el.addEventListener('pointerleave', () => (el.style.transform = ''));
  });
}

export interface AtelierView {
  sel: number | null;
  removePrice: number;
  retailPrice: number;
  canRemove: boolean;
  canUp: boolean;
  canDown: boolean;
  removed: boolean;
  retailed: boolean;
  minDeck: number;
}

/**
 * Grille du deck : une rangée par couleur, une colonne par valeur, et en tête le nombre d'exemplaires de chaque valeur
 * (c'est ce qui décide des Paires, Brelans et Carrés qu'on peut espérer).
 */
export function deckGrid(cards: BrickCard[], sel: number | null): string {
  const counts = Array.from({ length: 11 }, (_, v) => cards.filter((c) => !isColorless(c) && c.value === v).length);
  const max = Math.max(...counts);
  const chip = (c: BrickCard) => `<button class="dchip${c.uid === sel ? ' sel' : ''}${c.enh !== 'none' ? ' enh' : ''} ed-${c.edition}" data-uid="${c.uid}"
    style="--c:${c.enh === 'pierre' ? '#777' : BRICK_CSS[c.color]}" title="${cardLabel(c).replace(/\{[^}]*\}/g, '')}">${c.enh === 'pierre' ? '◆' : c.value}</button>`;
  const head = `<div class="dlab"></div>` + counts.slice(1).map((n, i) =>
    `<div class="dhead${n === max ? ' top' : ''}"><b>${i + 1}</b><span>×${n}</span></div>`).join('');
  const rows = ([0, 1, 2, 3] as BrickColor[]).map((col) => `<div class="dlab">${rich(colorText(col))}</div>` +
    Array.from({ length: 10 }, (_, k) => `<div class="dcell">${cards.filter((c) => !isColorless(c) && c.color === col && c.value === k + 1).map(chip).join('')}</div>`).join('')).join('');
  const stones = cards.filter(isColorless);
  return `<div class="deckgrid">${head}${rows}</div>${stones.length ? `<div class="dstones">Pierres : ${stones.map(chip).join('')}</div>` : ''}`;
}
