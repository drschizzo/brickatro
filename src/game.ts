import * as THREE from 'three';
import { clamp, fmt } from './core/math';
import { Rng } from './core/rng';
import { Sfx } from './audio/sfx';
import { Engine, type LancerEnd } from './engine/engine';
import { Input } from './input';
import { loadProfile, saveProfile } from './meta/save';
import { COLOR_NAMES, colorText, ENH, newCard, type BrickCard, type BrickColor } from './rules/bricks';
import type { AstreDef, RuneDef } from './rules/consumables';
import { STAKES, WALL_NAMES, type DeckDef } from './rules/decks';
import { FIGURE_BY_ID, figureDesc, figureIndex } from './rules/figures';
import { RULESETS } from './rules/ruleset';
import { LAYOUT_BY_ID } from './rules/layouts';
import { PROWESS } from './rules/prowess';
import { activeBoss, isBossWall, targetOf } from './rules/run';
import { ATELIER_MIN_DECK, canRemove, canRetail, removePrice, RETAIL_PRICE } from './rules/atelier';
import type { AtelierView } from './ui/cards';
import { frenzyStreak, seriesMult, type ScoreResult } from './rules/scoring';
import { MAX_RELICS } from './rules/relics';
import { PACKS, rollRelics } from './rules/shop';
import { BallRenderer, Frame, PaddleRenderer } from './render/actors';
import { AimGuide, type GuidePath } from './render/aim';
import { TerrainRenderer } from './render/terrain';
import { BrickRenderer } from './render/bricks';
import { VeinRenderer } from './render/veins';
import { DISCARD_TOOL, type ToolDef } from './rules/tools';
import { BIOMES, biomeOf, type BiomeDef } from './rules/biomes';
import { BRICK_COLORS } from './render/palette';
import { Particles, Rings, Sparks } from './render/particles';
import { Beams, Comets } from './render/fx3d';
import { Stage } from './render/stage';
import { Hud } from './ui/hud';
import { Screens } from './ui/screens';
import { angleForPaddleX, BALL_R, bounceDir, FIELD, MAX_BOUNCE_ANGLE, MAX_LAUNCH_ANGLE, paddleXForAngle, predictPath, snapAngle, World } from './sim/world';

const STEP = 1 / 120;
/** Ralenti : distance restant à parcourir (le long de la trajectoire) avant la raquette, et facteur. */
const FOCUS_DIST = 6.5;
const FOCUS_SCALE = 0.25;
/** Ralenti de la dernière chance (balle sous la raquette, Secousse disponible). */
const LAST_CHANCE_SCALE = 0.3;
/** Marge (au-delà de la raquette) pour verrouiller la raquette sous la balle à l'entrée du ralenti. */
const LOCK_REACH = 1.2;
/** Sensibilité de la visée du renvoi : radians par pixel de souris / doigt. */
const AIM_GAIN = (0.25 * Math.PI) / 180;

type Phase = 'menu' | 'between' | 'aim' | 'play' | 'scoring' | 'target';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GOLD = new THREE.Color('#ffc53d');
const WHITE = new THREE.Color('#ffffff');
const CHIPS_C = new THREE.Color('#2d9cff');
const MULT_C = new THREE.Color('#fe5f55');
const PURPLE = new THREE.Color('#b85cff');
const PINK = new THREE.Color('#ff2d8a');
const CYAN = new THREE.Color('#2dd4ff');
const TOOL_C = new THREE.Color('#ff9a5a');
const TEAL = new THREE.Color('#2fe0b0');
const AIM_GOLD = new THREE.Color('#ffd76a').multiplyScalar(1.6);
const AIM_DIM = new THREE.Color('#9fb4ff').multiplyScalar(0.8);

/**
 * Couche de présentation : entrées, rendu, son, HUD et "juice".
 * Toutes les règles vivent dans Engine (partagé avec le banc de simulation).
 */
export class Game {
  private fxRng = new Rng(Date.now());
  private world = new World(this.fxRng);
  // Règles v3 par défaut ; ?classic pour rejouer avec les règles d'origine
  private engine = new Engine(this.world, RULESETS[new URLSearchParams(location.search).has('classic') ? 'classic' : 'v3']);
  private stage: Stage;
  private hud = new Hud();
  private screens: Screens;
  private sfx = new Sfx();
  private input: Input;
  private bricks: BrickRenderer;
  private veins: VeinRenderer;
  private ball = new BallRenderer();
  private paddle: PaddleRenderer;
  /** Raquette jumelle au plafond (Raquette siamoise). */
  private twin: PaddleRenderer;
  /** Multiballe : un rendu par balle supplémentaire (par identifiant), recyclés. */
  private extraR = new Map<number, BallRenderer>();
  private ballPool: BallRenderer[] = [];
  private particles = new Particles();
  private rings = new Rings();
  private sparks = new Sparks();
  private frame3d = new Frame();
  private beams = new Beams();
  private comets = new Comets();
  private emberT = 0;
  private aim = new AimGuide();
  private terrain = new TerrainRenderer();

  private profile = loadProfile();
  private phase: Phase = 'menu';
  /** Confirmation « Quitter la partie » ouverte : la simulation est en pause. */
  private paused = false;
  /** Génération du run : change quand on en commence ou en quitte un (les séquences asynchrones s'arrêtent). */
  private gen = 0;
  /** Choix de briques sur le mur pour une Rune ou un Outil. */
  private targeting: { rune: RuneDef | ToolDef; index: number; sel: number[] } | null = null;
  /** Biome du dernier mur présenté (bandeau à l'entrée d'un nouveau biome). */
  private shownBiome: string | null = null;
  private demoCards = new Map<number, BrickCard>();

  private lastFigureIdx = -1;
  private aimAngle = 0;
  private aiming = false;
  private timeScale = 1;
  private useful = new Set<number>();
  private aimedBrick = -1;
  /** Visée du renvoi : raquette verrouillée sous la balle, le joueur oriente l'angle. */
  private lock: { landX: number; angle: number } | null = null;
  private lockTried = false;
  private lockMouseX: number | null = null;
  /** Point d'impact prévu sur la raquette et distance à parcourir pour l'atteindre (balle descendante). */
  private landing: { x: number; dist: number } | null = null;
  private launchTime = 0;
  private paddleTarget = 0;
  private hitstop = 0;
  /** Balle passée sous la raquette avec une Secousse en poche : ralenti de la dernière chance. */
  private lastChance = false;
  private scoringStart = 0;
  private acc = 0;
  private last = performance.now();
  private heat = 0;
  private wasArmed = false;
  private tmpPos = { x: 0, y: 0 };
  private emptySel = new Set<number>();

  constructor(canvas: HTMLCanvasElement) {
    this.hud.refreshFigureDescs(this.engine.rules.shortFigures);
    this.stage = new Stage(canvas);
    this.bricks = new BrickRenderer(this.world.bricks);
    this.veins = new VeinRenderer(this.world.bricks);
    this.paddle = new PaddleRenderer(this.world.paddle);
    this.twin = new PaddleRenderer(this.world.twinPaddle, true);
    this.twin.group.visible = false;
    this.stage.scene.add(this.twin.group);
    this.stage.scene.add(this.frame3d.group, this.veins.mesh, this.bricks.mesh, this.paddle.group, this.paddle.fanMesh, this.ball.group, this.particles.mesh, this.sparks.lines, this.rings.group, this.aim.group, this.terrain.group, this.beams.group, this.comets.points);
    this.comets.onArrive = () => this.sfx.coin();
    this.screens = new Screens(this.hud.overlay, () => this.sfx.click());

    this.input = new Input(document.getElementById('catchBtn')!, () => this.hud.overlayOpen || this.paused);
    this.input.onFirstGesture = () => this.sfx.unlock();
    this.input.onPress = () => this.onPress();
    this.input.onRelease = () => this.onRelease();
    this.input.onMute = () => this.toggleMute();
    this.input.onKey = (code) => this.onKey(code);
    this.input.onTap = (x, y) => this.onTap(x, y);
    document.getElementById('mute')!.addEventListener('click', () => this.toggleMute());
    // Quitter la partie : bouton ✕ ou Échap, avec confirmation (le jeu est en pause pendant ce temps)
    const confirm = document.getElementById('confirm')!;
    document.getElementById('quit')!.addEventListener('click', () => this.askQuit(true));
    confirm.querySelector('[data-resume]')!.addEventListener('click', () => this.askQuit(false));
    confirm.querySelector('[data-quit]')!.addEventListener('click', () => this.quitRun());
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || e.repeat) return;
      if (this.paused) this.askQuit(false);
      else if (this.phase === 'target') this.cancelTarget();
      else if (this.run) this.askQuit(true);
    });
    document.getElementById('secBtn')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.secousse();
    });
    this.hud.onUseConsumable = (i) => this.useConsumable(i);
    this.hud.onSelectBall = (i) => this.selectBall(i);
    this.hud.onUseTool = (i) => this.useTool(i);

    // Le cadrage suit la place réellement libre : le HUD change de taille en cours de partie
    const field = document.getElementById('field')!;
    const resize = () => this.stage.resize(field.getBoundingClientRect());
    window.addEventListener('resize', resize);
    new ResizeObserver(resize).observe(field);
    resize();

    this.bindEvents();
    this.demoWall();
    this.showMenu();
    requestAnimationFrame(this.frame);
  }

  private get run() {
    return this.engine.run;
  }
  private get wall() {
    return this.engine.wall;
  }
  private get pot() {
    return this.engine.pot;
  }
  private card(uid: number) {
    return this.engine.cards.get(uid) ?? this.demoCards.get(uid);
  }

  // ───────────────────────── Menus / run ─────────────────────────

  /** Mur décoratif derrière le menu. */
  private demoWall() {
    this.world.setTide(0);
    const slots = this.world.setLayout(LAYOUT_BY_ID.flipper);
    this.terrain.setup(this.world.bumpers, this.world.portals);
    for (const id of slots) {
      const r = this.fxRng.next();
      const card = newCard(this.fxRng.int(4) as BrickColor, 1 + this.fxRng.int(10), r < 0.08 ? 'verre' : r < 0.14 ? 'or' : 'none', r > 0.94 ? 'holo' : r > 0.9 ? 'poly' : 'none');
      this.demoCards.set(card.uid, card);
      this.world.setBrick(id, card);
    }
    this.bricks.spawn();
  }

  /** Ouvre (ou ferme) la confirmation pour quitter la partie ; le jeu est en pause tant qu'elle est ouverte. */
  private askQuit(open: boolean) {
    if (open && (!this.run || this.phase === 'menu')) return;
    this.paused = open;
    document.getElementById('confirm')!.hidden = !open;
    this.sfx.click();
  }

  /** Abandon : le run est perdu, retour au menu (les séquences en cours s'arrêtent grâce à `gen`). */
  private quitRun() {
    const run = this.run;
    this.askQuit(false);
    if (!run) return;
    this.gen++;
    this.profile.bestAnte = Math.max(this.profile.bestAnte, run.ante);
    this.profile.bestHand = Math.max(this.profile.bestHand, run.stats.bestHand);
    saveProfile(this.profile);
    this.input.held = false;
    this.lock = null;
    this.screens.close();
    document.body.classList.remove('frenzy');
    this.showMenu();
  }

  private showMenu() {
    this.phase = 'menu';
    document.body.classList.remove('inrun');
    this.engine.run = null;
    this.shownBiome = null;
    this.applyBiome(BIOMES.atelier);
    const newRun = () => this.screens.newRun(this.profile, (deck, stake, seed) => this.startRun(deck, stake, seed), () => this.showMenu());
    const tuto = (then: () => void, label?: string) =>
      this.screens.tutorial(() => {
        this.profile.tutoSeen = true;
        saveProfile(this.profile);
        then();
      }, label);
    this.screens.mainMenu(
      this.profile,
      () => (this.profile.tutoSeen ? newRun() : tuto(newRun, 'Jouer !')),
      () => this.screens.collection(this.profile, () => this.showMenu()),
      () => tuto(() => this.showMenu()),
    );
  }

  private startRun(deck: DeckDef, stake: number, seed: number | null) {
    this.gen++;
    this.screens.close();
    document.body.classList.add('inrun');
    this.profile.runs++;
    this.profile.lastDeck = deck.id;
    this.profile.bestAnte = Math.max(this.profile.bestAnte, 1);
    saveProfile(this.profile);
    this.engine.startRun(deck, stake, seed ?? Date.now() % 1e9);
    this.presentWall();
  }

  /** Présente le mur que le moteur vient de préparer. */
  private presentWall() {
    const run = this.run!;
    const layout = this.engine.layout!;
    this.terrain.setup(this.world.bumpers, this.world.portals);
    this.bricks.spawn();
    this.hud.setScore(0, this.wall.target, false);
    this.refreshHud();
    this.refreshPot();
    const name = WALL_NAMES[run.wallIdx];
    const biome = biomeOf(run.ante);
    this.applyBiome(biome);
    const newBiome = biome.id !== this.shownBiome;
    this.shownBiome = biome.id;
    const curse = run.wallMod?.mod;
    if (curse && !isBossWall(run)) {
      this.hud.banner(`${curse.glyph} ${curse.name.toUpperCase()}`, `Mur maudit · Objectif ${fmt(this.wall.target)}`, '#b85cff');
      this.enterAim();
    } else if (isBossWall(run)) {
      this.phase = 'between';
      const extra = run.boss.requiredValue ? `{x}${run.bossValue}{/}` : run.boss.eclipse ? colorText(run.eclipseColor) : '';
      this.screens.bossIntro(run.boss, run.ante, this.wall.target, extra, () => this.enterAim());
    } else {
      if (newBiome) this.hud.banner(biome.name.toUpperCase(), `${biome.tagline} · ${layout.name}`, biome.rail);
      else this.hud.banner(layout.name.toUpperCase(), `Ante ${run.ante} · ${name} · Objectif ${fmt(this.wall.target)}`, biome.rail);
      this.enterAim();
    }
  }

  private applyBiome(b: BiomeDef) {
    this.stage.background.uniforms.uHue.value = b.hue;
    this.frame3d.setRail(b.rail);
  }

  private enterAim() {
    this.phase = 'aim';
    this.refreshHud();
    this.updateHint();
  }

  private afterLancer() {
    const r = this.engine.afterLancer();
    this.refreshPot();
    if (r === 'won') this.wallWon();
    else if (r === 'lost') {
      const price = this.engine.rescuePrice;
      if (price === null) return this.gameOver();
      this.phase = 'between';
      this.screens.rescue(price, this.run!.money, this.wall.score, this.wall.target, () => {
        this.engine.buyRescue();
        this.sfx.coin();
        this.enterAim();
      }, () => this.gameOver());
    } else this.enterAim();
  }

  private wallWon() {
    this.phase = 'between';
    this.sfx.win();
    this.stage.shake.add(0.5);
    this.hud.banner('MUR BRISÉ !', `${fmt(this.wall.score)} / ${fmt(this.wall.target)}`, '#ffc53d');
    for (let i = 0; i < 6; i++) {
      setTimeout(() => this.particles.burst(this.fxRng.range(-7, 7), this.fxRng.range(-4, 10), BRICK_COLORS[i % 4], 30, 1.4), i * 120);
    }
    const gen = this.gen;
    setTimeout(() => {
      if (gen !== this.gen) return; // partie quittée entre-temps
      const { lines, total } = this.engine.rewards();
      lines.forEach((_, i) => setTimeout(() => this.sfx.coin(), 200 + i * 350));
      this.screens.cashOut(lines, total, () => {
        this.engine.collect(total);
        this.sfx.coin();
        const next = () => (this.engine.isVictory ? this.victory() : this.openShop());
        if (this.run!.wallMod?.reward.kind === 'relic') this.curseRelic(next);
        else next();
      });
    }, 800);
  }

  /** Récompense d'un Mur maudit brisé : une Relique rare au choix (ou de l'argent si plus de place). */
  private curseRelic(then: () => void) {
    const run = this.run!;
    if (run.relics.length >= MAX_RELICS) {
      run.money += 10;
      this.hud.banner('MUR MAUDIT BRISÉ', 'Plus de place pour une Relique : +$10', '#b85cff');
      return then();
    }
    const rare = rollRelics(run, 8).filter((d) => d.rarity !== 'commun');
    const defs = (rare.length >= 2 ? rare : rollRelics(run, 2)).slice(0, 2);
    this.screens.relicChoice('Mur maudit brisé : choisis ta Relique', defs, (d) => {
      if (d) {
        run.relics.push({ def: d, counter: 0 });
        this.sfx.rune();
        this.markSeen();
      }
      this.screens.close();
      then();
    });
  }

  private victory() {
    const run = this.run!;
    this.profile.wins++;
    this.profile.maxStake = Math.min(STAKES.length - 1, Math.max(this.profile.maxStake, run.stakeIdx + 1));
    this.profile.bestAnte = Math.max(this.profile.bestAnte, run.ante);
    saveProfile(this.profile);
    this.sfx.win();
    this.screens.gameOver(true, run, `Tu as vaincu les 8 Antes avec le ${run.deck.name} en ${run.stake.name} !`, () => this.showMenu(), () => {
      this.engine.endless = true;
      this.openShop();
      this.hud.banner('MODE INFINI', 'Les objectifs s\'envolent · Reliques Polychromes plus fréquentes', '#ff7af0');
    });
  }

  private gameOver() {
    const run = this.run!;
    this.phase = 'between';
    this.sfx.lost();
    this.profile.bestAnte = Math.max(this.profile.bestAnte, run.ante);
    this.profile.bestHand = Math.max(this.profile.bestHand, run.stats.bestHand);
    saveProfile(this.profile);
    this.screens.gameOver(false, run,
      `Tombé au ${WALL_NAMES[run.wallIdx]} de l'Ante ${run.ante} avec ${fmt(this.wall.score)} / ${fmt(this.wall.target)}.`,
      () => this.showMenu());
  }

  // ───────────────────────── Boutique ─────────────────────────

  private openShop() {
    this.phase = 'between';
    this.engine.openShop();
    this.markSeen();
    this.renderShop();
  }

  /** Brique du deck choisie dans l'Atelier. */
  private atelierSel: number | null = null;

  private markSeen() {
    const seen = new Set(this.profile.seenRelics);
    for (const it of this.engine.shopItems) if (it.type === 'relic') seen.add(it.def.id);
    for (const r of this.run!.relics) seen.add(r.def.id);
    this.profile.seenRelics = [...seen];
    saveProfile(this.profile);
  }

  private renderShop() {
    const run = this.run!;
    let ante = run.ante, idx = run.wallIdx + 1;
    if (idx > 2) { idx = 0; ante++; }
    const next = `Prochain : <b>${WALL_NAMES[idx]}</b> de l'Ante ${ante} · Objectif <b class="t-g">${fmt(targetOf(run, ante, idx))}</b>` +
      (idx === 2 || ante === run.ante ? `<br>Boss de l'Ante : <b>${run.boss.glyph} ${run.boss.name}</b>` : '');
    const offer = this.engine.wallModOffer;
    const sel = run.cards.find((c) => c.uid === this.atelierSel);
    const atelier: AtelierView | null = this.engine.atelierOpen ? {
      sel: sel?.uid ?? null, removePrice: removePrice(run), retailPrice: RETAIL_PRICE,
      canRemove: canRemove(run, this.engine.atelier), canUp: canRetail(run, this.engine.atelier, sel, 1), canDown: canRetail(run, this.engine.atelier, sel, -1),
      removed: this.engine.atelier.removed, retailed: this.engine.atelier.retailed, minDeck: ATELIER_MIN_DECK,
    } : null;
    this.screens.shop(run, this.engine.shopItems, this.engine.rerollCost, next, this.engine.skipReward, offer ? { offer, on: !!run.pendingMod } : null, {
      pick: (uid) => {
        this.atelierSel = this.atelierSel === uid ? null : uid;
        this.renderShop();
      },
      remove: () => {
        if (this.atelierSel === null || !this.engine.atelierRemove(this.atelierSel)) return this.sfx.error();
        this.atelierSel = null;
        this.sfx.coin();
        this.renderShop();
      },
      retail: (delta) => {
        if (this.atelierSel === null || !this.engine.atelierRetail(this.atelierSel, delta)) return this.sfx.error();
        this.sfx.rune();
        this.renderShop();
      },
      curse: () => {
        this.engine.acceptWallMod(!run.pendingMod);
        if (run.pendingMod) this.sfx.rune(); else this.sfx.click();
        this.renderShop();
      },
      buy: (i) => this.buy(i),
      reroll: () => {
        if (!this.engine.reroll()) return this.sfx.error();
        this.markSeen();
        this.sfx.shuffle();
        this.renderShop();
      },
      sell: (i) => {
        this.engine.sell(i);
        this.sfx.coin();
        this.renderShop();
      },
      move: (i, dir) => {
        this.engine.move(i, dir);
        this.renderShop();
      },
      leave: () => {
        this.screens.close();
        if (this.engine.leaveShop()) {
          this.profile.bestAnte = Math.max(this.profile.bestAnte, run.ante);
          saveProfile(this.profile);
        }
        this.presentWall();
      },
      skip: () => {
        const skipped = WALL_NAMES[(run.wallIdx + 1) % 3];
        const r = this.engine.skipNextWall();
        if (!r) return;
        this.screens.close();
        if (r.newAnte) {
          this.profile.bestAnte = Math.max(this.profile.bestAnte, run.ante);
          saveProfile(this.profile);
        }
        this.sfx.coin();
        const go = () => {
          this.presentWall();
          this.hud.banner(`${skipped.toUpperCase()} PASSÉ`, `${r.reward.glyph} ${r.reward.name}`, '#ffc53d');
        };
        if (!r.options || !r.reward.pack) return go();
        const opts = r.options;
        const pack = PACKS[r.reward.pack].name;
        const show = (note = 'Récompense pour avoir passé le mur.') => this.screens.pack(pack, opts, note, (pick) => {
          const res = this.engine.pickPack(opts, pick);
          if (!res.ok) return this.packFull(show);
          if (res.astre) this.announceAstre(res.astre);
          this.screens.close();
          go();
        });
        show();
      },
    }, atelier);
  }

  private buy(i: number) {
    const it = this.engine.shopItems[i];
    const r = this.engine.buy(i);
    if (!r.ok) {
      if (r.reason === 'reliques') this.hud.banner('PLUS DE PLACE', 'Vends une Relique d\'abord', '#fe5f55');
      if (r.reason === 'outils') this.hud.banner('PLUS DE PLACE', 'Tu as déjà 2 Outils', '#fe5f55');
      if (r.reason === 'consommables') this.hud.banner('PLUS DE PLACE', 'Emplacements de consommables pleins', '#fe5f55');
      return this.sfx.error();
    }
    this.sfx.coin();
    if (r.astre) this.announceAstre(r.astre);
    if (r.options && it?.type === 'pack') {
      const run = this.run!;
      const opts = r.options;
      const note = it.pack === 'briques' ? 'La brique choisie rejoint ton deck.' : it.pack === 'astres' ? 'L\'Astre choisi améliore sa main.' : `Emplacements : ${run.consumables.length}/${run.maxConsumables}`;
      const show = (n = note) => this.screens.pack(PACKS[it.pack].name, opts, n, (pick) => {
        const res = this.engine.pickPack(opts, pick);
        if (!res.ok) return this.packFull(show);
        if (res.astre) this.announceAstre(res.astre);
        else if (pick !== null) this.sfx.rune();
        this.renderShop();
      });
      show();
      return;
    }
    this.renderShop();
  }

  /** Rune choisie sans emplacement libre : le pack reste ouvert (on peut prendre une autre option ou passer). */
  private packFull(reopen: (note: string) => void) {
    this.sfx.error();
    reopen('<b class="t-m">Emplacements de consommables pleins</b> : choisis autre chose ou passe.');
  }

  private announceAstre(a: AstreDef) {
    const f = FIGURE_BY_ID[a.figure];
    this.sfx.rune();
    this.hud.banner(`${a.glyph} ${a.name.toUpperCase()}`, `${f.name} niveau ${this.run!.levels[a.figure]}`, '#2d9cff');
    this.refreshPot();
  }

  // ───────────────────────── Entrées ─────────────────────────

  private onPress() {
    if (this.phase === 'aim') {
      // Maintenir = viser (la raquette se fige), relâcher = lancer
      this.aiming = true;
      this.input.consumeBtnDrag();
    } else if (this.phase === 'play') this.sfx.armed();
  }

  private onRelease() {
    if (this.phase === 'aim' && this.aiming) {
      this.aiming = false;
      this.launch();
    }
    this.aiming = false;
  }

  private onKey(code: string) {
    if (code === 'KeyS') this.secousse();
    if (code === 'KeyR') this.useTool(-1);
    const m = /^Digit([1-6])$/.exec(code);
    if (m) this.selectBall(Number(m[1]) - 1);
  }

  private onTap(x: number, y: number): boolean {
    if (this.phase !== 'target' || !this.targeting) return false;
    const p = this.stage.screenToWorld(x, y);
    const id = this.bricks.pick(p.x, p.y);
    if (id < 0 || this.world.bricks[id].kind !== 'brick') return true;
    const sel = this.targeting.sel;
    const at = sel.indexOf(id);
    if (at >= 0) sel.splice(at, 1);
    else if (sel.length < this.targeting.rune.targets) sel.push(id);
    else return true;
    this.bricks.pulse(id, 4);
    this.sfx.click();
    this.showTargetBar();
    return true;
  }

  private get armed() {
    return this.phase === 'play' && this.input.held && this.input.holdStart > this.launchTime;
  }

  private launch() {
    if (!this.engine.launch(this.aimAngle)) return;
    this.launchTime = performance.now() + 1;
    this.lastFigureIdx = -1;
    this.phase = 'play';
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
    this.lock = null;
    this.lockTried = false;
    this.lastChance = false;
    const b = this.world.ball;
    if (kind === 'tilt') {
      this.hud.banner('TILT !', '2 Secousses dans le même trajet', '#ff3d5a');
    } else {
      this.sfx.shuffle();
      this.stage.shake.add(kind === 'save' ? 0.6 : 0.35);
      this.stage.kick(kind === 'save' ? 0.7 : 0.3);
      this.rings.spawn(b.x, b.y, TOOL_C, kind === 'save' ? 3.5 : 2, 0.4);
      this.sparks.burst(b.x, b.y, TOOL_C, kind === 'save' ? 24 : 12, 0.9);
      this.popupWorld(b.x, b.y + 1, kind === 'save' ? 'SAUVÉE !' : 'SECOUSSE', 'prow');
      if (kind === 'save') {
        this.hitstop = 0.1;
        this.hud.banner('SAUVÉE !', 'Main gardée · Série remise à 0', '#ff9a5a');
      }
    }
    this.refreshResources();
    this.refreshPot();
  }

  // ───────────────────────── Consommables ─────────────────────────

  private useConsumable(i: number) {
    const run = this.run;
    if (!run || this.phase !== 'aim') return;
    const c = run.consumables[i];
    if (!c) return;
    const r = this.engine.useInstant(i);
    if (r) {
      if (r.astre) this.announceAstre(r.astre);
      if (r.discards) {
        this.hud.banner(`${c.glyph} RUNE DU TRI`, `+${r.discards} Défausses pour ce Mur`, '#7dffb0');
        this.sfx.rune();
      } else if (r.split) {
        this.hud.banner(`${c.glyph} SCISSION`, `La balle se divisera en ${r.split + 1} au prochain Lancer`, '#9fe8ff');
        this.sfx.rune();
      } else if (r.money !== undefined) {
        this.hud.banner(`${c.glyph} ERMITE`, `+$${r.money}`, '#ffc53d');
        this.sfx.coin();
      }
      this.refreshHud();
      return;
    }
    this.phase = 'target';
    this.targeting = { rune: c as RuneDef, index: i, sel: [] };
    this.showTargetBar();
    this.updateHint();
  }

  private showTargetBar() {
    const t = this.targeting!;
    // La Mue copie la 2e brique sur la 1re, la Pince échange par paires : il leur faut des briques par 2
    const pairs = (t.rune.kind === 'rune' && t.rune.convert) || (t.rune.kind === 'tool' && t.rune.swap);
    const ready = pairs ? t.sel.length >= 2 && t.sel.length % 2 === 0 : t.sel.length > 0;
    this.hud.showTargetBar(
      t.index < 0 && t.rune.kind === 'tool'
        ? `${t.rune.glyph} Défausse : choisis jusqu'à ${t.rune.targets} briques (${t.sel.length}/${t.rune.targets}), remplacées par les prochaines de la pioche`
        : `${t.rune.glyph} ${t.rune.name} : choisis ${t.rune.targets} brique${t.rune.targets > 1 ? 's' : ''} (${t.sel.length}/${t.rune.targets})`,
      ready,
      () => this.confirmRune(),
      () => this.cancelTarget(),
    );
  }

  private cancelTarget() {
    this.targeting = null;
    this.hud.hideTargetBar();
    this.enterAim();
  }

  /** i = -1 : la Défausse (elle s'utilise comme un Outil, mais se recharge à chaque Mur sans s'acheter). */
  private useTool(i: number) {
    if (i < 0) {
      if (!this.run || this.wall.discardsLeft <= 0 || this.phase !== 'aim') return;
      this.phase = 'target';
      this.targeting = { rune: { ...DISCARD_TOOL, targets: this.engine.discardSize }, index: -1, sel: [] };
      this.showTargetBar();
      this.updateHint();
      return;
    }
    const run = this.run;
    const tool = run?.tools[i];
    if (!run || !tool || tool.used || this.phase !== 'aim') return;
    this.phase = 'target';
    this.targeting = { rune: tool.def, index: i, sel: [] };
    this.showTargetBar();
    this.updateHint();
  }

  private confirmDiscard() {
    const ids = this.engine.discardOn(this.targeting!.sel);
    for (const id of ids) {
      const b = this.world.bricks[id];
      const fx = BRICK_COLORS[b.color];
      this.bricks.pulse(id, 10);
      this.rings.spawn(b.x, b.y, fx, 2, 0.4);
      this.particles.burst(b.x, b.y, fx, 10, 0.6);
    }
    if (ids.length) {
      this.sfx.shuffle();
      this.stage.kick(0.25);
      const left = this.wall.discardsLeft;
      this.hud.banner('♻ DÉFAUSSE', `${ids.length} brique${ids.length > 1 ? 's' : ''} remplacée${ids.length > 1 ? 's' : ''} · ${left ? `encore ${left} sur ce Mur` : 'plus de Défausse sur ce Mur'}`, '#7dffb0');
    }
    this.targeting = null;
    this.hud.hideTargetBar();
    this.refreshPot();
    this.enterAim();
  }

  private confirmTool() {
    const t = this.targeting!;
    if (t.index < 0) return this.confirmDiscard();
    const def = this.engine.useTool(t.index, t.sel);
    const n = t.sel.length;
    for (const id of t.sel) {
      const b = this.world.bricks[id];
      this.bricks.pulse(b.id, 8);
      this.rings.spawn(b.x, b.y, TOOL_C, 2, 0.4);
      this.sparks.burst(b.x, b.y, TOOL_C, 10, 0.7);
    }
    this.sfx.rune();
    this.stage.kick(0.3);
    if (def) {
      const what = def.swap ? (n >= 4 ? '2 échanges de place' : 'Les 2 briques ont échangé leur place')
        : `Pulvérisée${n > 1 ? 's' : ''} au prochain Lancer : ${n > 1 ? 'elles entreront' : 'elle entrera'} dans la Main`;
      this.hud.banner(def.name.toUpperCase(), what, '#ff9a5a');
    }
    this.targeting = null;
    this.hud.hideTargetBar();
    this.refreshPot();
    this.enterAim();
  }

  private confirmRune() {
    const t = this.targeting!;
    if (t.rune.kind === 'tool') return this.confirmTool();
    const rune = this.engine.applyRuneOn(t.index, t.sel);
    // Le retour visuel prend la couleur du résultat (nouvelle couleur, Or, Verre…)
    const fx = rune.color !== undefined ? BRICK_COLORS[rune.color] : rune.enh === 'or' ? GOLD : rune.enh === 'verre' ? CYAN : PURPLE;
    for (const id of t.sel) {
      const b = this.world.bricks[id];
      this.bricks.pulse(b.id, 10);
      this.rings.spawn(b.x, b.y, fx, rune.duplicate ? 2.5 : 2.2, 0.45);
      this.particles.burst(b.x, b.y, fx, rune.destroy ? 20 : 12, rune.destroy ? 1 : 0.7);
      this.sparks.burst(b.x, b.y, fx, 14, 0.8);
      this.stage.lightFlash(b.x, b.y, fx, 20, 0.4);
    }
    this.sfx.rune();
    this.stage.kick(0.4);
    const n = t.sel.length;
    const what = rune.color !== undefined ? `${n} brique${n > 1 ? 's' : ''} passent en ${COLOR_NAMES[rune.color]} — elles comptent pour les Couleurs ${COLOR_NAMES[rune.color]}`
      : rune.enh ? `${n} brique${n > 1 ? 's' : ''} deviennent ${ENH[rune.enh].name}` : rune.destroy ? `${n} brique${n > 1 ? 's' : ''} retirée${n > 1 ? 's' : ''} du deck`
      : rune.duplicate ? 'Copie ajoutée à ta pioche' : rune.valueUp ? `+${rune.valueUp} de valeur` : rune.convert ? 'La 1re brique copie la 2e' : '';
    this.hud.banner(rune.name.toUpperCase(), what, `#${fx.getHexString()}`);
    this.targeting = null;
    this.hud.hideTargetBar();
    this.refreshPot();
    this.enterAim();
  }

  private toggleMute() {
    this.sfx.toggleMute();
    document.getElementById('mute')!.classList.toggle('off', this.sfx.muted);
  }

  private updateHint() {
    const h =
      this.phase === 'aim'
        ? '<b>Maintiens</b> <kbd>Clic</kbd> / <kbd>Espace</kbd> pour viser, <b>relâche</b> pour lancer<br><kbd>1</kbd>-<kbd>6</kbd> : balle · clic sur une Rune ou un Outil : l\'utiliser' + (this.wall.discardsLeft > 0 ? '<br><kbd>R</kbd> <b>Défausse</b> : remplace jusqu\'à ' + this.engine.discardSize + ' briques par les prochaines de la pioche' : '')
        : this.phase === 'target'
          ? 'Clique sur les briques du mur à cibler.'
          : this.phase === 'scoring'
            ? '<b>Appuie</b> sur <kbd>Clic</kbd> / <kbd>Espace</kbd> pour accélérer le décompte.'
          : 'Sois <b>sous la balle</b> quand elle ralentit : la raquette se verrouille et tes mouvements la déplacent <b>finement</b> pour orienter le renvoi (ligne dorée).<br>Maintiens <kbd>Clic</kbd> / <kbd>Espace</kbd> : <b>attraper</b> et encaisser. Balle perdue = Main perdue.<br><kbd>S</kbd> <b>Secousse</b> : pousse la balle vers la raquette ; sous la raquette, elle <b>remonte</b>. 2 dans le même trajet = <b>TILT</b>.';
    this.hud.setHint(h);
  }

  private refreshHud() {
    const run = this.run;
    if (!run) return;
    const w = this.wall;
    this.hud.setWallInfo(run.ante, WALL_NAMES[run.wallIdx], w.target, activeBoss(run), run.eclipseColor, run.bossValue, run.wallMod?.mod ?? null, run.endless);
    this.refreshResources();
    this.hud.setRelics(run.relics);
    this.hud.setConsumables(run.consumables, run.maxConsumables, this.phase === 'aim');
    this.hud.setBalls(run.balls, this.engine.selectedBall);
    this.hud.setTools(run.tools, this.phase === 'aim', { left: this.wall.discardsLeft, max: this.wall.discardsMax, size: this.engine.discardSize });
  }

  private refreshResources() {
    const run = this.run;
    if (!run) return;
    const w = this.wall;
    this.hud.setResources(w.lancersLeft, w.lancersMax, w.secoussesLeft, w.secoussesMax, run.money, w.drawPile.length, this.engine.peek());
  }

  // ───────────────────────── Événements → juice ─────────────────────────

  private bindEvents() {
    const ev = this.world.events;
    const en = this.engine.events;

    ev.on('launched', ({ x, y }) => {
      this.sfx.launch();
      this.rings.spawn(x, y, WHITE, 1.5);
    });

    ev.on('brickBroken', ({ brick, dx, dy, cause }) => {
      const col = BRICK_COLORS[brick.color];
      this.particles.burst(brick.x, brick.y, col, cause === 'explosion' ? 20 : 14, cause === 'explosion' ? 1.4 : 1, dx * 0.3, dy * 0.3);
      this.sparks.burst(brick.x, brick.y, col, 12, 1, dx * 0.4, dy * 0.4);
      this.stage.lightFlash(brick.x, brick.y, col, 16, 0.3);
      this.rings.spawn(brick.x, brick.y, col, 1.6, 0.3);
      this.bricks.shockwave(brick.x, brick.y, 3);
    });

    en.on('tripCard', ({ x, y, color }) => {
      // Mode v3 : au renvoi, la meilleure brique du trajet entre dans la Main (traînée depuis son emplacement)
      const a = this.hud.handAnchor();
      const to = this.stage.screenToWorld(a.x, a.y + 20);
      this.comets.launch({ x, y }, to, BRICK_COLORS[color], 6);
      this.rings.spawn(x, y, BRICK_COLORS[color], 1.4, 0.3);
      this.sfx.figure(2);
      this.refreshPot(true);
    });

    en.on('brick', ({ brick, card, eclipsed, out, tags, shard, money, bomb, cause }) => {
      // v3 : une brique touchée par la balle est candidate à la Main (choisie au renvoi), on montre sa valeur
      const candidate = shard && this.run?.rules.headMode === 'best' && (cause === 'ball' || cause === 'pierce');
      const lead = candidate && this.engine.tripLead()?.pb.uid === card.uid;
      if (shard && !lead) {
        // Éclat : seulement des Jetons (une candidate battue par une meilleure brique du trajet aussi)
        this.sfx.brick(this.pot.broken);
        this.popupWorld(brick.x, brick.y, `éclat +${this.engine.shardChips(card)}`, 'dim');
      } else if (lead) {
        // Meilleure brique du trajet pour l'instant : elle entrera dans la Main au renvoi
        this.sfx.brick(this.pot.broken);
        this.popupWorld(brick.x, brick.y, `${card.enh === 'pierre' ? '◆' : card.enh === 'joker' ? '★' : card.value} → Main`, 'chips');
      } else if (eclipsed) {
        this.popupWorld(brick.x, brick.y, 'Éteinte', 'dim');
        this.sfx.wall();
      } else {
        this.sfx.brick(this.pot.broken);
        this.popupWorld(brick.x, brick.y, card.enh === 'pierre' ? '◆' : String(card.value), 'chips');
        if (tags.length) {
          this.popupWorld(brick.x, brick.y + 1.1, tags.join(' · ').toUpperCase() + ' !', 'prow');
          this.sfx.figure(2 + tags.length);
          this.stage.kick(0.2 * tags.length);
        }
        if (out) {
          const a = this.hud.handAnchor();
          this.hud.popup(a.x - 70, a.y + 10, out.enh === 'pierre' ? '◆ écartée' : `${out.value} écarté`, 'dim');
        }
        if (money) this.popupWorld(brick.x + 0.6, brick.y + 0.5, `+$${money}`, 'money');
      }
      if (bomb) {
        this.stage.ripple3D(brick.x, brick.y, 1);
        this.stage.punch(0.03);
        this.stage.lightFlash(brick.x, brick.y, MULT_C, 40, 0.5);
        this.sfx.boom();
        this.stage.shake.add(0.4);
        this.stage.kick(0.5);
        this.rings.spawn(brick.x, brick.y, MULT_C, 5, 0.45);
        this.hitstop = Math.max(this.hitstop, 0.08);
      }
      this.ball.impact(1);
      this.stage.shake.add(0.1 + Math.min(0.15, this.pot.bricks.length * 0.008));
      this.hitstop = Math.max(this.hitstop, 0.03);
      this.refreshPot(true);
      this.refreshResources();
    });

    ev.on('bumperHit', ({ bumper, x, y }) => {
      this.terrain.hitBumper(bumper);
      this.stage.lightFlash(bumper.x, bumper.y, PINK, 14, 0.25);
      this.sparks.burst(x, y, PINK, 8, 0.7);
      this.sfx.paddle(6);
      this.particles.burst(x, y, PINK, 10, 0.8);
      this.rings.spawn(bumper.x, bumper.y, PINK, 2.2, 0.3);
      this.stage.shake.add(0.08);
      this.ball.impact(1);
    });

    ev.on('netSaved', ({ x, y }) => {
      this.sfx.clang();
      this.rings.spawn(x, y, TEAL, 3, 0.45);
      this.sparks.burst(x, y, TEAL, 16, 1);
      this.stage.lightFlash(x, y, TEAL, 22, 0.4);
      this.stage.toScreen(x, y + 1.5, this.tmpPos);
      this.hud.popup(this.tmpPos.x, this.tmpPos.y, 'Filet !', 't-k');
    });
    ev.on('switched', ({ brick, open }) => {
      const c = open ? TEAL : TOOL_C;
      this.sfx.clang();
      this.rings.spawn(brick.x, brick.y, c, 2.6, 0.4);
      this.stage.lightFlash(brick.x, brick.y, c, 18, 0.35);
      for (const g of this.world.bricks) if (g.gate) this.bricks.pulse(g.id, 3);
      this.stage.toScreen(brick.x, brick.y, this.tmpPos);
      this.hud.popup(this.tmpPos.x, this.tmpPos.y, open ? 'Vannes ouvertes' : 'Vannes fermées', 't-k');
    });
    ev.on('blockHit', ({ brick, x, y }) => {
      this.sfx.wall();
      this.bricks.pulse(brick.id, 2);
      this.particles.burst(x, y, WHITE, 4, 0.4);
      this.ball.impact(0.6);
    });

    ev.on('portal', ({ fromX, fromY, toX, toY }) => {
      this.rings.spawn(fromX, fromY, PURPLE, 2.5, 0.35);
      this.rings.spawn(toX, toY, CYAN, 2.5, 0.35);
      this.particles.burst(toX, toY, CYAN, 12, 0.7);
      this.stage.ripple3D(toX, toY, 0.45);
      this.stage.lightFlash(toX, toY, CYAN, 18, 0.35);
      this.sfx.rune();
      this.stage.kick(0.25);
    });

    ev.on('brickDamaged', ({ brick, x, y }) => {
      const pinata = this.card(brick.uid)?.enh === 'pinata';
      this.sfx.clang();
      this.bricks.pulse(brick.id, pinata ? 9 : 5);
      this.particles.burst(x, y, pinata ? BRICK_COLORS[this.fxRng.int(4)] : WHITE, pinata ? 14 : 8, 0.6);
      this.popupWorld(brick.x, brick.y, pinata ? ['Pif !', 'Paf !', 'Pouf !'][brick.hp % 3] : 'Clang !', pinata ? 'prow' : 'dim');
      this.ball.impact(1);
    });

    ev.on('twinHit', ({ x, y }) => {
      this.twin.hit(1);
      this.sfx.paddle(this.pot.streak);
      this.rings.spawn(x, y, PURPLE, 1.6, 0.3);
      this.sparks.burst(x, y, PURPLE, 10, 0.6, 0, -1);
      this.stage.lightFlash(x, y - 0.5, PURPLE, 10, 0.2);
      if (this.run && this.phase === 'play') this.popupWorld(x, y - 1.2, `SÉRIE ${this.pot.streak} ×${seriesMult(this.pot.streak, this.run.relics)}`, 'mult');
      this.refreshPot();
    });

    ev.on('split', ({ x, y }) => {
      this.sfx.rune();
      this.rings.spawn(x, y, CYAN, 2.6, 0.4);
      this.sparks.burst(x, y, CYAN, 18, 0.9);
      this.stage.lightFlash(x, y, CYAN, 20, 0.3);
      this.stage.kick(0.3);
      this.popupWorld(x, y + 1, 'SCISSION !', 'prow');
      this.refreshPot();
    });
    ev.on('extraLost', ({ x }) => {
      this.sfx.wall();
      this.particles.burst(x, FIELD.bottom + 0.5, CYAN, 16, 0.8, 0, 1);
      this.refreshPot();
    });
    ev.on('extraPopped', ({ x, y }) => {
      this.rings.spawn(x, y, GOLD, 2.4, 0.4);
      this.particles.burst(x, y, GOLD, 20, 1);
      this.popupWorld(x, y + 0.8, '+×0.5', 'mult');
      this.sfx.coin();
    });
    ev.on('promoted', ({ x, y }) => {
      this.ball.reset(x, y);
      this.sfx.armed();
      this.hud.banner('RELÈVE !', 'Une autre balle vole encore : la Main est sauve', '#9fe8ff');
      this.rings.spawn(x, y, CYAN, 3, 0.45);
      this.refreshPot();
    });

    ev.on('paddleHit', ({ x, y, speed, extra }) => {
      if (extra) {
        this.sfx.paddle(2);
        this.paddle.hit(0.5);
        this.rings.spawn(x, y, CYAN, 1, 0.25);
        this.sparks.burst(x, y, CYAN, 6, 0.5, 0, 1);
        return;
      }
      this.sfx.paddle(this.pot.rebounds);
      if (this.run && this.pot.streak > 0) this.popupWorld(x, y + 1.2, `SÉRIE ${this.pot.streak} ×${seriesMult(this.pot.streak, this.run.relics)}`, 'mult');
      this.paddle.hit(1);
      this.ball.impact(1.2);
      this.stage.shake.add(0.07);
      this.particles.burst(x, y, this.ball.color, 8, 0.6, 0, 1);
      this.rings.spawn(x, y, MULT_C, 1.2 + speed * 0.05, 0.3);
      this.sparks.burst(x, y, this.ball.color, 10, 0.6, 0, 1);
      this.stage.lightFlash(x, y + 0.5, this.ball.color, 10, 0.2);
      this.refreshPot();
    });

    ev.on('wallHit', ({ x, y }) => {
      const sm = this.engine.currentBall?.wallMult;
      if (sm && this.phase === 'play') this.popupWorld(x, y, `+${sm} Mult`, 'mult');
      if (this.phase === 'play') this.refreshPot();
      this.sfx.wall();
      this.ball.impact(0.5);
      this.frame3d.pulse(x, y, 0.8);
      this.sparks.burst(x, y, WHITE, 5, 0.5);
    });

    ev.on('wrapped', ({ fromX, toX, y }) => {
      this.rings.spawn(fromX, y, PURPLE, 1.5, 0.3);
      this.rings.spawn(toX, y, PURPLE, 1.5, 0.3);
      this.sfx.wall();
    });

    ev.on('caught', ({ x, y }) => {
      this.paddle.hit(1.5);
      this.rings.spawn(x, y, GOLD, 3, 0.5);
      this.particles.burst(x, y, GOLD, 24, 1, 0, 1);
      this.hitstop = 0.08;
    });

    en.on('lancerEnd', (e) => this.onLancerEnd(e));

    en.on('cleared', () => {
      this.hud.banner('MUR PULVÉRISÉ !', 'Nouvelles briques', '#3fd18f');
      this.stage.ripple3D(0, 6, 1.4);
      this.stage.whiteFlash(0.4);
      this.stage.shake.add(0.5);
      this.stage.kick(0.6);
      this.hitstop = 0.25;
      this.sfx.win();
    });

    en.on('frenzy', ({ x, y }) => {
      this.hud.banner('FRÉNÉSIE !', 'La balle brûle et traverse une brique par trajet', '#ff5a1f');
      this.sfx.figure(6);
      this.stage.shake.add(0.5);
      this.stage.kick(0.7);
      this.stage.whiteFlash(0.25);
      this.stage.lightFlash(x, y, MULT_C, 40, 0.6);
      this.rings.spawn(x, y, MULT_C, 5, 0.5);
      this.sparks.burst(x, y, MULT_C, 40, 1.3);
      this.hitstop = Math.max(this.hitstop, 0.12);
      this.refreshPot();
    });
    en.on('bigFigure', ({ x, y, figure }) => {
      this.hud.banner(`${figure.name.toUpperCase()} !!!`, 'Onde de choc', '#ffc53d');
      this.sfx.boom();
      this.sfx.figure(8);
      this.hitstop = Math.max(this.hitstop, 0.32);
      this.stage.whiteFlash(0.6);
      this.stage.ripple3D(x, y, 1.6);
      this.stage.punch(0.08);
      this.stage.shake.add(0.9);
      this.stage.kick(1);
      this.rings.spawn(x, y, GOLD, 9, 0.7);
      this.rings.spawn(x, y, WHITE, 5, 0.5);
      this.sparks.burst(x, y, GOLD, 60, 1.6);
      this.particles.burst(x, y, GOLD, 60, 1.6);
      this.bricks.shockwave(x, y, 10);
    });
    en.on('spawned', ({ ids }) => {
      this.bricks.spawn(ids);
      for (const id of ids) {
        const b = this.world.bricks[id];
        this.sparks.burst(b.x, b.y, WHITE, 8, 0.5);
      }
      this.sfx.shuffle();
      this.refreshPot();
    });
    en.on('morphed', ({ ids }) => {
      for (const id of ids) {
        const b = this.world.bricks[id];
        this.bricks.pulse(id, 4);
        this.sparks.burst(b.x, b.y, PURPLE, 6, 0.5);
      }
    });
    en.on('fled', ({ from, to }) => {
      const a = this.world.bricks[from], b = this.world.bricks[to];
      this.particles.burst(a.x, a.y, TEAL, 16, 0.8);
      this.bricks.spawn([to]);
      this.popupWorld(b.x, b.y + 0.8, 'Fuyarde !', 'prow');
      this.sfx.shuffle();
      this.refreshPot();
    });
    en.on('relicLost', ({ def }) => {
      this.hud.banner('PACTE DU DIABLE', `${def.glyph} ${def.name} est détruite`, '#ff3d5a');
      this.sfx.glass();
      this.stage.shake.add(0.4);
      this.refreshHud();
    });

    en.on('settled', ({ moves }) => {
      this.bricks.drop(moves);
      this.sfx.shuffle();
    });
    en.on('painted', ({ ids, color }) => {
      const fx = BRICK_COLORS[color];
      for (const id of ids) {
        const b = this.world.bricks[id];
        this.bricks.pulse(id, 5);
        this.particles.burst(b.x, b.y, fx, 6, 0.5);
      }
    });
    en.on('refilled', () => {
      this.bricks.spawn();
      this.refreshResources();
      this.refreshPot();
    });
  }

  private onLancerEnd(e: LancerEnd) {
    if (e.kind === 'empty') return this.afterLancer();
    if (e.kind === 'cash' || e.kind === 'insured') {
      if (e.kind === 'insured') {
        this.hud.banner('ASSURANCE', `${e.keep * 100}% de la Main sauvée`, '#2d9cff');
        this.ballLostFx(e.x);
      }
      void this.cashIn(e.res, e.x);
      return;
    }
    this.ballLostFx(e.x);
    this.sfx.lost();
    if (e.potLost) this.hud.banner('MAIN PERDUE', '', '#ff3d5a');
    this.hud.potState('lost');
    this.refreshHud();
    this.afterLancer();
  }

  private ballLostFx(x: number) {
    this.stage.ripple3D(x, FIELD.bottom + 1, 0.9);
    this.stage.shake.add(0.65);
    this.stage.kick(0.8);
    this.particles.burst(x, FIELD.bottom + 0.5, MULT_C, 40, 1.4, 0, 1);
    this.hitstop = 0.15;
  }

  /** Aperçu live du Pot + annonce quand la Figure monte en gamme. */
  private refreshPot(fromBrick = false) {
    const run = this.run;
    if (!run) return;
    // Aperçu : les balles en l'air compteraient si on encaissait maintenant
    if (this.phase === 'play') this.pot.airBalls = this.world.extras.length;
    // v3 : la Main affichée inclut la meilleure brique du trajet en cours (ce qu'on encaisserait maintenant)
    const pot = this.engine.previewPot();
    const lead = pot !== this.pot ? this.engine.tripLead() : null;
    const res = this.engine.score(null, false, 1, pot);
    const idx = figureIndex(res.figure);
    const upgraded = fromBrick && idx > this.lastFigureIdx && idx >= 1;
    this.lastFigureIdx = idx;
    if (upgraded && res.figure) {
      const b = this.world.ball;
      this.stage.ripple3D(b.x, b.y, 0.5);
      this.stage.punch(0.025 + idx * 0.006);
      this.sparks.burst(b.x, b.y, GOLD, 24, 1.1);
      this.hud.banner(res.figure.name.toUpperCase() + ' !', figureDesc(res.figure, run.rules.shortFigures), '#fe5f55');
      this.sfx.figure(idx);
      this.stage.shake.add(0.3);
      this.stage.kick(0.5);
      this.hitstop = Math.max(this.hitstop, 0.1);
    }
    const remaining = Math.max(1, this.wall.target - this.wall.score);
    this.heat = clamp(res.total / remaining, 0, 1);
    this.hud.setPot(res.figure?.name ?? null, res.level, res.chips, res.mult, res.total, this.heat, upgraded);
    this.hud.setFigures(res.figure?.id ?? null, run.levels, this.engine.played);
    this.hud.setProwess(res.prowess.map((p) => `${PROWESS[p.id].glyph} ${PROWESS[p.id].name}${p.count > 1 ? ' ×' + p.count : ''}`),
      { streak: this.pot.streak, mult: seriesMult(this.pot.streak, run.relics) },
      { frenzy: this.pot.frenzy, air: this.world.extras.length, toFrenzy: frenzyStreak(run.relics) - this.pot.streak });
    this.hud.setHand(pot.bricks, pot.size, res.scoringUids, lead?.pb.uid ?? null);
    this.hud.setShards(run.rules.headRule ? pot.shards : 0, pot.shardChips, this.engine.tripCount);
    // Outs : quelles briques du mur feraient monter la Main
    const fog = !!activeBoss(run)?.fog;
    const outs = this.engine.outs();
    this.useful = fog ? new Set() : outs.useful;
    this.hud.setOuts(outs.targets.map((t) => ({ figure: t.figure.name, need: t.need })), pot.empty, fog, res.blocked, this.engine.orders, run.rules.headRule && run.rules.headMode === 'best');
  }

  /** La séquence d'encaissement : chaque étape du pipeline est rejouée et "sentie". */
  private async cashIn(res: ScoreResult, x: number) {
    const gen = this.gen;
    this.phase = 'scoring';
    this.scoringStart = performance.now();
    this.updateHint();
    this.hud.potState('scoring');
    this.hud.setPot(res.figure?.name ?? null, res.level, 0, 0, 0, this.heat);
    await this.quick(250);
    if (gen !== this.gen) return;
    const anchor = this.hud.anchor('pot');
    for (let i = 0; i < res.steps.length; i++) {
      const s = res.steps[i];
      const kind = s.money ? 'money' : s.xmult !== undefined ? 'xmult' : s.mult && !s.chips ? 'mult' : 'chips';
      if (kind === 'money') this.sfx.coin();
      else this.sfx.step(i, kind);
      this.hud.setPot(res.figure?.name ?? null, res.level, s.chipsAfter, s.multAfter, Math.floor(s.chipsAfter * s.multAfter), this.heat);
      if (s.chips) this.hud.tickChips();
      if (s.mult || s.xmult !== undefined) this.hud.tickMult();
      if (s.source.kind === 'relic') {
        this.hud.triggerRelic(s.source.index, s.label, kind);
      } else if (kind === 'money') {
        const m = this.hud.anchor('money');
        this.hud.popup(m.x, m.y, s.label, 'money');
      } else if (s.source.kind === 'brick') {
        const h = this.hud.handAnchor();
        this.hud.popup(h.x + this.fxRng.range(-60, 60), h.y, s.label, kind);
      } else {
        this.hud.popup(anchor.x + this.fxRng.range(-50, 50), anchor.y, s.label, kind);
      }
      this.stage.shake.add(kind === 'xmult' ? 0.25 : 0.06);
      if (kind === 'xmult') this.stage.kick(0.35);
      const c = s.source.kind === 'brick' && s.source.color >= 0 ? BRICK_COLORS[s.source.color] : kind === 'chips' ? CHIPS_C : kind === 'money' ? GOLD : MULT_C;
      this.particles.burst(x + this.fxRng.range(-1, 1), FIELD.paddleY + 0.6, c, 6, 0.6, 0, 1);
      // Le rythme accélère : plus il y a d'étapes, plus ça s'emballe
      await this.quick(Math.max(70, 360 - i * 40));
      if (gen !== this.gen) return;
    }
    await this.quick(200);
    if (gen !== this.gen) return;

    const total = res.total;
    if (res.blocked) this.hud.banner('ANNULÉ', res.blocked, '#ff3d5a');
    // Un seul encaissement brise tout le mur : le score s'embrase
    const onFire = !res.blocked && total >= this.wall.target;
    const { destroyed } = this.engine.commitCashIn(res);
    if (total > this.profile.bestHand) {
      this.profile.bestHand = total;
      saveProfile(this.profile);
    }
    const power = clamp(total / this.wall.target, 0.15, 1);
    this.sfx.cashIn(power);
    this.stage.shake.add(0.3 + power * 0.6);
    this.stage.kick(0.5 + power);
    this.hitstop = 0.12;
    this.rings.spawn(x, FIELD.paddleY, GOLD, 6 + power * 10, 0.7);
    this.stage.ripple3D(x, FIELD.paddleY, 0.6 + power * 0.8);
    this.stage.punch(0.02 + power * 0.06);
    this.beams.spawn(x, FIELD.paddleY, GOLD, power, this.stage.camera);
    // Comètes dorées qui filent vers le compteur de score
    const sr = document.getElementById('score')!.getBoundingClientRect();
    const target = this.stage.screenToWorld(sr.left + sr.width / 2, sr.top + sr.height / 2);
    this.comets.launch({ x, y: FIELD.paddleY + 0.5 }, target, GOLD, Math.round(10 + power * 30));
    this.stage.whiteFlash(power * 0.5);
    this.stage.lightFlash(x, FIELD.paddleY + 1, GOLD, 30 + power * 40, 0.8);
    this.sparks.burst(x, FIELD.paddleY + 0.5, GOLD, Math.round(20 + power * 50), 1.2, 0, 1);
    this.particles.burst(x, FIELD.paddleY + 0.5, GOLD, Math.round(30 + power * 80), 1 + power, 0, 1.2);
    if (onFire) {
      this.hud.banner(`+${fmt(total)}`, `🔥 En feu ! ${res.figure?.name ?? ''}`, '#ff7a1f');
      this.hud.scoreFlames();
      this.stage.shake.add(0.5);
      for (let i = 0; i < 5; i++) {
        setTimeout(() => this.particles.burst(this.fxRng.range(-7, 7), this.fxRng.range(-8, 2), MULT_C, 30, 1.5, 0, 1.4), i * 90);
      }
    } else if (!res.blocked) this.hud.banner(`+${fmt(total)}`, res.figure?.name ?? '', '#ffc53d');
    this.hud.setScore(this.wall.score, this.wall.target);
    if (destroyed) {
      this.sfx.glass();
      this.hud.popup(anchor.x, anchor.y + 40, `${destroyed} Verre${destroyed > 1 ? 's' : ''} brisé${destroyed > 1 ? 's' : ''} !`, 'dim');
    }
    this.refreshHud();
    await this.quick(750);
    if (gen !== this.gen) return;
    this.hud.potState('idle');
    this.afterLancer();
  }

  /** Attente de la séquence d'encaissement : maintenir le clic l'accélère (×4). */
  private quick(ms: number) {
    // Un nouvel appui seulement : le clic maintenu pour attraper la balle ne compte pas
    const fast = this.input.held && this.input.holdStart > this.scoringStart;
    return wait(fast ? ms / 4 : ms);
  }

  private popupWorld(x: number, y: number, text: string, cls: string) {
    this.stage.toScreen(x, y, this.tmpPos);
    this.hud.popup(this.tmpPos.x, this.tmpPos.y, text, cls);
  }

  // ───────────────────────── Guide de visée ─────────────────────────

  /**
   * Au lancement : trajectoire selon l'angle visé.
   * En jeu, quand la balle redescend : point d'impact sur la raquette + trajectoire du renvoi
   * selon la position actuelle de la raquette. La brique visée s'allume.
   */
  private updateGuide(fog: boolean) {
    const w = this.world;
    const b = w.ball;
    const paths: GuidePath[] = [];
    let marker: { x: number; y: number; ok: boolean } | null = null;
    this.aimedBrick = -1;
    const top = w.paddle.y + w.paddle.h / 2 + BALL_R;
    if (this.phase === 'aim' && b.stuck) {
      const sa = snapAngle(w, b.x, b.y, this.aimAngle);
      const pr = predictPath(w, b.x, b.y, Math.sin(sa), Math.cos(sa), 2, null);
      paths.push({ pts: pr.pts, color: this.aiming ? AIM_GOLD : AIM_DIM, size: this.aiming ? 1.1 : 0.7 });
      this.aimedBrick = pr.brick;
    } else if (this.phase === 'play' && !b.stuck && b.dy < 0) {
      const incoming = predictPath(w, b.x, b.y, b.dx, b.dy, 4, top);
      paths.push({ pts: incoming.pts, color: AIM_DIM, size: 0.55 });
      if (incoming.landX !== null) {
        const half = w.paddle.w / 2 + BALL_R;
        const ok = Math.abs(incoming.landX - w.paddle.x) <= half;
        marker = { x: incoming.landX, y: w.paddle.y + w.paddle.h / 2 + 0.05, ok };
        if (ok && !this.armed) {
          const d = bounceDir(w, incoming.landX);
          const out = predictPath(w, incoming.landX, top, d.dx, d.dy, 2, null);
          paths.push({ pts: out.pts, color: AIM_GOLD, size: 1 });
          this.aimedBrick = out.brick;
        }
      }
    }
    if (fog || (this.aimedBrick >= 0 && this.world.bricks[this.aimedBrick].kind !== 'brick')) this.aimedBrick = -1;
    this.aim.set(paths, marker);
  }

  /**
   * Quand la balle entre dans la zone de ralenti, si la raquette est assez proche du point d'impact,
   * elle se verrouille dessous : le mouvement du joueur oriente alors finement le renvoi.
   * Retourne true si la raquette est verrouillée.
   */
  private updateLock(dt: number, mirror: number): boolean {
    const w = this.world;
    const b = w.ball;
    const descending = this.phase === 'play' && !b.stuck && b.dy < 0;
    if (!descending) {
      this.lock = null;
      this.lockTried = false;
      return false;
    }
    const land = this.landing;
    if (!this.lock && !this.lockTried && land && land.dist < FOCUS_DIST) {
      this.lockTried = true;
      if (Math.abs(w.paddle.x - land.x) <= w.paddle.w / 2 + BALL_R + LOCK_REACH) {
        const natural = angleForPaddleX(w, land.x, clampPaddle(w, w.paddle.x));
        this.lock = { landX: land.x, angle: natural };
        this.lockMouseX = this.input.mouseX;
        this.input.consumeDrag();
        this.sfx.armed();
      }
    }
    if (!this.lock) return false;
    let d = this.input.consumeDrag();
    if (!this.input.touch && this.input.mouseX !== null) {
      if (this.lockMouseX !== null) d += this.input.mouseX - this.lockMouseX;
      this.lockMouseX = this.input.mouseX;
    }
    // La raquette suit le mouvement (en plus fin) : vers la droite, elle se décale à droite
    // et la balle, touchée plus à gauche sur la raquette, part plus à gauche — comme sans verrouillage.
    this.lock.angle -= mirror * (d * AIM_GAIN + this.input.keyDir * 0.9 * dt);
    this.lock.angle = clamp(this.lock.angle, -MAX_BOUNCE_ANGLE * 0.98, MAX_BOUNCE_ANGLE * 0.98);
    return true;
  }

  /** Où et dans combien de distance la balle (descendante) atteindra la raquette ; null si une brique s'interpose. */
  private predictLanding(): { x: number; dist: number } | null {
    const w = this.world;
    const b = w.ball;
    if (this.phase !== 'play' || b.stuck || b.dy >= 0) return null;
    const top = w.paddle.y + w.paddle.h / 2 + BALL_R;
    const inc = predictPath(w, b.x, b.y, b.dx, b.dy, 5, top);
    if (inc.landX === null) return null;
    let dist = 0;
    for (let i = 1; i < inc.pts.length; i++) {
      const p = inc.pts[i - 1], q = inc.pts[i];
      if (!Number.isNaN(p.x) && !Number.isNaN(q.x)) dist += Math.hypot(q.x - p.x, q.y - p.y);
    }
    return { x: inc.landX, dist };
  }

  // ───────────────────────── Boucle ─────────────────────────

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    // Derrière un écran plein (menus, boutique, pause), la scène floutée se contente de ~30 i/s
    const throttled = this.hud.overlayOpen;
    if (throttled && now - this.last < 1000 / 30 - 4) return;
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    const run = this.run;
    const boss = run ? activeBoss(run) : null;
    const mirror = boss?.mirror ? -1 : 1;

    this.landing = this.predictLanding();

    // Visée du lancer (raquette figée) ou déplacement de la raquette
    const half = this.world.paddle.w / 2;
    const aimingNow = this.phase === 'aim' && this.aiming && this.input.held;
    if (aimingNow) {
      const b = this.world.ball;
      if (this.input.mouseX !== null && !this.input.touch) {
        const p = this.stage.screenToWorld(this.input.mouseX, this.input.mouseY);
        if (p.y > b.y + 0.5) this.aimAngle = Math.atan2(p.x - b.x, p.y - b.y);
      }
      this.aimAngle += this.input.consumeBtnDrag() * 0.012 + this.input.keyDir * 1.6 * dt;
      this.aimAngle = clamp(this.aimAngle, -MAX_LAUNCH_ANGLE, MAX_LAUNCH_ANGLE);
      this.input.consumeDrag();
    } else if (this.updateLock(dt, mirror)) {
      // Raquette verrouillée : elle se place seule pour produire l'angle visé
      this.paddleTarget = paddleXForAngle(this.world, this.lock!.landX, this.lock!.angle);
    } else {
      if (this.input.mouseX !== null && !this.input.touch) {
        this.paddleTarget = mirror * this.stage.screenToWorldX(this.input.mouseX, this.input.mouseY);
      }
      this.paddleTarget += mirror * this.input.consumeDrag() * this.stage.worldPerPixel * 1.4;
      this.paddleTarget += mirror * this.input.keyDir * 24 * dt;
    }
    this.paddleTarget = clamp(this.paddleTarget, FIELD.left + half, FIELD.right - half);

    const armed = this.armed;
    if (armed && !this.wasArmed) this.paddle.hit(0.4);
    this.wasArmed = armed;

    // Focus : la balle ralentit quand elle approche de la raquette, pour viser le renvoi
    const ball = this.world.ball;
    const focus = this.phase === 'play' && !!this.landing && this.landing.dist < FOCUS_DIST && ball.y > FIELD.paddleY - 0.5;
    // Dernière chance : la balle a passé la raquette, une Secousse peut encore la sauver
    const chance = this.phase === 'play' && this.world.ballBelowPaddle && this.wall.secoussesLeft > 0 && this.world.tiltsThisTrip === 0;
    if (chance && !this.lastChance) {
      this.sfx.armed();
      this.popupWorld(ball.x, FIELD.paddleY - 0.5, 'SECOUSSE !', 'prow');
    }
    this.lastChance = chance;
    // Plus la Série monte, plus le ralenti est court : le rythme s'emballe
    const focusScale = FOCUS_SCALE + Math.min(0.2, this.pot.streak * 0.03);
    const scale = chance ? LAST_CHANCE_SCALE : focus ? focusScale : 1;
    this.timeScale += (scale - this.timeScale) * Math.min(1, dt * (chance ? 30 : 12));
    this.updateGuide(boss?.fog ?? false);

    // Hit-stop : la sim gèle, le rendu continue (shake, particules…)
    if (this.hitstop > 0) {
      this.hitstop -= dt;
    } else if (run && !this.paused && (this.phase === 'aim' || this.phase === 'play' || this.phase === 'scoring')) {
      this.acc += dt * this.timeScale;
      const speedMul = this.engine.speedMul();
      while (this.acc >= STEP) {
        this.engine.step(STEP, { paddleTargetX: this.paddleTarget, catchArmed: armed, speedMul });
        this.acc -= STEP;
      }
    } else {
      this.acc = 0;
      this.world.moveRows(dt);
    }
    this.terrain.update(dt);

    const frenzy = this.phase === 'play' && this.pot.frenzy;
    document.body.classList.toggle('frenzy', frenzy);
    const ballHeat = frenzy ? 1 : clamp(this.pot.rebounds / 10 + this.pot.bricks.length / 40, 0, 1);
    const sel = this.targeting ? new Set([...this.targeting.sel, ...this.engine.lasered]) : this.engine.lasered;
    this.bricks.update(dt, this.heat, {
      card: (uid) => this.card(uid),
      selected: sel,
      eclipse: boss?.eclipse && run ? run.eclipseColor : -1,
      fog: !!boss?.fog,
      aimed: this.aimedBrick,
      useful: this.phase === 'aim' || this.phase === 'play' ? this.useful : this.emptySel,
      dark: run?.wallMod?.mod.dark && this.phase !== 'between' ? this.world.balls.map((b) => ({ x: b.x, y: b.y })) : null,
    });
    this.veins.update(dt, (uid) => this.card(uid), !!boss?.fog || !!run?.wallMod?.mod.dark);
    this.aim.update(dt);
    this.paddle.update(dt, armed, this.lock);
    this.twin.group.visible = this.world.twin && !!run;
    if (this.twin.group.visible) this.twin.update(dt, false, null);
    this.ball.update(dt, this.world.ball, ballHeat, !this.world.ball.stuck, this.stage.camera);
    this.syncExtras(dt, ballHeat);
    // La lumière de la balle éclaire les briques au passage
    const bl = this.stage.ballLight;
    bl.position.set(this.world.ball.x, this.world.ball.y, 1.1);
    bl.color.copy(this.ball.color);
    bl.intensity = (this.world.ball.stuck ? 4 : 9) + ballHeat * 22;
    this.frame3d.update(dt, Math.max(this.heat, ballHeat * 0.5));
    const flying = !this.world.ball.stuck && this.phase === 'play';
    // Escarbilles : une balle brûlante sème des étincelles
    if (flying && ballHeat > 0.45) {
      this.emberT += dt * (ballHeat - 0.4) * 60;
      while (this.emberT > 1) {
        this.emberT -= 1;
        this.sparks.burst(this.world.ball.x, this.world.ball.y, this.ball.color, 1, 0.25, -this.world.ball.dx * 0.3, -this.world.ball.dy * 0.3);
      }
    }
    this.beams.update(dt);
    this.comets.update(dt);
    this.sparks.update(dt);
    this.particles.update(dt);
    this.rings.update(dt);
    this.hud.setButtons(this.phase === 'aim' ? 'launch' : this.phase === 'play' ? 'catch' : 'off', armed, this.phase === 'play' && this.wall.secoussesLeft > 0 && !this.world.ball.stuck);
    this.stage.render(dt, Math.max(this.heat, ballHeat * 0.5), this.world.paddle.x, !throttled);
  };

  /** Rendu des balles supplémentaires : un BallRenderer par identifiant, recyclé quand la balle disparaît. */
  private syncExtras(dt: number, heat: number) {
    const seen = new Set<number>();
    for (const e of this.world.extras) {
      seen.add(e.id);
      let r = this.extraR.get(e.id);
      if (!r) {
        r = this.ballPool.pop() ?? this.newBallRenderer();
        r.group.visible = true;
        r.reset(e.x, e.y);
        this.extraR.set(e.id, r);
      }
      r.update(dt, e, Math.max(0.35, heat), true, this.stage.camera);
    }
    for (const [id, r] of this.extraR) {
      if (seen.has(id)) continue;
      r.group.visible = false;
      this.extraR.delete(id);
      this.ballPool.push(r);
    }
  }

  private newBallRenderer() {
    const r = new BallRenderer();
    this.stage.scene.add(r.group);
    return r;
  }
}

function clampPaddle(w: World, x: number) {
  const half = w.paddle.w / 2;
  return clamp(x, FIELD.left + half, FIELD.right - half);
}
