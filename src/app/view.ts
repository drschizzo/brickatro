import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { BrickCard } from '../rules/bricks';
import type { BiomeDef } from '../rules/biomes';
import { BallRenderer, Frame, PaddleRenderer } from '../render/actors';
import { AimGuide } from '../render/aim';
import { BrickRenderer } from '../render/bricks';
import { Beams, Comets } from '../render/fx3d';
import { Particles, Rings, Sparks } from '../render/particles';
import { Stage } from '../render/stage';
import { TerrainRenderer } from '../render/terrain';
import { VeinRenderer } from '../render/veins';
import { FIELD, type World } from '../sim/world';
import type { Hud } from '../ui/hud';

/** Couleurs des effets. */
export const FX = {
  GOLD: new THREE.Color('#ffc53d'),
  WHITE: new THREE.Color('#ffffff'),
  CHIPS: new THREE.Color('#2d9cff'),
  MULT: new THREE.Color('#fe5f55'),
  PURPLE: new THREE.Color('#b85cff'),
  PINK: new THREE.Color('#ff2d8a'),
  CYAN: new THREE.Color('#2dd4ff'),
  TOOL: new THREE.Color('#ff9a5a'),
  TEAL: new THREE.Color('#2fe0b0'),
} as const;

/** État de la partie dont le rendu a besoin à chaque image. */
export interface FrameState {
  card: (uid: number) => BrickCard | undefined;
  /** Chaleur du Pot (0-1) et de la balle (0-1). */
  heat: number;
  ballHeat: number;
  /** Balle en vol pendant le jeu (escarbilles). */
  flying: boolean;
  armed: boolean;
  lock: { landX: number; angle: number } | null;
  selected: Set<number>;
  eclipse: number;
  fog: boolean;
  aimed: number;
  useful: Set<number>;
  dark: { x: number; y: number }[] | null;
  /** Filons cachés (Brouillard, Nuit noire). */
  hideVeins: boolean;
  twin: boolean;
  /** Rendu réduit derrière un écran plein. */
  throttled: boolean;
}

/**
 * La scène 3D : tous les rendus (briques, balles, raquettes, terrain, particules) et les effets de base.
 */
export class View {
  /** Hasard des effets visuels (séparé du hasard du run). */
  readonly fxRng = new Rng(Date.now());
  readonly stage: Stage;
  readonly bricks: BrickRenderer;
  readonly veins: VeinRenderer;
  readonly ball = new BallRenderer();
  readonly paddle: PaddleRenderer;
  /** Raquette jumelle au plafond (Raquette siamoise). */
  readonly twin: PaddleRenderer;
  readonly particles = new Particles();
  readonly rings = new Rings();
  readonly sparks = new Sparks();
  readonly frame3d = new Frame();
  readonly beams = new Beams();
  readonly comets = new Comets();
  readonly aim = new AimGuide();
  readonly terrain = new TerrainRenderer();
  /** Multiballe : un rendu par balle supplémentaire (par identifiant), recyclés. */
  private extraR = new Map<number, BallRenderer>();
  private ballPool: BallRenderer[] = [];
  private emberT = 0;
  private tmpPos = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement, private readonly world: World, private readonly hud: Hud) {
    this.stage = new Stage(canvas);
    this.bricks = new BrickRenderer(world.bricks);
    this.veins = new VeinRenderer(world.bricks);
    this.paddle = new PaddleRenderer(world.paddle);
    this.twin = new PaddleRenderer(world.twinPaddle, true);
    this.twin.group.visible = false;
    this.stage.scene.add(this.twin.group);
    this.stage.scene.add(this.frame3d.group, this.veins.mesh, this.bricks.mesh, this.paddle.group, this.paddle.fanMesh, this.ball.group, this.particles.mesh, this.sparks.lines, this.rings.group, this.aim.group, this.terrain.group, this.beams.group, this.comets.points);
  }

  /** Texte flottant à une position du monde. */
  popup(x: number, y: number, text: string, cls: string) {
    this.stage.toScreen(x, y, this.tmpPos);
    this.hud.popup(this.tmpPos.x, this.tmpPos.y, text, cls);
  }

  /** Nouveau mur posé : terrain et briques apparaissent. */
  presentWall() {
    this.terrain.setup(this.world.bumpers, this.world.portals);
    this.bricks.spawn();
  }

  applyBiome(b: BiomeDef) {
    this.stage.background.uniforms.uHue.value = b.hue;
    this.frame3d.setRail(b.rail);
  }

  /** Balle perdue : onde et secousse en bas du terrain. */
  ballLost(x: number) {
    this.stage.ripple3D(x, FIELD.bottom + 1, 0.9);
    this.stage.shake.add(0.65);
    this.stage.kick(0.8);
    this.particles.burst(x, FIELD.bottom + 0.5, FX.MULT, 40, 1.4, 0, 1);
  }

  /** Une image : met à jour tous les rendus et dessine la scène. */
  render(dt: number, s: FrameState) {
    const world = this.world;
    this.terrain.update(dt);
    this.bricks.update(dt, s.heat, { card: s.card, selected: s.selected, eclipse: s.eclipse, fog: s.fog, aimed: s.aimed, useful: s.useful, dark: s.dark });
    this.veins.update(dt, s.card, s.hideVeins);
    this.aim.update(dt);
    this.paddle.update(dt, s.armed, s.lock);
    this.twin.group.visible = s.twin;
    if (s.twin) this.twin.update(dt, false, null);
    this.ball.update(dt, world.ball, s.ballHeat, !world.ball.stuck, this.stage.camera);
    this.syncExtras(dt, s.ballHeat);
    // La lumière de la balle éclaire les briques au passage
    const bl = this.stage.ballLight;
    bl.position.set(world.ball.x, world.ball.y, 1.1);
    bl.color.copy(this.ball.color);
    bl.intensity = (world.ball.stuck ? 4 : 9) + s.ballHeat * 22;
    const glow = Math.max(s.heat, s.ballHeat * 0.5);
    this.frame3d.update(dt, glow);
    // Escarbilles : une balle brûlante sème des étincelles
    if (s.flying && s.ballHeat > 0.45) {
      this.emberT += dt * (s.ballHeat - 0.4) * 60;
      while (this.emberT > 1) {
        this.emberT -= 1;
        this.sparks.burst(world.ball.x, world.ball.y, this.ball.color, 1, 0.25, -world.ball.dx * 0.3, -world.ball.dy * 0.3);
      }
    }
    this.beams.update(dt);
    this.comets.update(dt);
    this.sparks.update(dt);
    this.particles.update(dt);
    this.rings.update(dt);
    this.stage.render(dt, glow, world.paddle.x, !s.throttled);
  }

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
