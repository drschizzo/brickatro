import { fmt } from '../core/math';
import type { PackOptions } from '../engine/shop';
import { ATELIER_MIN_DECK, canRemove, canRetail, removePrice, RETAIL_PRICE } from '../rules/atelier';
import { WALL_NAMES } from '../rules/decks';
import { targetOf } from '../rules/run';
import { PACKS } from '../rules/shop';
import type { AtelierView } from '../ui/cards';
import type { GameCtx } from './context';

/**
 * L'écran de boutique : articles, packs, Atelier, malédiction proposée, passer le Mur, puis le Mur suivant.
 */
export class ShopScreen {
  /** Brique du deck choisie dans l'Atelier. */
  private atelierSel: number | null = null;

  /** `presentWall` : présente le Mur suivant en quittant la boutique. */
  constructor(private readonly g: GameCtx, private readonly presentWall: () => void) {}

  open() {
    this.g.setPhase('between');
    this.g.engine.shop.open();
    this.markSeen();
    this.render();
  }

  /** Les Reliques en boutique et possédées entrent dans la collection. */
  markSeen() {
    const { engine } = this.g;
    const ids = engine.shop.items.flatMap((it) => (it.type === 'relic' ? [it.def.id] : []));
    this.g.progress.relicsSeen([...ids, ...engine.run!.relics.map((r) => r.def.id)]);
  }

  private render() {
    const { g } = this;
    const { engine, sfx } = g;
    const shop = engine.shop;
    const run = engine.run!;
    let ante = run.ante, idx = run.wallIdx + 1;
    if (idx > 2) { idx = 0; ante++; }
    const next = `Prochain : <b>${WALL_NAMES[idx]}</b> de l'Ante ${ante} · Objectif <b class="t-g">${fmt(targetOf(run, ante, idx))}</b>` +
      (idx === 2 || ante === run.ante ? `<br>Boss de l'Ante : <b>${run.boss.glyph} ${run.boss.name}</b>` : '');
    const offer = shop.wallModOffer;
    const sel = run.cards.find((c) => c.uid === this.atelierSel);
    const atelier: AtelierView | null = shop.atelierOpen ? {
      sel: sel?.uid ?? null, removePrice: removePrice(run), retailPrice: RETAIL_PRICE,
      canRemove: canRemove(run, shop.atelier), canUp: canRetail(run, shop.atelier, sel, 1), canDown: canRetail(run, shop.atelier, sel, -1),
      removed: shop.atelier.removed, retailed: shop.atelier.retailed, minDeck: ATELIER_MIN_DECK,
    } : null;
    g.screens.shop(run, shop.items, shop.rerollCost, next, shop.skipReward, offer ? { offer, on: !!run.pendingMod } : null, {
      pick: (uid) => {
        this.atelierSel = this.atelierSel === uid ? null : uid;
        this.render();
      },
      remove: () => {
        if (this.atelierSel === null || !shop.atelierRemove(this.atelierSel)) return sfx.error();
        this.atelierSel = null;
        sfx.coin();
        this.render();
      },
      retail: (delta) => {
        if (this.atelierSel === null || !shop.atelierRetail(this.atelierSel, delta)) return sfx.error();
        sfx.rune();
        this.render();
      },
      curse: () => {
        shop.acceptWallMod(!run.pendingMod);
        if (run.pendingMod) sfx.rune(); else sfx.click();
        this.render();
      },
      buy: (i) => this.buy(i),
      reroll: () => {
        if (!shop.reroll()) return sfx.error();
        this.markSeen();
        sfx.shuffle();
        this.render();
      },
      sell: (i) => {
        shop.sell(i);
        sfx.coin();
        this.render();
      },
      move: (i, dir) => {
        shop.move(i, dir);
        this.render();
      },
      leave: () => {
        g.screens.close();
        if (shop.leave()) g.progress.anteReached(run.ante);
        this.presentWall();
      },
      skip: () => this.skip(),
    }, atelier);
  }

  private buy(i: number) {
    const { g } = this;
    const it = g.engine.shop.items[i];
    const r = g.engine.shop.buy(i);
    if (!r.ok) {
      if (r.reason === 'reliques') g.hud.banner('PLUS DE PLACE', 'Vends une Relique d\'abord', '#fe5f55');
      if (r.reason === 'outils') g.hud.banner('PLUS DE PLACE', 'Tu as déjà 2 Outils', '#fe5f55');
      if (r.reason === 'consommables') g.hud.banner('PLUS DE PLACE', 'Emplacements de consommables pleins', '#fe5f55');
      return g.sfx.error();
    }
    g.sfx.coin();
    if (r.astre) g.announceAstre(r.astre);
    if (r.options && it?.type === 'pack') {
      const run = g.engine.run!;
      const note = it.pack === 'briques' ? 'La brique choisie rejoint ton deck.' : it.pack === 'astres' ? 'L\'Astre choisi améliore sa main.' : `Emplacements : ${run.consumables.length}/${run.maxConsumables}`;
      this.showPack(PACKS[it.pack].name, r.options, note, (quiet) => {
        if (!quiet) g.sfx.rune();
        this.render();
      });
      return;
    }
    this.render();
  }

  /** Passe le Mur suivant contre sa récompense (argent ou pack). */
  private skip() {
    const { g } = this;
    const run = g.engine.run!;
    const skipped = WALL_NAMES[(run.wallIdx + 1) % 3];
    const r = g.engine.shop.skipNextWall();
    if (!r) return;
    g.screens.close();
    if (r.newAnte) g.progress.anteReached(run.ante);
    g.sfx.coin();
    const go = () => {
      this.presentWall();
      g.hud.banner(`${skipped.toUpperCase()} PASSÉ`, `${r.reward.glyph} ${r.reward.name}`, '#ffc53d');
    };
    if (!r.options || !r.reward.pack) return go();
    this.showPack(PACKS[r.reward.pack].name, r.options, 'Récompense pour avoir passé le mur.', () => {
      g.screens.close();
      go();
    });
  }

  /**
   * Choix dans un pack. Une Rune sans emplacement libre laisse le pack ouvert (autre option ou passer).
   * `done(quiet)` : appelé après le choix ; quiet = pack passé ou Astre déjà annoncé (pas de son de choix).
   */
  private showPack(name: string, options: PackOptions, note: string, done: (quiet: boolean) => void) {
    const { g } = this;
    const show = (n: string) => g.screens.pack(name, options, n, (pick) => {
      const res = g.engine.shop.pickPack(options, pick);
      if (!res.ok) {
        g.sfx.error();
        return show('<b class="t-m">Emplacements de consommables pleins</b> : choisis autre chose ou passe.');
      }
      if (res.astre) g.announceAstre(res.astre);
      done(!!res.astre || pick === null);
    });
    show(note);
  }
}
