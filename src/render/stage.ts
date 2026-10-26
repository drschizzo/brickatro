import * as THREE from 'three';
import {
  BloomEffect, ChromaticAberrationEffect, EffectComposer, EffectPass, FXAAEffect, RenderPass, SMAAEffect, SMAAPreset,
  ToneMappingEffect, ToneMappingMode,
} from 'postprocessing';
import { Shake } from '../fx/shake';
import { FIELD } from '../sim/world';
import { Background } from './background';
import { GradeEffect, RippleEffect } from './post';
import { QUALITY } from './quality';

const FOV = 34;
const TILT = (16 * Math.PI) / 180; // caméra légèrement inclinée : 3D stylisée
const FIELD_W = FIELD.right - FIELD.left + 1.2;
const FIELD_H = FIELD.top - FIELD.bottom + 1.8;

/**
 * Scène, caméra, éclairage et post-traitement.
 * Éclairage physique : environnement (reflets), lumière principale avec ombres douces,
 * lumière qui suit la balle et éclairs d'impact éphémères.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
  readonly background = new Background();
  readonly shake = new Shake();
  /** Lumière qui accompagne la balle (sa couleur suit la chaleur du combo). */
  readonly ballLight = new THREE.PointLight('#ffffff', 0, 9, 1.6);
  private flashLights: { light: THREE.PointLight; life: number; max: number; peak: number }[] = [];
  private nextFlash = 0;
  private composer: EffectComposer;
  private ripplePass: EffectPass;
  private chroma: ChromaticAberrationEffect;
  private bloom: BloomEffect;
  private ripple = new RippleEffect();
  private grade = new GradeEffect();
  private dist = 50;
  private center = new THREE.Vector2(); // décalage écran du centre du terrain (monde)
  /** Unités monde par pixel CSS (sert au drag tactile). */
  worldPerPixel = 0.05;
  private pulse = 0;
  private flash = 0;
  /** Coup de zoom (0..1) qui retombe : met en valeur les grands moments. */
  private zoom = 0;
  private tmp = new THREE.Vector3();
  /** Gouverneur de résolution : ratio de pixels courant et mesure des images lentes. */
  private dpr: number;
  /** Plafond posé par le gouverneur (il ne remonte jamais). */
  private govCap = Infinity;
  private perfT = 0;
  private perfFrames = 0;
  private perfSlow = 0;
  private perfGrace = 2;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: false });
    const Q = QUALITY;
    this.dpr = this.targetDpr();
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = Q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;

    // Environnement « studio néon » : bandes colorées qui se reflètent dans les vernis
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(neonStudio(), 0.02).texture;
    this.scene.environmentIntensity = 1;
    pmrem.dispose();

    this.scene.add(this.background.mesh);
    this.scene.add(new THREE.HemisphereLight('#9fb4ff', '#1a0f24', 0.35));
    // Lumière principale : haut-gauche, légèrement devant → ombres portées sur le panneau du fond
    const key = new THREE.DirectionalLight('#fff1e0', 2.4);
    key.position.set(-8, 13, 14);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
    const sc = key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -11; sc.right = 11; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 50;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 3;
    this.scene.add(key, key.target);
    // Contre-jour froid : détache les reliefs
    const rim = new THREE.DirectionalLight('#5fa8ff', 1.1);
    rim.position.set(8, -6, 6);
    this.scene.add(rim);

    this.ballLight.position.set(0, 0, 1.2);
    this.scene.add(this.ballLight);
    for (let i = 0; i < Q.flashLights; i++) {
      const light = new THREE.PointLight('#ffffff', 0, 8, 1.6);
      light.position.z = 1.4;
      this.scene.add(light);
      this.flashLights.push({ light, life: 0, max: 1, peak: 0 });
    }

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Passe optionnelle : activée seulement pendant une onde de choc
    this.ripplePass = new EffectPass(this.camera, this.ripple);
    this.ripplePass.enabled = false;
    this.composer.addPass(this.ripplePass);
    this.bloom = new BloomEffect({ intensity: 1.3, luminanceThreshold: 0.75, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.8, levels: Q.bloomLevels });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: true, modulationOffset: 0.3 });
    // Aberration chromatique fusionnée dans la passe finale : une passe plein écran de moins
    this.composer.addPass(new EffectPass(this.camera, this.chroma, this.bloom, tone, this.grade));
    if (Q.antialias === 'smaa') this.composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    else if (Q.antialias === 'fxaa') this.composer.addPass(new EffectPass(this.camera, new FXAAEffect()));
  }

  /** Cadre le terrain dans le rectangle libre (hors HUD) de l'écran. */
  resize(field: DOMRect) {
    const W = window.innerWidth, H = window.innerHeight;
    // Le budget de pixels dépend de la taille de la fenêtre : on le réévalue
    this.dpr = this.targetDpr();
    this.applySize();
    this.camera.aspect = W / H;
    const wpp = Math.max(FIELD_W / Math.max(1, field.width), FIELD_H / Math.max(1, field.height));
    this.worldPerPixel = wpp;
    this.dist = (wpp * H) / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    this.center.set(-(field.left + field.width / 2 - W / 2) * wpp, (field.top + field.height / 2 - H / 2) * wpp);
    this.camera.updateProjectionMatrix();
    this.background.uniforms.uRes.value.set(W, H);
  }

  /** Pulsation d'aberration chromatique / bloom sur les gros coups. */
  kick(amount: number) {
    this.pulse = Math.min(1, this.pulse + amount);
  }

  /** Flash blanc bref (encaissements énormes) + éclat de la nébuleuse. */
  whiteFlash(amount: number) {
    this.flash = Math.min(1, this.flash + amount);
    this.background.uniforms.uFlash.value = Math.min(1, this.background.uniforms.uFlash.value + amount);
  }

  /** Coup de zoom de caméra. */
  punch(amount: number) {
    this.zoom = Math.min(0.12, this.zoom + amount);
  }

  /** Onde de choc qui réfracte l'image, depuis un point du terrain. */
  ripple3D(x: number, y: number, strength: number) {
    this.tmp.set(x, y, 0).project(this.camera);
    this.ripple.spawn(this.tmp.x * 0.5 + 0.5, this.tmp.y * 0.5 + 0.5, strength);
  }

  /** Éclair lumineux éphémère qui éclaire les briques voisines. */
  lightFlash(x: number, y: number, color: THREE.Color, intensity = 18, life = 0.25) {
    const f = this.flashLights[this.nextFlash];
    this.nextFlash = (this.nextFlash + 1) % this.flashLights.length;
    f.light.position.set(x, y, 1.4);
    f.light.color.copy(color);
    f.life = f.max = life;
    f.peak = intensity;
  }

  /**
   * Ratio de pixels : plafond du palier, gouverneur, puis budget de pixels. Sur un écran Retina
   * large (ou 4K/5K), un ratio de 2 donnerait 10 à 15 millions de pixels par image — tout le
   * post-traitement (HDR, bloom, anticrénelage) se paierait sur cette surface.
   */
  private targetDpr() {
    const budget = Math.sqrt(QUALITY.pixelBudget / Math.max(1, window.innerWidth * window.innerHeight));
    return Math.min(window.devicePixelRatio, QUALITY.dprCap, this.govCap, Math.max(QUALITY.dprMin, budget));
  }

  private applySize() {
    const W = window.innerWidth, H = window.innerHeight;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(W, H, false);
    this.composer.setSize(W, H);
    this.background.setSize(W * this.dpr, H * this.dpr);
  }

  /** governed : false quand l'appelant bride volontairement la cadence (menus) ; le gouverneur ne mesure pas. */
  render(dt: number, heat: number, followX: number, governed = true) {
    this.shake.update(dt);
    this.pulse = Math.max(0, this.pulse - dt * 2.5);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.zoom = Math.max(0, this.zoom - dt * 0.35 - this.zoom * dt * 4);
    this.ripplePass.enabled = this.ripple.tick(dt);
    if (governed) this.govern(dt);
    for (const f of this.flashLights) {
      f.life = Math.max(0, f.life - dt);
      const t = f.life / f.max;
      f.light.intensity = f.peak * t * t;
    }

    const cx = this.center.x + followX * 0.04 + this.shake.x;
    const cy = this.center.y + this.shake.y + (FIELD.top + FIELD.bottom) / 2 - 0.3;
    const d = this.dist * (1 - this.zoom);
    this.camera.position.set(cx + followX * 0.08, cy - Math.sin(TILT) * d, Math.cos(TILT) * d);
    this.camera.up.set(Math.sin(this.shake.rot), Math.cos(this.shake.rot), 0);
    this.camera.lookAt(cx, cy, 0);
    this.background.update(dt, heat, followX * 0.1 + this.shake.x, this.shake.y);

    const t = this.shake.trauma * this.shake.trauma + this.pulse * 0.7;
    this.chroma.offset.set(t * 0.006, t * 0.004);
    this.bloom.intensity = 1.2 + heat * 0.6 + this.pulse * 1.2;
    this.grade.heat = heat;
    this.grade.flash = this.flash;
    this.background.renderNebula(this.renderer);
    this.composer.render(dt);
  }

  /**
   * Résolution dynamique : si la moyenne passe sous ~48 i/s, le ratio de pixels baisse par paliers
   * (jamais remonté, pour éviter le pompage).
   */
  private govern(dt: number) {
    if (document.hidden || dt >= 0.05) return; // onglet en arrière-plan ou à-coup isolé
    this.perfT += dt;
    this.perfFrames++;
    if (this.perfT < 1.5) return;
    const avg = this.perfT / this.perfFrames;
    this.perfT = 0;
    this.perfFrames = 0;
    if (this.perfGrace > 0) { this.perfGrace--; return; } // compilation des shaders au démarrage
    this.perfSlow = avg > 1 / 48 ? this.perfSlow + 1 : 0;
    if (this.perfSlow < 2) return;
    this.perfSlow = 0;
    if (this.dpr > QUALITY.dprMin + 0.01) {
      this.govCap = Math.max(QUALITY.dprMin, this.dpr - 0.2);
      this.dpr = this.targetDpr();
      this.applySize();
    }
  }

  /** Monde → pixels écran (pour les popups DOM). */
  toScreen(x: number, y: number, out: { x: number; y: number }) {
    const v = this.tmp.set(x, y, 0).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    return out;
  }

  /** Pixels écran → point du plan de jeu. */
  screenToWorld(px: number, py: number): { x: number; y: number } {
    const ndc = new THREE.Vector2((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit);
    return { x: hit.x, y: hit.y };
  }

  /** Pixels écran → x monde sur le plan du jeu (souris). */
  screenToWorldX(px: number, py: number): number {
    return this.screenToWorld(px, py).x;
  }
}

/**
 * Petite scène d'éclairage pour les reflets : un fond sombre, une grande boîte à lumière
 * (même direction que la lumière principale) et des bandes néon cyan / magenta / ambre.
 * Les briques vernies y prennent des reflets francs qui glissent avec la perspective.
 */
function neonStudio(): THREE.Scene {
  const env = new THREE.Scene();
  env.background = new THREE.Color('#05060c');
  const strip = (w: number, h: number, color: string, power: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  strip(9, 5, '#fff3e4', 4, -7, 9, 9); // boîte à lumière principale
  strip(30, 1.1, '#ffffff', 3, 0, 3.2, 12); // bandes horizontales devant (balayent les faces avant)
  strip(30, 0.5, '#bfe4ff', 2.2, 0, -1, 12);
  strip(30, 0.5, '#ffe2c4', 2, 0, 7, 12);
  strip(1.4, 16, '#38d4ff', 3, 11, 0, 3); // néon cyan à droite
  strip(1.4, 16, '#ff3da8', 2.6, -11, 0, 3); // néon magenta à gauche
  strip(24, 2, '#ff9a3d', 1.4, 0, -11, 2); // reflet chaud du bas
  return env;
}
