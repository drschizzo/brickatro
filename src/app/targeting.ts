import { BRICK_COLORS } from '../render/palette';
import { COLOR_NAMES, ENH } from '../rules/bricks';
import type { RuneDef } from '../rules/consumables';
import { DISCARD_TOOL, type ToolDef } from '../rules/tools';
import type { GameCtx } from './context';
import { FX } from './view';

/** Choix de briques sur le mur pour une Rune, un Outil ou la Défausse (index −1). */
interface Targeting { rune: RuneDef | ToolDef; index: number; sel: number[] }

/**
 * Consommables, Outils et Défausse : utilisation immédiate, ou choix des briques sur le mur puis confirmation.
 */
export class TargetingController {
  private targeting: Targeting | null = null;

  constructor(private readonly g: GameCtx) {}

  /** Emplacements choisis (affichés en surbrillance). */
  get selection(): number[] | null {
    return this.targeting?.sel ?? null;
  }

  useConsumable(i: number) {
    const { g } = this;
    const run = g.engine.run;
    if (!run || g.phase !== 'aim') return;
    const c = run.consumables[i];
    if (!c) return;
    const r = g.engine.consumables.useInstant(i);
    if (r) {
      if (r.astre) g.announceAstre(r.astre);
      if (r.discards) {
        g.hud.banner(`${c.glyph} RUNE DU TRI`, `+${r.discards} Défausses pour ce Mur`, '#7dffb0');
        g.sfx.rune();
      } else if (r.split) {
        g.hud.banner(`${c.glyph} SCISSION`, `La balle se divisera en ${r.split + 1} au prochain Lancer`, '#9fe8ff');
        g.sfx.rune();
      } else if (r.money !== undefined) {
        g.hud.banner(`${c.glyph} ERMITE`, `+$${r.money}`, '#ffc53d');
        g.sfx.coin();
      }
      g.refreshHud();
      return;
    }
    this.start({ rune: c as RuneDef, index: i, sel: [] });
  }

  /** i = -1 : la Défausse (elle s'utilise comme un Outil, mais se recharge à chaque Mur sans s'acheter). */
  useTool(i: number) {
    const { g } = this;
    const run = g.engine.run;
    if (!run || g.phase !== 'aim') return;
    if (i < 0) {
      if (g.engine.wall.discardsLeft <= 0) return;
      this.start({ rune: { ...DISCARD_TOOL, targets: g.engine.deck.discardSize }, index: -1, sel: [] });
      return;
    }
    const tool = run.tools[i];
    if (!tool || tool.used) return;
    this.start({ rune: tool.def, index: i, sel: [] });
  }

  /** Clic sur le terrain : choisit (ou retire) une brique. Retourne true si le clic est consommé. */
  onTap(x: number, y: number): boolean {
    const { g } = this;
    const t = this.targeting;
    if (g.phase !== 'target' || !t) return false;
    const v = g.view;
    const p = v.stage.screenToWorld(x, y);
    const id = v.bricks.pick(p.x, p.y);
    if (id < 0 || g.world.bricks[id].kind !== 'brick') return true;
    const at = t.sel.indexOf(id);
    if (at >= 0) t.sel.splice(at, 1);
    else if (t.sel.length < t.rune.targets) t.sel.push(id);
    else return true;
    v.bricks.pulse(id, 4);
    g.sfx.click();
    this.showBar();
    return true;
  }

  cancel() {
    this.end();
  }

  private start(t: Targeting) {
    this.targeting = t;
    this.g.setPhase('target');
    this.showBar();
    this.g.updateHint();
  }

  private end() {
    this.targeting = null;
    this.g.hud.hideTargetBar();
    this.g.refreshPot();
    this.g.enterAim();
  }

  private showBar() {
    const t = this.targeting!;
    // La Mue copie la 2e brique sur la 1re, la Pince échange par paires : il leur faut des briques par 2
    const pairs = (t.rune.kind === 'rune' && t.rune.convert) || (t.rune.kind === 'tool' && t.rune.swap);
    const ready = pairs ? t.sel.length >= 2 && t.sel.length % 2 === 0 : t.sel.length > 0;
    this.g.hud.showTargetBar(
      t.index < 0 && t.rune.kind === 'tool'
        ? `${t.rune.glyph} Défausse : choisis jusqu'à ${t.rune.targets} briques (${t.sel.length}/${t.rune.targets}), remplacées par les prochaines de la pioche`
        : `${t.rune.glyph} ${t.rune.name} : choisis ${t.rune.targets} brique${t.rune.targets > 1 ? 's' : ''} (${t.sel.length}/${t.rune.targets})`,
      ready,
      () => this.confirm(),
      () => this.cancel(),
    );
  }

  private confirm() {
    const t = this.targeting!;
    if (t.rune.kind === 'tool') {
      if (t.index < 0) this.confirmDiscard(t);
      else this.confirmTool(t);
    } else this.confirmRune(t, t.rune);
    this.end();
  }

  private confirmDiscard(t: Targeting) {
    const { g } = this;
    const v = g.view;
    const ids = g.engine.deck.discardOn(t.sel);
    for (const id of ids) {
      const b = g.world.bricks[id];
      const fx = BRICK_COLORS[b.color];
      v.bricks.pulse(id, 10);
      v.rings.spawn(b.x, b.y, fx, 2, 0.4);
      v.particles.burst(b.x, b.y, fx, 10, 0.6);
    }
    if (!ids.length) return;
    g.sfx.shuffle();
    v.stage.kick(0.25);
    const left = g.engine.wall.discardsLeft;
    const n = ids.length;
    g.hud.banner('♻ DÉFAUSSE', `${n} brique${n > 1 ? 's' : ''} remplacée${n > 1 ? 's' : ''} · ${left ? `encore ${left} sur ce Mur` : 'plus de Défausse sur ce Mur'}`, '#7dffb0');
  }

  private confirmTool(t: Targeting) {
    const { g } = this;
    const v = g.view;
    const def = g.engine.consumables.useTool(t.index, t.sel);
    const n = t.sel.length;
    for (const id of t.sel) {
      const b = g.world.bricks[id];
      v.bricks.pulse(b.id, 8);
      v.rings.spawn(b.x, b.y, FX.TOOL, 2, 0.4);
      v.sparks.burst(b.x, b.y, FX.TOOL, 10, 0.7);
    }
    g.sfx.rune();
    v.stage.kick(0.3);
    if (!def) return;
    const what = def.swap ? (n >= 4 ? '2 échanges de place' : 'Les 2 briques ont échangé leur place')
      : `Pulvérisée${n > 1 ? 's' : ''} au prochain Lancer : ${n > 1 ? 'elles entreront' : 'elle entrera'} dans la Main`;
    g.hud.banner(def.name.toUpperCase(), what, '#ff9a5a');
  }

  private confirmRune(t: Targeting, r: RuneDef) {
    const { g } = this;
    const v = g.view;
    const rune = g.engine.consumables.applyRuneOn(t.index, t.sel);
    // Le retour visuel prend la couleur du résultat (nouvelle couleur, Or, Verre…)
    const fx = r.color !== undefined ? BRICK_COLORS[r.color] : r.enh === 'or' ? FX.GOLD : r.enh === 'verre' ? FX.CYAN : FX.PURPLE;
    for (const id of t.sel) {
      const b = g.world.bricks[id];
      v.bricks.pulse(b.id, 10);
      v.rings.spawn(b.x, b.y, fx, rune.duplicate ? 2.5 : 2.2, 0.45);
      v.particles.burst(b.x, b.y, fx, rune.destroy ? 20 : 12, rune.destroy ? 1 : 0.7);
      v.sparks.burst(b.x, b.y, fx, 14, 0.8);
      v.stage.lightFlash(b.x, b.y, fx, 20, 0.4);
    }
    g.sfx.rune();
    v.stage.kick(0.4);
    const n = t.sel.length;
    const s = n > 1 ? 's' : '';
    const what = rune.color !== undefined ? `${n} brique${s} passent en ${COLOR_NAMES[rune.color]} — elles comptent pour les Couleurs ${COLOR_NAMES[rune.color]}`
      : rune.enh ? `${n} brique${s} deviennent ${ENH[rune.enh].name}` : rune.destroy ? `${n} brique${s} retirée${s} du deck`
      : rune.duplicate ? 'Copie ajoutée à ta pioche' : rune.valueUp ? `+${rune.valueUp} de valeur` : rune.convert ? 'La 1re brique copie la 2e' : '';
    g.hud.banner(rune.name.toUpperCase(), what, `#${fx.getHexString()}`);
  }
}
