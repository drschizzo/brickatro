import { fmt } from '../core/math';
import type { SkipReward } from '../rules/skips';
import type { WallModOffer } from '../rules/wallmods';
import { cardLabel, type BrickCard } from '../rules/bricks';
import { BALLS } from '../rules/balls';
import { BOSSES, type BossDef } from '../rules/bosses';
import type { ConsumableDef } from '../rules/consumables';
import { DECKS, STAKES, type DeckDef } from '../rules/decks';
import { RELICS, type Archetype, type RelicDef } from '../rules/relics';
import { sellPrice, type ShopItem } from '../rules/shop';
import { rich } from '../rules/text';
import type { Profile } from '../meta/save';
import { ballBig, brickBig, consumableBig, deckGrid, packBig, relicBig, relicSmall, tilt, toolBig, type AtelierView } from './cards';
import { TOOLS } from '../rules/tools';
import { TUTO_STEPS } from './tutorial';
import type { Run } from '../rules/run';

/** Écrans plein écran (menus, boutique, packs…) dans #overlay. */
export class Screens {
  constructor(private root: HTMLElement, private click: () => void) {}

  /** keepScroll : la boutique se redessine après un achat ou un service de l'Atelier, on reste où on était. */
  private open(html: string, keepScroll = false) {
    const y = this.root.scrollTop;
    const again = keepScroll && this.root.classList.contains('show') && !!this.root.querySelector('.shop');
    this.root.innerHTML = html;
    this.root.classList.add('show');
    this.root.scrollTop = again ? y : 0;
    tilt(this.root);
  }
  close() {
    this.root.classList.remove('show');
    this.root.innerHTML = '';
  }
  private on(sel: string, fn: (el: HTMLElement) => void) {
    this.root.querySelectorAll<HTMLElement>(sel).forEach((el) =>
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.click();
        fn(el);
      }),
    );
  }

  // ───────── Menu principal ─────────
  mainMenu(profile: Profile, onPlay: () => void, onCollection: () => void, onTuto: () => void) {
    this.open(`
      <div class="logo">BRICK<span>ATRO</span></div>
      <p>Un casse-briques roguelike. Construis ton Pot, ose le faire grossir, encaisse avant de tout perdre.</p>
      <div class="btnrow"><button class="btn" data-play>JOUER</button><button class="btn alt" data-tuto>Tutoriel</button><button class="btn alt" data-coll>Collection</button></div>
      <div class="stats">
        <div><b>${profile.runs}</b>parties</div><div><b>${profile.wins}</b>victoires</div>
        <div><b>${profile.bestAnte}</b>meilleure Ante</div><div><b>${fmt(profile.bestHand)}</b>meilleur coup</div>
      </div>
      <p style="font-size:10px">Souris / tactile · <b>Clic maintenu</b> = attraper et encaisser · <b>S</b> = Secousse · <b>1-6</b> = balles · <b>M</b> = son</p>`);
    this.on('[data-play]', onPlay);
    this.on('[data-coll]', onCollection);
    this.on('[data-tuto]', onTuto);
  }

  /** Tutoriel animé, étape par étape (←/→, Entrée, Échap au clavier). */
  tutorial(onDone: () => void, doneLabel = 'Terminer') {
    let i = 0;
    const n = TUTO_STEPS.length;
    const finish = () => {
      window.removeEventListener('keydown', onKey, true);
      onDone();
    };
    const go = (to: number) => {
      if (to >= n) return finish();
      i = Math.max(0, to);
      const s = TUTO_STEPS[i];
      this.root.querySelector('.tbody')!.innerHTML = `
        <h3>${i + 1} / ${n}</h3><h2>${s.title}</h2>
        <div class="tanim" style="--T:${s.dur}s">${s.scene}</div>
        <p class="ttext">${s.text}</p>`;
      this.root.querySelectorAll('.tdots i').forEach((d, j) => d.classList.toggle('on', j === i));
      (this.root.querySelector('[data-prev]') as HTMLButtonElement).disabled = i === 0;
      this.root.querySelector('[data-next]')!.textContent = i === n - 1 ? doneLabel : 'Suivant';
    };
    const onKey = (e: KeyboardEvent) => {
      if (!this.root.querySelector('.tuto')) return window.removeEventListener('keydown', onKey, true);
      const step = { ArrowRight: 1, Enter: 1, Space: 1, ArrowLeft: -1 }[e.code];
      if (step === undefined && e.code !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.click();
      if (e.code === 'Escape') finish();
      else go(i + step!);
    };
    window.addEventListener('keydown', onKey, true);
    this.open(`
      <div class="tuto">
        <div class="tbody"></div>
        <div class="tdots">${TUTO_STEPS.map((_, j) => `<i data-dot="${j}"></i>`).join('')}</div>
        <div class="btnrow"><button class="btn alt" data-prev>Précédent</button><button class="btn" data-next>Suivant</button></div>
        <button class="tskip" data-skip>Passer le tutoriel</button>
      </div>`);
    this.on('[data-prev]', () => go(i - 1));
    this.on('[data-next]', () => go(i + 1));
    this.on('[data-dot]', (el) => go(Number(el.dataset.dot)));
    this.on('[data-skip]', finish);
    go(0);
  }

  newRun(profile: Profile, onStart: (deck: DeckDef, stake: number, seed: number | null) => void, onBack: () => void) {
    let d = Math.max(0, DECKS.findIndex((x) => x.id === profile.lastDeck));
    let s = profile.maxStake;
    const render = () => {
      const deck = DECKS[d];
      const locked = profile.bestAnte < deck.unlockAnte;
      const stake = STAKES[s];
      this.open(`
        <h2>Nouvelle partie</h2>
        <h3>Deck</h3>
        <div class="picker"><button class="arrow" data-dp>‹</button>
          <div class="pickcard ${locked ? 'locked' : ''}" style="--pc:${deck.color}">
            <div class="g">${deck.glyph}</div><div class="n">${deck.name}</div>
            <div class="d">${locked ? `🔒 Atteins l'Ante ${deck.unlockAnte} pour débloquer` : rich(deck.desc)}</div>
          </div><button class="arrow" data-dn>›</button></div>
        <h3>Mise</h3>
        <div class="picker"><button class="arrow" data-sp>‹</button>
          <div class="pickcard" style="--pc:${stake.color}"><div class="n" style="color:${stake.color}">${stake.name}</div><div class="d">${stake.desc}</div></div>
          <button class="arrow" data-sn>›</button></div>
        <p style="font-size:10px">Gagne un run (Ante 8) pour débloquer la Mise suivante.</p>
        <input class="seed" id="seedInput" placeholder="Graine (optionnel)" maxlength="10" />
        <div class="btnrow"><button class="btn alt" data-back>Retour</button><button class="btn" data-go ${locked ? 'disabled' : ''}>C'EST PARTI</button></div>`);
      this.on('[data-dp]', () => { d = (d + DECKS.length - 1) % DECKS.length; render(); });
      this.on('[data-dn]', () => { d = (d + 1) % DECKS.length; render(); });
      this.on('[data-sp]', () => { s = Math.max(0, s - 1); render(); });
      this.on('[data-sn]', () => { s = Math.min(profile.maxStake, s + 1); render(); });
      this.on('[data-back]', onBack);
      this.on('[data-go]', () => {
        const v = (this.root.querySelector('#seedInput') as HTMLInputElement).value.trim();
        onStart(DECKS[d], s, v ? hashSeed(v) : null);
      });
    };
    render();
  }

  collection(profile: Profile, onBack: () => void) {
    const seen = new Set(profile.seenRelics);
    this.open(`
      <h2>Collection</h2>
      <p>${seen.size} / ${RELICS.length} Reliques découvertes</p>
      <div class="coll">${RELICS.map((r, i) => seen.has(r.id) ? relicSmall({ def: r, counter: 0 }, i) : `<div class="card unseen"><div class="g">?</div></div>`).join('')}</div>
      <h3>Balles</h3><div class="coll">${BALLS.map((b) => `<div class="card ball"><div class="g">${b.glyph}</div><div class="tip"><b class="tn">${b.name}</b>${rich(b.desc)}</div></div>`).join('')}</div>
      <h3>Outils</h3><div class="coll">${TOOLS.map((t) => `<div class="card tool"><div class="g">${t.glyph}</div><div class="tip"><b class="tn">${t.name}</b>${rich(t.desc)}</div></div>`).join('')}</div>
      <h3>Boss</h3><div class="coll">${BOSSES.map((b) => `<div class="card rare"><div class="g">${b.glyph}</div><div class="n">${b.name}</div><div class="tip"><b class="tn">${b.name}</b>${rich(b.desc)}</div></div>`).join('')}</div>
      <button class="btn alt" data-back>Retour</button>`);
    this.on('[data-back]', onBack);
  }

  // ───────── En jeu ─────────
  bossIntro(boss: BossDef, ante: number, target: number, extra: string, onGo: () => void) {
    this.open(`
      <div class="logo" style="font-size:72px">${boss.glyph}</div>
      <h2 style="color:${boss.color}">${boss.name}</h2>
      <p style="font-size:14px;color:#fff">${rich(boss.desc)}${extra ? ` : ${rich(extra)}` : ''}</p>
      <p>Mur Boss de l'Ante ${ante} · Objectif <b class="t-g">${fmt(target)}</b></p>
      <button class="btn" data-go>Affronter</button>`);
    this.on('[data-go]', () => { this.close(); onGo(); });
  }

  cashOut(lines: { label: string; amount: number }[], total: number, onCollect: () => void) {
    this.open(`
      <h2>MUR BRISÉ !</h2>
      <div class="cashout">${lines.map((l, i) => `<div class="cashline" style="--d:${0.2 + i * 0.35}s"><span>${l.label}</span><b>+$${l.amount}</b></div>`).join('')}</div>
      <button class="btn gold" data-go>Encaisser $${total}</button>`);
    this.on('[data-go]', () => { this.close(); onCollect(); });
  }

  shop(run: Run, items: ShopItem[], rerollCost: number, next: string, skip: SkipReward | null, curse: { offer: WallModOffer; on: boolean } | null, cb: {
    buy: (i: number) => void; reroll: () => void; sell: (i: number) => void; move: (i: number, dir: number) => void; leave: () => void; skip: () => void; curse: () => void;
    pick: (uid: number) => void; remove: () => void; retail: (delta: 1 | -1) => void;
  }, atelier: AtelierView | null = null) {
    const owned = new Set<Archetype>(run.relics.flatMap((r) => r.def.tags));
    const item = (it: ShopItem, i: number) => {
      const o = { price: it.price, poor: it.price > run.money };
      const html = it.type === 'relic' ? relicBig(it.def, i, { ...o, owned, poly: it.poly })
        : it.type === 'consumable' ? consumableBig(it.def, i, o)
        : it.type === 'ball' ? ballBig(it.def, i, o) : it.type === 'tool' ? toolBig(it.def, i, o) : packBig(it.pack, i, o);
      return it.sold ? html.replace('class="bigcard', 'class="bigcard sold') : html;
    };
    this.open(`
      <div class="shop">
        <div class="shophead"><h2>Boutique</h2><span class="money">$${run.money}</span></div>
        <div class="shelf">${items.map((it, i) => (it.type === 'relic' || it.type === 'consumable' ? item(it, i) : '')).join('')}</div>
        <div class="shelf">${items.map((it, i) => (it.type === 'ball' || it.type === 'tool' || it.type === 'pack' ? item(it, i) : '')).join('')}</div>
        <div>
          <h3>Tes Reliques — l'ordre compte (gauche → droite)</h3>
          <div class="owned">${run.relics.length ? run.relics.map((r, i) => `
            <div class="ownedrelic">${relicSmall(r, i)}
              <div class="ctrl"><button data-l="${i}">◀</button><button data-r="${i}">▶</button><button class="sell" data-s="${i}">$${sellPrice(r.def)}</button></div>
            </div>`).join('') : '<p>Aucune pour l\'instant.</p>'}</div>
        </div>
        ${atelier ? this.atelierHtml(run, atelier) : ''}
        <div class="nextinfo">${next}</div>
        ${curse ? `<button class="curse ${curse.on ? 'on' : ''}" data-curse title="Le prochain Mur sera maudit ; brise-le pour toucher la récompense">
          <span class="cg">${curse.offer.mod.glyph}</span>
          <span class="ct"><b>${curse.on ? '✔ Mur maudit' : 'Maudire le prochain mur ?'}</b> ${curse.offer.mod.name} : ${rich(curse.offer.mod.desc)}<br>Récompense si tu le brises : ${rich(curse.offer.reward.label)}</span>
        </button>` : ''}
        <div class="btnrow">
          <button class="btn blue" data-reroll ${run.money < rerollCost ? 'disabled' : ''}>Relancer $${rerollCost}</button>
          ${skip ? `<button class="btn alt" data-skip title="Tu ne joues pas le prochain Mur et tu ne passes pas par la boutique">Passer le mur · ${skip.glyph} ${rich(skip.desc)}</button>` : ''}
          <button class="btn" data-leave>Mur suivant →</button>
        </div>
      </div>`, true);
    this.on('.shelf .bigcard', (el) => cb.buy(Number(el.dataset.i)));
    this.on('[data-reroll]', cb.reroll);
    this.on('[data-leave]', cb.leave);
    this.on('[data-skip]', cb.skip);
    this.on('[data-curse]', cb.curse);
    this.on('[data-l]', (el) => cb.move(Number(el.dataset.l), -1));
    this.on('[data-r]', (el) => cb.move(Number(el.dataset.r), 1));
    this.on('[data-s]', (el) => cb.sell(Number(el.dataset.s)));
    this.on('.dchip', (el) => cb.pick(Number(el.dataset.uid)));
    this.on('[data-remove]', cb.remove);
    this.on('[data-up]', () => cb.retail(1));
    this.on('[data-down]', () => cb.retail(-1));
  }

  private atelierHtml(run: Run, a: AtelierView) {
    const card = run.cards.find((c) => c.uid === a.sel);
    const what = card ? rich(cardLabel(card)) : 'Choisis une brique dans la grille';
    const note = run.cards.length <= a.minDeck ? `Le deck ne peut pas descendre sous ${a.minDeck} briques.` : 'Un service de chaque par visite.';
    return `<div class="atelier">
      <h3>🔨 Atelier · ton deck (${run.cards.length} briques)</h3>
      <p class="sub">Moins de valeurs différentes = plus de chances qu'une brique atteignable complète ta Figure.</p>
      ${deckGrid(run.cards, a.sel)}
      <div class="atelierbar">
        <span class="asel">${what}</span>
        <button class="btn small" data-remove ${card && a.canRemove ? '' : 'disabled'}>${a.removed ? 'Retirée ✓' : `Retirer · $${a.removePrice}`}</button>
        <button class="btn blue small" data-down ${card && a.canDown ? '' : 'disabled'}>−1 · $${a.retailPrice}</button>
        <button class="btn blue small" data-up ${card && a.canUp ? '' : 'disabled'}>+1 · $${a.retailPrice}</button>
      </div>
      <p class="sub">${note}${a.retailed ? ' Retaille faite ✓' : ''}</p>
    </div>`;
  }

  pack(title: string, options: (BrickCard | ConsumableDef)[], note: string, onPick: (i: number | null) => void) {
    this.open(`
      <h2>${title}</h2><p>${note}</p>
      <div class="choices">${options.map((o, i) => ('uid' in o ? brickBig(o, i) : consumableBig(o, i))).join('')}</div>
      <button class="btn alt" data-skip>Passer</button>`);
    this.on('.choices .bigcard', (el) => onPick(Number(el.dataset.i)));
    this.on('[data-skip]', () => onPick(null));
  }

  relicChoice(title: string, defs: RelicDef[], onPick: (d: RelicDef | null) => void) {
    this.open(`<h2>${title}</h2><div class="choices">${defs.map((d, i) => relicBig(d, i)).join('')}</div><button class="btn alt" data-skip>Passer</button>`);
    this.on('.choices .bigcard', (el) => onPick(defs[Number(el.dataset.i)]));
    this.on('[data-skip]', () => onPick(null));
  }

  /** Lancer de secours : le Mur est perdu, on peut racheter un Lancer (1 fois par Mur). */
  rescue(price: number, money: number, score: number, target: number, onBuy: () => void, onGiveUp: () => void) {
    const ok = money >= price;
    this.open(`
      <h2 style="color:var(--mult)">PLUS DE LANCERS</h2>
      <p>Score <b>${fmt(score)}</b> / <b class="t-g">${fmt(target)}</b>. Il te manque <b>${fmt(target - score)}</b>.</p>
      <p>Un <b>Lancer de secours</b> coûte <b class="t-g">$${price}</b> (1 par Mur). Tu as <b class="t-g">$${money}</b>.</p>
      <div class="btnrow"><button class="btn gold" data-buy ${ok ? '' : 'disabled'}>Acheter ($${price})</button><button class="btn" data-quit>Abandonner</button></div>`);
    if (ok) this.on('[data-buy]', () => { this.close(); onBuy(); });
    this.on('[data-quit]', () => { this.close(); onGiveUp(); });
  }

  gameOver(won: boolean, run: Run, stats: string, onMenu: () => void, onContinue?: () => void) {
    this.open(`
      <h2 style="color:${won ? 'var(--gold)' : 'var(--mult)'}">${won ? 'VICTOIRE !' : 'FIN DU RUN'}</h2>
      <p>${stats}</p>
      <div class="stats">
        <div><b>${run.ante}</b>Ante</div><div><b>${fmt(run.stats.bestHand)}</b>meilleur coup</div>
        <div><b>${run.stats.bricks}</b>briques</div><div><b>${run.stats.ballsLost}</b>balles perdues</div>
      </div>
      <p>Graine : <b>${run.seed}</b></p>
      <div class="owned">${run.relics.map((r, i) => relicSmall(r, i)).join('')}</div>
      <div class="btnrow">${onContinue ? '<button class="btn gold" data-cont>Mode infini</button>' : ''}<button class="btn" data-menu>Menu</button></div>`);
    this.on('[data-menu]', onMenu);
    if (onContinue) this.on('[data-cont]', onContinue);
  }
}

export function hashSeed(s: string) {
  if (/^\d+$/.test(s)) return Number(s) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
