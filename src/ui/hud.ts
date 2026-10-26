import { fmt } from '../core/math';
import type { BossDef } from '../rules/bosses';
import { COLOR_NAMES, type BrickCard } from '../rules/bricks';
import { figureDesc, FIGURES, figureValue, type FigureId, type FigureLevels } from '../rules/figures';
import type { PotBrick } from '../rules/pot';
import { MAX_RELICS, type RelicInstance } from '../rules/relics';
import type { BallInstance } from '../rules/run';
import type { ConsumableDef } from '../rules/consumables';
import type { WallModDef } from '../rules/wallmods';
import { rich } from '../rules/text';
import { ORDER_XMULT, orderLabel, type Order } from '../rules/orders';
import { BRICK_CSS } from '../render/palette';
import { ballSmall, consumableSmall, discardSmall, relicSmall, toolSmall } from './cards';
import { MAX_TOOLS, type ToolInstance } from '../rules/tools';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const retrigger = (el: HTMLElement, cls: string) => {
  el.classList.remove(cls);
  void el.offsetWidth; // force reflow pour relancer l'animation CSS
  el.classList.add(cls);
};

export class Hud {
  private el = {
    ante: $('ante'), wallName: $('wallName'), target: $('target'), bossInfo: $('bossInfo'),
    score: $('score'), scoreBar: $('scoreBar'),
    potPanel: $('potPanel'), figName: $('figName'), chips: $('chips'), mult: $('mult'), potTotal: $('potTotal'), hand: $('hand'),
    lancers: $('lancers'), secousses: $('secousses'), money: $('money'), pile: $('pile'),
    relics: $('relics'), relicCount: $('relicCount'), cons: $('cons'), balls: $('balls'), tools: $('tools'),
    hint: $('hint'), popups: $('popups'), banner: $('banner'), overlay: $('overlay'), targetBar: $('targetBar'),
    catchBtn: $<HTMLButtonElement>('catchBtn'), secBtn: $<HTMLButtonElement>('secBtn'), figs: $('figs'), outs: $('outs'), prow: $('prow'),
  };
  private figRows = new Map<FigureId, { row: HTMLElement; lvl: HTMLElement; base: HTMLElement }>();
  private handUids = new Set<number>();
  private shownScore = 0;
  private scoreAnim = 0;
  private lastMoney = -1;
  onUseConsumable: (i: number) => void = () => {};
  onSelectBall: (i: number) => void = () => {};
  onUseTool: (i: number) => void = () => {};

  constructor() {
    this.el.figs.innerHTML = `<div class="label">Mains <span class="sub">(sur les 5 briques de la Main)</span></div>` +
      [...FIGURES].reverse().map((f) => `
        <div class="fig" data-id="${f.id}" title="${f.desc}">
          <div class="fname"><span>${f.name} <span class="flvl">niv.1</span></span><span class="fbase"></span></div>
          <div class="fdesc">${f.desc}</div>
        </div>`).join('');
    this.el.figs.querySelectorAll<HTMLElement>('.fig').forEach((row) => {
      this.figRows.set(row.dataset.id as FigureId, { row, lvl: row.querySelector('.flvl')!, base: row.querySelector('.fbase')! });
    });
    this.el.cons.addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('.card.usable');
      if (c) this.onUseConsumable(Number(c.dataset.i));
    });
    this.el.tools.addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('.card.usable');
      if (c) this.onUseTool(Number(c.dataset.i));
    });
    this.el.balls.addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('.card');
      if (c) this.onSelectBall(Number(c.dataset.i));
    });
  }

  setWallInfo(ante: number, wallName: string, target: number, boss: BossDef | null, eclipse: number, bossValue: number, curse: WallModDef | null = null, endless = false) {
    this.el.ante.textContent = endless ? `∞ ${ante}` : String(ante);
    this.el.wallName.textContent = wallName;
    this.el.wallName.classList.toggle('boss', !!boss);
    this.el.target.textContent = fmt(target);
    const bi = this.el.bossInfo;
    if (boss) {
      bi.innerHTML = `<b>${boss.glyph} ${boss.name}</b><br>${rich(boss.desc)}${boss.eclipse ? ` : <span class="t-${['feu', 'eau', 'foudre', 'terre'][eclipse]}">${COLOR_NAMES[eclipse]}</span>` : ''}${boss.requiredValue ? ` : <span class="t-x">${bossValue}</span>` : ''}`;
      bi.classList.add('show');
    } else if (curse) {
      bi.innerHTML = `<b>${curse.glyph} ${curse.name}</b><br>${rich(curse.desc)}`;
      bi.classList.add('show');
    } else bi.classList.remove('show');
    bi.classList.toggle('curse', !boss && !!curse);
  }

  setScore(score: number, target: number, animate = true) {
    cancelAnimationFrame(this.scoreAnim);
    const from = this.shownScore;
    const start = performance.now();
    const dur = animate ? 600 : 0;
    const tick = () => {
      const t = dur ? Math.min(1, (performance.now() - start) / dur) : 1;
      const v = from + (score - from) * (1 - Math.pow(1 - t, 3));
      this.shownScore = v;
      this.el.score.textContent = fmt(v);
      this.el.scoreBar.style.width = `${Math.min(100, (v / target) * 100)}%`;
      if (t < 1) this.scoreAnim = requestAnimationFrame(tick);
      else this.el.score.classList.remove('bump');
    };
    if (animate) this.el.score.classList.add('bump');
    tick();
  }

  setPot(figure: string | null, level: number, chips: number, mult: number, total: number, heat: number, popFigure = false) {
    const fig = this.el.figName;
    const html = figure ? `${figure}${level > 1 ? ` <small>niv.${level}</small>` : ''}` : '—';
    if (fig.innerHTML !== html) {
      fig.innerHTML = html;
      if (popFigure) retrigger(fig, 'pop');
    }
    this.el.chips.textContent = fmt(chips);
    this.el.mult.textContent = mult % 1 ? mult.toFixed(mult >= 100 ? 0 : 1) : fmt(mult);
    this.el.potTotal.textContent = fmt(total);
    this.el.potPanel.style.setProperty('--heat', heat.toFixed(3));
    // La Main suffit à briser le mur : le panneau prend feu
    this.el.potPanel.classList.toggle('onfire', heat >= 1 && total > 0);
  }

  /** Un seul encaissement a brisé le mur : le score s'embrase. */
  scoreFlames() {
    const s = this.el.score;
    retrigger(s, 'flames');
    clearTimeout(this.flameT);
    this.flameT = window.setTimeout(() => s.classList.remove('flames'), 2600);
  }
  private flameT = 0;

  tickChips() { retrigger(this.el.chips, 'tick'); }
  tickMult() { retrigger(this.el.mult, 'tick'); }
  potState(state: 'idle' | 'scoring' | 'lost') {
    this.el.potPanel.classList.toggle('scoring', state === 'scoring');
    if (state === 'lost') retrigger(this.el.potPanel, 'lost');
  }

  /** Les descriptions de Figures dépendent du jeu de règles (Suite et Couleur à 4 en v3). */
  refreshFigureDescs(short: boolean) {
    for (const f of FIGURES) {
      const r = this.figRows.get(f.id)!;
      r.row.title = figureDesc(f, short);
      r.row.querySelector('.fdesc')!.textContent = figureDesc(f, short);
    }
  }

  setFigures(active: FigureId | null, levels: FigureLevels, played: Set<FigureId>) {
    for (const f of FIGURES) {
      const r = this.figRows.get(f.id)!;
      r.row.classList.toggle('played', played.has(f.id));
      const lvl = levels[f.id];
      const v = figureValue(f, lvl);
      const wasActive = r.row.classList.contains('active');
      r.row.classList.toggle('active', f.id === active);
      if (f.id === active && !wasActive) retrigger(r.row, 'bump');
      r.lvl.textContent = `niv.${lvl}`;
      r.lvl.classList.toggle('up', lvl > 1);
      r.base.innerHTML = `<b class="c">${v.chips}</b>×<b class="m">${v.mult}</b>`;
    }
  }

  /** La Main : 5 emplacements, les briques qui comptent sont surélevées. */
  /** pending : brique du trajet en cours (règle v3), affichée en pointillés jusqu'au renvoi. */
  setHand(bricks: PotBrick[], size: number, scoring: Set<number>, pending: number | null = null) {
    const html: string[] = [];
    for (let i = 0; i < size; i++) {
      const b = bricks[i];
      if (!b) { html.push('<div class="hb empty"></div>'); continue; }
      const stone = b.enh === 'pierre';
      const cls = ['hb', scoring.has(b.uid) ? 'sc' : 'off', b.enh !== 'none' ? 'enh' : '', b.edition !== 'none' ? 'ed' : '', this.handUids.has(b.uid) ? '' : 'new', b.uid === pending ? 'pending' : ''];
      html.push(`<div class="${cls.join(' ')}" style="--bc:${stone ? '#777' : BRICK_CSS[b.color]}"><b>${stone ? '◆' : b.value}</b></div>`);
    }
    this.el.hand.innerHTML = html.join('');
    this.handUids = new Set(bricks.map((b) => b.uid));
  }

  private shardsEl: HTMLElement | null = null;

  /** Éclats du Lancer (règle v3) : briques hors Main, qui ajoutent des Jetons. */
  setShards(n: number, chips: number, candidates: number) {
    if (!this.shardsEl) {
      this.shardsEl = document.createElement('div');
      this.shardsEl.className = 'shards';
      this.el.hand.after(this.shardsEl);
    }
    const html = n > 0
      ? `Éclats ×${n} <span class="t-c">+${chips} Jetons</span>${candidates > 1 ? ` · <span class="dim">${candidates} briques ce trajet, la meilleure entre</span>` : ''}`
      : '';
    if (this.shardsEl.innerHTML !== html) this.shardsEl.innerHTML = html;
  }

  /** Ce qu'il faut toucher pour améliorer la Main (les "outs"). */
  setOuts(targets: { figure: string; need: string }[], handEmpty: boolean, fog: boolean, warning: string | null, orders: Order[] = [], bestOfTrip = false) {
    let html: string;
    if (warning && !handEmpty) html = `<div class="label">⚠ Attention</div><div class="out warn">${warning}</div>`;
    else if (fog) html = '<div class="label">Brouillard</div><div class="out">Impossible de lire le mur…</div>';
    else if (handEmpty && bestOfTrip) html = '<div class="label">Objectif</div><div class="out">Quand la balle revient sur ta raquette, la <span class="t-k">meilleure brique</span> cassée depuis le rebond précédent entre dans ta Main. Les autres sont des <span class="t-k">Éclats</span> : des Jetons en plus.</div>';
    else if (handEmpty) html = '<div class="label">Objectif</div><div class="out">Casse des briques pour former une <span class="t-k">main de poker</span>. La Main garde tes <span class="t-k">5 meilleures</span> briques.</div>';
    else if (!targets.length) html = '<div class="label">Pour monter</div><div class="out dim">Aucune brique du mur n\'améliore ta Main. Encaisse ?</div>';
    else html = '<div class="label">🎯 Pour monter</div>' + targets.map((t) => `<div class="out"><b>${t.figure}</b> ← ${rich(t.need)}</div>`).join('');
    if (orders.length) {
      html = `<div class="label">📜 Commandes <span class="sub">(×${ORDER_XMULT} Mult + $)</span></div>` +
        orders.map((o) => `<div class="out order${o.done ? ' done' : ''}">${o.done ? '✓' : '◇'} ${rich(orderLabel(o))} <span class="t-g">$${o.money}</span></div>`).join('') +
        html;
    }
    if (this.el.outs.innerHTML !== html) this.el.outs.innerHTML = html;
  }

  /** Prouesses réalisées par la Main actuelle. */
  setProwess(list: string[], series: { streak: number; mult: number } | null = null, extra: { frenzy: boolean; air: number; toFrenzy: number } | null = null) {
    const chip = series && series.streak > 0
      ? `<span class="pw series" style="--s:${Math.min(1, series.streak / 8).toFixed(2)}">${extra?.frenzy ? '🔥 FRÉNÉSIE' : '🔥 Série'} ${series.streak} ×${series.mult}</span>` : '';
    const soon = extra && !extra.frenzy && series && series.streak > 0 && extra.toFrenzy <= 2
      ? `<span class="pw soon">Frénésie dans ${extra.toFrenzy}</span>` : '';
    const air = extra?.air ? `<span class="pw air">⚪ ${extra.air + 1} balles</span>` : '';
    const html = chip + soon + air + list.map((t) => `<span class="pw">${t}</span>`).join('');
    if (this.el.prow.innerHTML !== html) this.el.prow.innerHTML = html;
  }

  handAnchor() {
    const r = this.el.hand.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top };
  }

  /** next : les prochaines briques de la pioche (Défausse, repose du mur), la première d'abord. */
  setResources(lancers: number, lancersMax: number, sec: number, secMax: number, money: number, pile: number, next: BrickCard[] = []) {
    const dots = (n: number, max: number) => Array.from({ length: max }, (_, i) => `<i class="${i < n ? '' : 'used'}"></i>`).join('');
    this.el.lancers.innerHTML = dots(lancers, lancersMax);
    this.el.secousses.innerHTML = secMax ? dots(sec, secMax) : '<span class="label">—</span>';
    this.el.money.textContent = `$${money}`;
    if (this.lastMoney !== -1 && money !== this.lastMoney) retrigger(this.el.money, 'bump');
    this.lastMoney = money;
    this.el.pile.innerHTML = `${pile}${next.length ? `<span class="next" title="Prochaines briques de la pioche">${next.map((c) => {
      const stone = c.enh === 'pierre';
      return `<i class="${c.enh !== 'none' ? 'enh' : ''}" style="--bc:${stone ? '#777' : BRICK_CSS[c.color]}">${stone ? '◆' : c.value}</i>`;
    }).join('')}</span>` : ''}`;
  }

  setRelics(relics: RelicInstance[]) {
    this.el.relics.innerHTML = relics.map((r, i) => relicSmall(r, i)).join('') +
      '<div class="slot-empty"></div>'.repeat(Math.max(0, MAX_RELICS - relics.length));
    this.el.relicCount.textContent = `${relics.length}/${MAX_RELICS}`;
  }

  setConsumables(list: ConsumableDef[], max: number, usable: boolean) {
    this.el.cons.innerHTML = list.map((c, i) => consumableSmall(c, i, usable)).join('') +
      '<div class="slot-empty"></div>'.repeat(Math.max(0, max - list.length));
  }

  setBalls(balls: BallInstance[], selected: number) {
    this.el.balls.innerHTML = balls.map((b, i) => ballSmall(b.def, i, i === selected, b.used)).join('');
  }

  setTools(tools: ToolInstance[], usable: boolean, discards: { left: number; max: number; size: number } | null = null) {
    this.el.tools.innerHTML = (discards && discards.max > 0 ? discardSmall(discards.left, discards.max, usable, discards.size) : '') + tools.map((t, i) => toolSmall(t.def, i, usable, t.used)).join('') +
      '<div class="slot-empty"></div>'.repeat(Math.max(0, MAX_TOOLS - tools.length));
  }

  triggerRelic(index: number, text: string, cls: string) {
    const card = this.el.relics.children[index] as HTMLElement | undefined;
    if (!card) return;
    retrigger(card, 'trigger');
    const r = card.getBoundingClientRect();
    this.popup(r.left + r.width / 2, r.top, text, cls);
  }

  anchor(which: 'pot' | 'money') {
    const r = (which === 'pot' ? this.el.potPanel : this.el.money).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top };
  }

  setHint(html: string) {
    this.el.hint.innerHTML = html;
  }

  popup(x: number, y: number, text: string, cls = '') {
    const d = document.createElement('div');
    d.className = `popup ${cls}`;
    d.textContent = text;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    d.style.rotate = `${(Math.random() - 0.5) * 16}deg`;
    this.el.popups.appendChild(d);
    setTimeout(() => d.remove(), 850);
    while (this.el.popups.childElementCount > 40) this.el.popups.firstElementChild?.remove();
  }

  banner(text: string, sub = '', color = '#fe5f55') {
    const b = this.el.banner;
    b.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    b.style.setProperty('--bc', color);
    // Pendant un écran (boutique, pack…), le bandeau passe devant pour rester visible
    b.classList.toggle('over', this.overlayOpen);
    retrigger(b, 'show');
  }

  setButtons(mode: 'launch' | 'catch' | 'off', held: boolean, canShake: boolean) {
    const b = this.el.catchBtn;
    const label = mode === 'launch' ? 'LANCER' : mode === 'catch' ? 'ENCAISSER' : '…';
    if (b.textContent !== label) b.textContent = label;
    b.classList.toggle('launch', mode === 'launch');
    b.classList.toggle('held', held);
    this.el.secBtn.disabled = !canShake;
  }

  showTargetBar(text: string, canConfirm: boolean, onConfirm: () => void, onCancel: () => void) {
    const t = this.el.targetBar;
    t.innerHTML = `<span>${text}</span><button class="btn small blue" data-ok ${canConfirm ? '' : 'disabled'}>Valider</button><button class="btn small alt" data-no>Annuler</button>`;
    t.classList.add('show');
    t.querySelector('[data-ok]')!.addEventListener('click', onConfirm);
    t.querySelector('[data-no]')!.addEventListener('click', onCancel);
  }
  hideTargetBar() {
    this.el.targetBar.classList.remove('show');
  }

  get overlay() {
    return this.el.overlay;
  }
  get overlayOpen() {
    return this.el.overlay.classList.contains('show');
  }
}
