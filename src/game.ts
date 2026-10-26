import { clamp, fmt } from './core/math';
import { Sfx } from './audio/sfx';
import { Engine, type EngineSave, type LancerEnd } from './engine/engine';
import { Input } from './input';
import { Progress } from './meta/progress';
import { loadRunSave, storeRunSave } from './meta/save';
import { colorText, newCard, type BrickCard, type BrickColor } from './rules/bricks';
import type { AstreDef } from './rules/consumables';
import { WALL_NAMES, type DeckDef } from './rules/decks';
import { FIGURE_BY_ID } from './rules/figures';
import { RULESETS } from './rules/ruleset';
import { LAYOUT_BY_ID } from './rules/layouts';
import { activeBoss, isBossWall } from './rules/run';
import { BIOMES, biomeOf } from './rules/biomes';
import { BRICK_COLORS } from './render/palette';
import { Hud } from './ui/hud';
import { Screens } from './ui/screens';
import { World } from './sim/world';
import { AimController } from './app/aim';
import { TRANSITIONS, type GameCtx, type Phase } from './app/context';
import { HandView } from './app/hand-view';
import { bindJuice } from './app/juice';
import { ShopScreen } from './app/shop-screen';
import { TargetingController } from './app/targeting';
import { FX, View } from './app/view';

const STEP = 1 / 120;

/**
 * La partie à l'écran : enchaîne les phases (menu, Mur, Lancer, encaissement, boutique) et relie
 * les entrées, le moteur et la présentation. Toutes les règles vivent dans Engine (partagé avec le banc) ;
 * la présentation est répartie entre View (scène 3D), le juice, HandView, AimController, TargetingController et ShopScreen.
 */
export class Game implements GameCtx {
  readonly world: World;
  // Règles v3 par défaut ; ?classic pour rejouer avec les règles d'origine
  readonly engine: Engine;
  readonly hud = new Hud();
  readonly screens: Screens;
  readonly sfx = new Sfx();
  readonly input: Input;
  readonly view: View;
  readonly progress = new Progress();
  phase: Phase = 'menu';
  gen = 0;
  hitstop = 0;

  private readonly aim: AimController;
  private readonly handView: HandView;
  private readonly targeting: TargetingController;
  private readonly shopScreen: ShopScreen;
  /** Confirmation « Quitter la partie » ouverte : la simulation est en pause. */
  private paused = false;
  /** Biome du dernier mur présenté (bandeau à l'entrée d'un nouveau biome). */
  private shownBiome: string | null = null;
  /** Cartes du mur décoratif derrière le menu. */
  private demoCards = new Map<number, BrickCard>();
  private acc = 0;
  private last = performance.now();
  private emptySel = new Set<number>();

  constructor(canvas: HTMLCanvasElement) {
    this.view = new View(canvas, (this.world = new World()), this.hud);
    this.engine = new Engine(this.world, RULESETS[new URLSearchParams(location.search).has('classic') ? 'classic' : 'v3']);
    this.hud.refreshFigureDescs(this.engine.rules.shortFigures);
    this.view.comets.onArrive = () => this.sfx.coin();
    this.screens = new Screens(this.hud.overlay, () => this.sfx.click());
    this.aim = new AimController(this);
    this.handView = new HandView(this);
    this.targeting = new TargetingController(this);
    this.shopScreen = new ShopScreen(this, () => this.presentWall());

    this.input = new Input(document.getElementById('catchBtn')!, () => this.hud.overlayOpen || this.paused);
    this.input.onFirstGesture = () => this.sfx.unlock();
    this.input.onPress = () => this.onPress();
    this.input.onRelease = () => this.onRelease();
    this.input.onMute = () => this.toggleMute();
    this.input.onKey = (code) => this.onKey(code);
    this.input.onTap = (x, y) => this.targeting.onTap(x, y);
    document.getElementById('mute')!.addEventListener('click', () => this.toggleMute());
    // Quitter la partie : bouton ✕ ou Échap, avec confirmation (le jeu est en pause pendant ce temps)
    const confirm = document.getElementById('confirm')!;
    document.getElementById('quit')!.addEventListener('click', () => this.askQuit(true));
    confirm.querySelector('[data-resume]')!.addEventListener('click', () => this.askQuit(false));
    confirm.querySelector('[data-quit]')!.addEventListener('click', () => this.quitRun());
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || e.repeat) return;
      if (this.paused) this.askQuit(false);
      else if (this.phase === 'target') this.targeting.cancel();
      else if (this.engine.run) this.askQuit(true);
    });
    document.getElementById('secBtn')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.secousse();
    });
    this.hud.onUseConsumable = (i) => this.targeting.useConsumable(i);
    this.hud.onSelectBall = (i) => this.selectBall(i);
    this.hud.onUseTool = (i) => this.targeting.useTool(i);

    // Le cadrage suit la place réellement libre : le HUD change de taille en cours de partie
    const field = document.getElementById('field')!;
    const resize = () => this.view.stage.resize(field.getBoundingClientRect());
    window.addEventListener('resize', resize);
    new ResizeObserver(resize).observe(field);
    resize();

    bindJuice(this, (uid) => this.card(uid));
    this.engine.events.on('lancerEnd', (e) => this.onLancerEnd(e));
    this.demoWall();
    this.showMenu();
    requestAnimationFrame(this.frame);
  }

  private card(uid: number) {
    return this.engine.cards.get(uid) ?? this.demoCards.get(uid);
  }

  // ───────────────────────── Phases ─────────────────────────

  setPhase(p: Phase) {
    if (import.meta.env.DEV && !TRANSITIONS[this.phase].includes(p)) console.warn(`Transition inattendue : ${this.phase} → ${p}`);
    this.phase = p;
  }

  enterAim() {
    this.setPhase('aim');
    this.refreshHud();
    this.updateHint();
  }

  // ───────────────────────── Menus / run ─────────────────────────

  /** Mur décoratif derrière le menu. */
  private demoWall() {
    const rng = this.view.fxRng;
    this.world.setTide(0);
    const slots = this.world.setLayout(LAYOUT_BY_ID.flipper);
    for (const id of slots) {
      const r = rng.next();
      const card = newCard(rng.int(4) as BrickColor, 1 + rng.int(10), r < 0.08 ? 'verre' : r < 0.14 ? 'or' : 'none', r > 0.94 ? 'holo' : r > 0.9 ? 'poly' : 'none');
      this.demoCards.set(card.uid, card);
      this.world.setBrick(id, card);
    }
    this.view.presentWall();
  }

  /** Ouvre (ou ferme) la confirmation pour quitter la partie ; le jeu est en pause tant qu'elle est ouverte. */
  private askQuit(open: boolean) {
    if (open && (!this.engine.run || this.phase === 'menu')) return;
    this.paused = open;
    document.getElementById('confirm')!.hidden = !open;
    this.sfx.click();
  }

  /** Abandon : le run est perdu, retour au menu (les séquences en cours s'arrêtent grâce à `gen`). */
  private quitRun() {
    const run = this.engine.run;
    this.askQuit(false);
    if (!run) return;
    this.gen++;
    this.progress.runEnded(run);
    storeRunSave(null);
    this.input.held = false;
    this.aim.unlock();
    this.screens.close();
    document.body.classList.remove('frenzy');
    this.showMenu();
  }

  private showMenu() {
    this.setPhase('menu');
    document.body.classList.remove('inrun');
    this.engine.run = null;
    this.shownBiome = null;
    this.view.applyBiome(BIOMES.atelier);
    const profile = this.progress.profile;
    const newRun = () => this.screens.newRun(profile, (deck, stake, seed) => this.startRun(deck, stake, seed), () => this.showMenu());
    const tuto = (then: () => void, label?: string) =>
      this.screens.tutorial(() => {
        this.progress.tutorialSeen();
        then();
      }, label);
    const save = loadRunSave<EngineSave>();
    this.screens.mainMenu(
      profile,
      () => (profile.tutoSeen ? newRun() : tuto(newRun, 'Jouer !')),
      () => this.screens.collection(profile, () => this.showMenu()),
      () => tuto(() => this.showMenu()),
      save ? () => this.resumeRun(save) : null,
    );
  }

  /** Reprend la partie sauvegardée au début de son Mur. */
  private resumeRun(save: EngineSave) {
    this.gen++;
    if (!this.engine.resume(save)) {
      storeRunSave(null);
      return this.showMenu();
    }
    this.screens.close();
    document.body.classList.add('inrun');
    this.hud.refreshFigureDescs(this.engine.run!.rules.shortFigures);
    this.presentWall();
  }

  private startRun(deck: DeckDef, stake: number, seed: number | null) {
    this.gen++;
    this.screens.close();
    document.body.classList.add('inrun');
    this.progress.runStarted(deck.id);
    this.engine.startRun(deck, stake, seed ?? Date.now() % 1e9);
    this.hud.refreshFigureDescs(this.engine.rules.shortFigures);
    this.presentWall();
  }

  /** Présente le mur que le moteur vient de préparer. */
  private presentWall() {
    const run = this.engine.run!;
    // Point de reprise : on reprendra au début de ce Mur
    storeRunSave(this.engine.checkpoint);
    const wall = this.engine.wall;
    const layout = this.engine.layout!;
    this.view.presentWall();
    this.hud.setScore(0, wall.target, false);
    this.refreshHud();
    this.refreshPot();
    const name = WALL_NAMES[run.wallIdx];
    const biome = biomeOf(run.ante);
    this.view.applyBiome(biome);
    const newBiome = biome.id !== this.shownBiome;
    this.shownBiome = biome.id;
    const curse = run.wallMod?.mod;
    if (curse && !isBossWall(run)) {
      this.hud.banner(`${curse.glyph} ${curse.name.toUpperCase()}`, `Mur maudit · Objectif ${fmt(wall.target)}`, '#b85cff');
      this.enterAim();
    } else if (isBossWall(run)) {
      this.setPhase('between');
      const extra = run.boss.requiredValue ? `{x}${run.bossValue}{/}` : run.boss.eclipse ? colorText(run.eclipseColor) : '';
      this.screens.bossIntro(run.boss, run.ante, wall.target, extra, () => this.enterAim());
    } else {
      if (newBiome) this.hud.banner(biome.name.toUpperCase(), `${biome.tagline} · ${layout.name}`, biome.rail);
      else this.hud.banner(layout.name.toUpperCase(), `Ante ${run.ante} · ${name} · Objectif ${fmt(wall.target)}`, biome.rail);
      this.enterAim();
    }
  }

  private afterLancer() {
    const r = this.engine.afterLancer();
    this.refreshPot();
    if (r === 'won') this.wallWon();
    else if (r === 'lost') {
      const price = this.engine.rescuePrice;
      if (price === null) return this.gameOver();
      const wall = this.engine.wall;
      this.setPhase('between');
      this.screens.rescue(price, this.engine.run!.money, wall.score, wall.target, () => {
        this.engine.buyRescue();
        this.sfx.coin();
        this.enterAim();
      }, () => this.gameOver());
    } else this.enterAim();
  }

  private wallWon() {
    const v = this.view;
    const wall = this.engine.wall;
    this.setPhase('between');
    this.sfx.win();
    v.stage.shake.add(0.5);
    this.hud.banner('MUR BRISÉ !', `${fmt(wall.score)} / ${fmt(wall.target)}`, '#ffc53d');
    for (let i = 0; i < 6; i++) {
      setTimeout(() => v.particles.burst(v.fxRng.range(-7, 7), v.fxRng.range(-4, 10), BRICK_COLORS[i % 4], 30, 1.4), i * 120);
    }
    const gen = this.gen;
    setTimeout(() => {
      if (gen !== this.gen) return; // partie quittée entre-temps
      const { lines, total } = this.engine.rewards();
      lines.forEach((_, i) => setTimeout(() => this.sfx.coin(), 200 + i * 350));
      this.screens.cashOut(lines, total, () => {
        this.engine.collect(total);
        this.sfx.coin();
        this.curseRelic(() => (this.engine.isVictory ? this.victory() : this.shopScreen.open()));
      });
    }, 800);
  }

  /** Récompense d'un Mur maudit brisé : une Relique rare au choix (ou de l'argent si plus de place). */
  private curseRelic(then: () => void) {
    const reward = this.engine.shop.curseReward();
    if (!reward) return then();
    if ('money' in reward) {
      this.hud.banner('MUR MAUDIT BRISÉ', `Plus de place pour une Relique : +$${reward.money}`, '#b85cff');
      return then();
    }
    this.screens.relicChoice('Mur maudit brisé : choisis ta Relique', reward.choices, (d) => {
      if (d && this.engine.shop.takeRelic(d)) {
        this.sfx.rune();
        this.shopScreen.markSeen();
      }
      this.screens.close();
      then();
    });
  }

  private victory() {
    const run = this.engine.run!;
    this.progress.runWon(run);
    storeRunSave(null);
    this.sfx.win();
    this.screens.gameOver(true, run, `Tu as vaincu les 8 Antes avec le ${run.deck.name} en ${run.stake.name} !`, () => this.showMenu(), () => {
      this.engine.endless = true;
      this.shopScreen.open();
      this.hud.banner('MODE INFINI', 'Les objectifs s\'envolent · Reliques Polychromes plus fréquentes', '#ff7af0');
    });
  }

  private gameOver() {
    const run = this.engine.run!;
    const wall = this.engine.wall;
    this.setPhase('between');
    this.sfx.lost();
    this.progress.runEnded(run);
    storeRunSave(null);
    this.screens.gameOver(false, run,
      `Tombé au ${WALL_NAMES[run.wallIdx]} de l'Ante ${run.ante} avec ${fmt(wall.score)} / ${fmt(wall.target)}.`,
      () => this.showMenu());
  }

  announceAstre(a: AstreDef) {
    const f = FIGURE_BY_ID[a.figure];
    this.sfx.rune();
    this.hud.banner(`${a.glyph} ${a.name.toUpperCase()}`, `${f.name} niveau ${this.engine.run!.levels[a.figure]}`, '#2d9cff');
    this.refreshPot();
  }

  // ───────────────────────── Entrées ─────────────────────────

  private onPress() {
    if (this.phase === 'aim') {
      // Maintenir = viser (la raquette se fige), relâcher = lancer
      this.aim.aiming = true;
      this.input.consumeBtnDrag();
    } else if (this.phase === 'play') this.sfx.armed();
  }

  private onRelease() {
    if (this.phase === 'aim' && this.aim.aiming) {
      this.aim.aiming = false;
      this.launch();
    }
    this.aim.aiming = false;
  }

  private onKey(code: string) {
    if (code === 'KeyS') this.secousse();
    if (code === 'KeyR') this.targeting.useTool(-1);
    const m = /^Digit([1-6])$/.exec(code);
    if (m) this.selectBall(Number(m[1]) - 1);
  }

  private launch() {
    if (!this.engine.launch(this.aim.angle)) return;
    this.aim.launched();
    this.handView.newLancer();
    this.setPhase('play');
    this.refreshHud();
    this.refreshPot();
    this.updateHint();
  }

  private selectBall(i: number) {
    if (this.phase !== 'aim' || !this.engine.selectBall(i)) return;
    this.sfx.click();
    this.refreshHud();
  }

  /** Secousse en vol : poussée vers la raquette, sauvetage sous la raquette, TILT si c'est la 2e du trajet. */
  private secousse() {
    if (this.phase !== 'play') return;
    const kind = this.engine.secousse();
    if (!kind) return;
    this.aim.unlock();
    const v = this.view;
    const b = this.world.ball;
    if (kind === 'tilt') {
      this.hud.banner('TILT !', '2 Secousses dans le même trajet', '#ff3d5a');
    } else {
      const save = kind === 'save';
      this.sfx.shuffle();
      v.stage.shake.add(save ? 0.6 : 0.35);
      v.stage.kick(save ? 0.7 : 0.3);
      v.rings.spawn(b.x, b.y, FX.TOOL, save ? 3.5 : 2, 0.4);
      v.sparks.burst(b.x, b.y, FX.TOOL, save ? 24 : 12, 0.9);
      v.popup(b.x, b.y + 1, save ? 'SAUVÉE !' : 'SECOUSSE', 'prow');
      if (save) {
        this.hitstop = 0.1;
        this.hud.banner('SAUVÉE !', 'Main gardée · Série remise à 0', '#ff9a5a');
      }
    }
    this.refreshResources();
    this.refreshPot();
  }

  private toggleMute() {
    this.sfx.toggleMute();
    document.getElementById('mute')!.classList.toggle('off', this.sfx.muted);
  }

  // ───────────────────────── HUD ─────────────────────────

  updateHint() {
    const discard = this.engine.wall.discardsLeft > 0
      ? '<br><kbd>R</kbd> <b>Défausse</b> : remplace jusqu\'à ' + this.engine.deck.discardSize + ' briques par les prochaines de la pioche' : '';
    const h =
      this.phase === 'aim'
        ? '<b>Maintiens</b> <kbd>Clic</kbd> / <kbd>Espace</kbd> pour viser, <b>relâche</b> pour lancer<br><kbd>1</kbd>-<kbd>6</kbd> : balle · clic sur une Rune ou un Outil : l\'utiliser' + discard
        : this.phase === 'target'
          ? 'Clique sur les briques du mur à cibler.'
          : this.phase === 'scoring'
            ? '<b>Appuie</b> sur <kbd>Clic</kbd> / <kbd>Espace</kbd> pour accélérer le décompte.'
          : 'Sois <b>sous la balle</b> quand elle ralentit : la raquette se verrouille et tes mouvements la déplacent <b>finement</b> pour orienter le renvoi (ligne dorée).<br>Maintiens <kbd>Clic</kbd> / <kbd>Espace</kbd> : <b>attraper</b> et encaisser. Balle perdue = Main perdue.<br><kbd>S</kbd> <b>Secousse</b> : pousse la balle vers la raquette ; sous la raquette, elle <b>remonte</b>. 2 dans le même trajet = <b>TILT</b>.';
    this.hud.setHint(h);
  }

  refreshHud() {
    const run = this.engine.run;
    if (!run) return;
    const w = this.engine.wall;
    this.hud.setWallInfo(run.ante, WALL_NAMES[run.wallIdx], w.target, activeBoss(run), run.eclipseColor, run.bossValue, run.wallMod?.mod ?? null, run.endless);
    this.refreshResources();
    this.hud.setRelics(run.relics);
    this.hud.setConsumables(run.consumables, run.maxConsumables, this.phase === 'aim');
    this.hud.setBalls(run.balls, this.engine.selectedBall);
    this.hud.setTools(run.tools, this.phase === 'aim', { left: w.discardsLeft, max: w.discardsMax, size: this.engine.deck.discardSize });
  }

  refreshResources() {
    const run = this.engine.run;
    if (!run) return;
    const w = this.engine.wall;
    this.hud.setResources(w.lancersLeft, w.lancersMax, w.secoussesLeft, w.secoussesMax, run.money, w.drawPile.length, this.engine.deck.peek());
  }

  refreshPot(fromBrick = false) {
    this.handView.refresh(fromBrick);
  }

  private onLancerEnd(e: LancerEnd) {
    if (e.kind === 'empty') return this.afterLancer();
    if (e.kind === 'cash' || e.kind === 'insured') {
      if (e.kind === 'insured') {
        this.hud.banner('ASSURANCE', `${e.keep * 100}% de la Main sauvée`, '#2d9cff');
        this.view.ballLost(e.x);
        this.hitstop = 0.15;
      }
      void this.handView.cashIn(e.res, e.x, () => this.afterLancer());
      return;
    }
    this.view.ballLost(e.x);
    this.hitstop = 0.15;
    this.sfx.lost();
    if (e.potLost) this.hud.banner('MAIN PERDUE', '', '#ff3d5a');
    this.hud.potState('lost');
    this.refreshHud();
    this.afterLancer();
  }

  // ───────────────────────── Boucle ─────────────────────────

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    // Derrière un écran plein (menus, boutique, pause), la scène floutée se contente de ~30 i/s
    const throttled = this.hud.overlayOpen;
    if (throttled && now - this.last < 1000 / 30 - 4) return;
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    const { engine, world } = this;
    const run = engine.run;
    const pot = engine.pot;
    const boss = run ? activeBoss(run) : null;

    this.aim.update(dt, boss?.mirror ? -1 : 1, boss?.fog ?? false);
    const armed = this.aim.armed;

    // Hit-stop : la sim gèle, le rendu continue (shake, particules…)
    if (this.hitstop > 0) {
      this.hitstop -= dt;
    } else if (run && !this.paused && (this.phase === 'aim' || this.phase === 'play' || this.phase === 'scoring')) {
      this.acc += dt * this.aim.timeScale;
      const speedMul = engine.speedMul();
      while (this.acc >= STEP) {
        engine.step(STEP, { paddleTargetX: this.aim.paddleTarget, catchArmed: armed, speedMul });
        this.acc -= STEP;
      }
    } else {
      this.acc = 0;
      world.moveRows(dt);
    }

    const frenzy = this.phase === 'play' && pot.frenzy;
    document.body.classList.toggle('frenzy', frenzy);
    const lasered = engine.consumables.lasered;
    const sel = this.targeting.selection;
    this.view.render(dt, {
      card: (uid) => this.card(uid),
      heat: this.handView.heat,
      ballHeat: frenzy ? 1 : clamp(pot.rebounds / 10 + pot.bricks.length / 40, 0, 1),
      flying: !world.ball.stuck && this.phase === 'play',
      armed,
      lock: this.aim.lock,
      selected: sel ? new Set([...sel, ...lasered]) : lasered,
      eclipse: boss?.eclipse && run ? run.eclipseColor : -1,
      fog: !!boss?.fog,
      aimed: this.aim.aimedBrick,
      useful: this.phase === 'aim' || this.phase === 'play' ? this.handView.useful : this.emptySel,
      dark: run?.wallMod?.mod.dark && this.phase !== 'between' ? world.balls.map((b) => ({ x: b.x, y: b.y })) : null,
      hideVeins: !!boss?.fog || !!run?.wallMod?.mod.dark,
      twin: world.twin && !!run,
      throttled,
    });
    this.hud.setButtons(this.phase === 'aim' ? 'launch' : this.phase === 'play' ? 'catch' : 'off', armed, this.phase === 'play' && engine.wall.secoussesLeft > 0 && !world.ball.stuck);
  };
}
