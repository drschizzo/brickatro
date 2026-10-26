import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { easeOutBack, Spring } from '../core/math';
import { EDITION, ENH, isColorless, type BrickCard } from '../rules/bricks';
import { FIELD, type Brick } from '../sim/world';
import { BRICK_COLORS } from './palette';

export interface BrickView {
  card: (uid: number) => BrickCard | undefined;
  selected: Set<number>;
  eclipse: number; // couleur éteinte, -1 sinon
  /** Brouillard : couleur et valeur cachées. */
  fog: boolean;
  /** Brique visée par le guide (id d'emplacement), -1 sinon. */
  aimed: number;
  /** uid des briques qui amélioreraient la Main. */
  useful: Set<number>;
  /** Nuit noire : seules les briques proches d'une balle se voient. */
  dark?: { x: number; y: number }[] | null;
}

const MAX_LIGHTS = 5;

/** Atlas des valeurs 1 à 10 : R = remplissage, G = contour. */
function makeDigits(): THREE.CanvasTexture {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S * 10;
  cv.height = S;
  const tex = new THREE.CanvasTexture(cv);
  const draw = () => {
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, cv.width, cv.height);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (let i = 0; i < 10; i++) {
      const txt = String(i + 1);
      const size = txt.length > 1 ? 74 : 96;
      g.font = `900 ${size}px "Orbitron", "Arial Black", sans-serif`;
      const cx = i * S + S / 2, cy = S / 2 + 4;
      g.save();
      if (txt.length > 1) { g.translate(cx, cy); g.scale(0.8, 1); g.translate(-cx, -cy); }
      g.strokeStyle = '#00ff00';
      g.lineWidth = 22;
      g.strokeText(txt, cx, cy);
      g.fillStyle = '#ff0000';
      g.fillText(txt, cx, cy);
      g.restore();
    }
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.load('900 96px "Orbitron"').then(draw).catch(() => {});
  return tex;
}

/**
 * Toutes les briques en un seul draw call. Enchantements et éditions sont dessinés
 * dans le shader (attribut d'instance aKind) : cadre doré, verre scintillant, holo irisé…
 */
export class BrickRenderer {
  readonly mesh: THREE.InstancedMesh;
  private springs: Spring[] = [];
  private spawnT: number[] = [];
  private flash: number[] = [];
  /** Gravité : hauteur restante de la chute (s'annule en tombant). */
  private fall: number[] = [];
  private dummy = new THREE.Object3D();
  private col = new THREE.Color();
  private time = 0;
  private kind: THREE.InstancedBufferAttribute;
  private uniforms = {
    uTime: { value: 0 }, uFog: { value: 0 }, uDigits: { value: makeDigits() },
    uDark: { value: 0 }, uLights: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
  };

  constructor(private bricks: Brick[]) {
    const geo = new RoundedBoxGeometry(1, 1, 1, 4, 0.14);
    this.kind = new THREE.InstancedBufferAttribute(new Float32Array(bricks.length * 4), 4);
    this.kind.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aKind', this.kind);
    // Matière laquée : vernis (clearcoat) qui accroche les reflets de l'environnement
    const mat = new THREE.MeshPhysicalMaterial({
      roughness: 0.38, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.9,
    });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 aKind;
          varying vec4 vKind; varying vec3 vLocal; varying vec3 vWorld;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vLocal = position; vKind = aKind;
          #ifdef USE_INSTANCING
            vWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          #else
            vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #endif`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform float uFog; uniform sampler2D uDigits;
          uniform float uDark; uniform vec3 uLights[${MAX_LIGHTS}];
          varying vec4 vKind; varying vec3 vLocal; varying vec3 vWorld;
          vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
          float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          int enh = int(vKind.x + 0.5);
          int ed = int(vKind.y + 0.5);
          float flags = vKind.z;
          float edge = max(abs(vLocal.x), abs(vLocal.y));
          float border = smoothstep(0.38, 0.45, edge);
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 base = diffuseColor.rgb;
          // Lueur intérieure : le cœur de la brique luit comme une gemme, les arêtes restent sombres
          // (discrète : un emissive trop fort aplatit l'éclairage et masque les reflets)
          vec3 emis = base * (0.04 + 0.14 * (1.0 - smoothstep(0.05, 0.5, edge)));
          if (enh == 1) { // Verre
            base = mix(base, vec3(1.0), 0.45);
            float glint = smoothstep(0.06, 0.0, abs(fract(vLocal.x * 1.2 + vLocal.y * 2.0 - uTime * 0.35) - 0.5));
            emis += vec3(0.7, 0.9, 1.2) * (0.25 + glint * 1.4);
          } else if (enh == 2) { // Or
            base = mix(base, vec3(1.0, 0.78, 0.2), border);
            emis += vec3(1.6, 1.1, 0.2) * border * (0.9 + 0.3 * sin(uTime * 3.0));
          } else if (enh == 3) { // Acier
            float s = 0.5 + 0.5 * sin(vLocal.x * 140.0);
            base = mix(base, vec3(0.75, 0.78, 0.85) * (0.75 + 0.25 * s), 0.6);
            emis *= 0.45;
          } else if (enh == 4) { // Bombe
            float d = length(vLocal.xy * vec2(1.0, 1.6));
            base = mix(vec3(0.06), base, 0.3);
            emis = mix(emis * 0.2, vec3(3.0, 0.35, 0.1) * (0.6 + 0.4 * sin(uTime * 9.0)), smoothstep(0.22, 0.08, d));
          } else if (enh == 5) { // Chance
            vec2 g = floor(vLocal.xy * vec2(16.0, 6.0));
            float h = hash(g);
            emis += vec3(0.4, 1.6, 0.6) * step(0.82, h) * (0.5 + 0.5 * sin(uTime * 6.0 + h * 40.0));
            base = mix(base, vec3(0.3, 0.9, 0.5), border);
          } else if (enh == 6) { // Pierre
            float n = hash(floor(vLocal.xy * vec2(22.0, 9.0)));
            base = vec3(0.42 + 0.14 * n);
            emis = vec3(0.04);
          } else if (enh == 7) { // Bonus
            base = mix(base, vec3(0.2, 0.6, 1.0), border);
            emis += vec3(0.3, 0.9, 2.2) * border;
          } else if (enh == 9) { // Bloc indestructible
            float stripe = step(0.5, fract((vLocal.x * 2.3 + vLocal.y) * 3.0));
            base = mix(vec3(0.16, 0.17, 0.22), vec3(0.24, 0.25, 0.3), stripe * border);
            vec2 rv = abs(vLocal.xy) - vec2(0.4, 0.3);
            float rivet = smoothstep(0.06, 0.03, length(max(rv, 0.0)));
            emis = vec3(0.02) + vec3(0.5, 0.55, 0.7) * rivet * 0.4;
          } else if (enh == 10) { // Interrupteur : cœur lumineux qui pulse
            float d = length(vLocal.xy * vec2(1.0, 2.3));
            base = vec3(0.12, 0.1, 0.1);
            emis = vec3(2.6, 1.1, 0.25) * (smoothstep(0.24, 0.12, d) * (0.7 + 0.3 * sin(uTime * 5.0)) + border * 0.6);
          } else if (enh == 11) { // Vanne fermée : barreaux
            float bar = step(0.55, fract(vLocal.x * 5.0));
            base = mix(vec3(0.08, 0.16, 0.16), vec3(0.2, 0.5, 0.45), bar);
            emis = vec3(0.2, 1.4, 1.1) * (bar * 0.35 + border * 0.8);
          } else if (enh == 12) { // Vanne ouverte : simple contour pointillé
            float dash = step(0.5, fract((vLocal.x + vLocal.y) * 6.0 - uTime));
            base = vec3(0.02);
            emis = vec3(0.15, 0.9, 0.75) * border * dash * 0.7;
          } else if (enh == 8) { // Mult
            base = mix(base, vec3(1.0, 0.3, 0.3), border);
            emis += vec3(2.2, 0.4, 0.3) * border;
          } else if (enh == 13) { // Mimic : reflets violets qui ondulent, elle n'est jamais la même
            float w = sin(vLocal.x * 18.0 + sin(vLocal.y * 9.0 + uTime * 3.0) * 2.0 + uTime * 4.0);
            base = mix(base, vec3(0.55, 0.25, 0.9), 0.35 + 0.15 * w);
            emis += vec3(1.1, 0.4, 2.2) * (border * 0.9 + smoothstep(0.7, 1.0, w) * 0.5);
          } else if (enh == 14) { // Reine : couronne dorée sur le bord haut
            float crown = smoothstep(0.32, 0.46, vLocal.y) * (0.6 + 0.4 * step(0.5, fract(vLocal.x * 4.0 + 0.25)));
            base = mix(base, vec3(1.0, 0.82, 0.3), crown);
            emis += vec3(2.0, 1.5, 0.4) * (crown * (0.8 + 0.3 * sin(uTime * 4.0)) + border * 0.3);
          } else if (enh == 15) { // Fuyarde : traits de vitesse qui défilent
            float lines = step(0.82, fract(vLocal.y * 5.0)) * step(0.4, fract(vLocal.x * 2.0 - uTime * 2.5));
            base = mix(base, vec3(0.3, 1.0, 0.6), border * 0.7);
            emis += vec3(0.4, 2.0, 1.0) * (lines * 0.9 + border * 0.5);
          } else if (enh == 16) { // Piñata : bandes multicolores
            vec3 band = hue(fract(floor(vLocal.y * 6.0 + 3.0) / 6.0 + uTime * 0.05));
            base = mix(base, band, 0.6);
            emis += band * (0.35 + border * 0.6);
          }
          if (ed == 1) { // Métal : reflet qui glisse avec le point de vue
            float band = smoothstep(0.12, 0.0, abs(fract(vLocal.x * 0.8 - vLocal.y * 0.4 + V.x * 2.0 + V.y * 1.5 + uTime * 0.15) - 0.5));
            base = mix(base, vec3(0.8, 0.85, 0.95), 0.25);
            emis += vec3(1.3, 1.4, 1.8) * band;
          } else if (ed == 2) { // Holo : arc-en-ciel strié
            float h = fract(vLocal.x * 1.3 + vLocal.y * 0.6 + V.x * 1.8 + V.y * 1.2 + uTime * 0.1);
            emis += hue(h) * (0.5 + 0.5 * sin(vLocal.x * 70.0)) * 0.9;
          } else if (ed == 3) { // Polychrome : teinte qui tourne
            float h = fract(V.x * 1.4 + V.y * 1.1 + uTime * 0.15 + vLocal.x * 0.5);
            base = mix(base, hue(h), 0.65);
            emis = hue(h) * 0.8;
          }
          if (mod(flags, 2.0) > 0.5) { // sélection (Runes)
            emis += vec3(2.0, 1.8, 1.0) * (0.6 + 0.4 * sin(uTime * 10.0)) * smoothstep(0.34, 0.47, edge);
            base = mix(base, vec3(1.0), 0.2);
          }
          if (mod(floor(flags / 2.0), 2.0) > 0.5) { // éclipse
            base = mix(vec3(0.1), base, 0.15);
            emis *= 0.05;
          }
          if (mod(floor(flags / 4.0), 2.0) > 0.5) { // acier fissuré
            float c = smoothstep(0.08, 0.0, abs(sin(vLocal.x * 23.0 + sin(vLocal.y * 31.0) * 2.0)));
            base *= 1.0 - c * 0.75;
          }
          if (uFog > 0.5) { // brouillard : ni couleur ni valeur
            float n = hash(floor(vLocal.xy * 8.0) + floor(uTime * 4.0));
            base = vec3(0.22, 0.24, 0.3) + n * 0.04;
            emis = vec3(0.03, 0.04, 0.08);
          }
          // Valeur sur la face avant
          if (vKind.w > 0.5 && vLocal.z > 0.45) {
            vec2 uv = vLocal.xy + 0.5;
            vec2 duv = vec2((uv.x - 0.5) / 0.58 + 0.5, (uv.y - 0.5) * 0.86 + 0.5);
            if (duv.x > 0.0 && duv.x < 1.0 && duv.y > 0.0 && duv.y < 1.0) {
              vec4 d = texture2D(uDigits, vec2((vKind.w - 1.0 + duv.x) / 10.0, duv.y));
              base = mix(base, vec3(0.01, 0.01, 0.03), d.g);
              emis *= 1.0 - d.g;
              base = mix(base, vec3(1.0), d.r);
              emis = mix(emis, vec3(0.32), d.r);
            }
          }
          if (mod(floor(flags / 32.0), 2.0) > 0.5) { // emplacement cible ★
            float ang = atan(vLocal.y * 2.3, vLocal.x);
            float dash = step(0.5, fract(ang * 1.9 + uTime * 1.5));
            emis += vec3(2.6, 2.0, 0.6) * dash * smoothstep(0.4, 0.48, edge);
          }
          if (mod(floor(flags / 16.0), 2.0) > 0.5) { // utile pour la Main
            float pulse = 0.55 + 0.45 * sin(uTime * 5.0);
            emis += vec3(0.6, 1.6, 0.9) * pulse * smoothstep(0.36, 0.48, edge);
          }
          if (mod(floor(flags / 8.0), 2.0) > 0.5) { // visée
            float useful = mod(floor(flags / 16.0), 2.0);
            vec3 c = mix(vec3(2.4, 1.8, 0.4), vec3(0.8, 3.0, 1.2), useful);
            emis += c * (0.75 + 0.25 * sin(uTime * 16.0)) * smoothstep(0.32, 0.47, edge);
          }
          if (uDark > 0.5) { // Nuit noire : halos autour des balles
            float vis = 0.0;
            for (int i = 0; i < ${MAX_LIGHTS}; i++) {
              vis = max(vis, uLights[i].z * smoothstep(4.6, 1.8, distance(vWorld.xy, uLights[i].xy)));
            }
            base *= mix(0.03, 1.0, vis);
            emis *= vis;
          }
          diffuseColor.rgb = base;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += emis;`);
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, bricks.length);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; // bounding sphere obsolète pendant les animations de chute
    this.mesh.castShadow = true;
    for (let i = 0; i < bricks.length; i++) {
      this.springs.push(new Spring(420, 11));
      this.spawnT.push(99);
      this.flash.push(0);
      this.fall.push(0);
      this.mesh.setColorAt(i, BRICK_COLORS[0]);
    }
  }

  /** Animation d'arrivée : chute échelonnée avec rebond. */
  spawn(ids?: number[]) {
    for (const b of this.bricks) {
      if (ids && !ids.includes(b.id)) continue;
      this.spawnT[b.id] = -((ids ? 0 : b.row * 0.06) + Math.abs(b.col - 4.5) * 0.035);
    }
  }

  /** Gravité : les briques déplacées tombent depuis leur ancienne case. */
  drop(moves: { from: number; to: number }[]) {
    for (const m of moves) {
      this.fall[m.to] = Math.max(0, this.bricks[m.from].baseY - this.bricks[m.to].baseY);
      this.fall[m.from] = 0;
    }
  }

  /** Les voisines tremblent quand une brique casse. */
  shockwave(x: number, y: number, strength: number) {
    for (const b of this.bricks) {
      if (!b.alive) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < 4) {
        this.springs[b.id].kick(strength * (1 - d / 4));
        this.flash[b.id] = Math.max(this.flash[b.id], 0.6 * (1 - d / 4));
      }
    }
  }

  pulse(id: number, strength = 6) {
    this.springs[id].kick(strength);
    this.flash[id] = 1;
  }

  /** Brique sous un point du plan de jeu (sélection des Runes). */
  pick(x: number, y: number): number {
    for (const b of this.bricks) {
      if (b.alive && Math.abs(x - b.x) < b.w / 2 + 0.05 && Math.abs(y - b.y) < b.h / 2 + 0.12) return b.id;
    }
    return -1;
  }

  update(dt: number, heat: number, view: BrickView) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uFog.value = view.fog ? 1 : 0;
    this.uniforms.uDark.value = view.dark ? 1 : 0;
    if (view.dark) this.uniforms.uLights.value.forEach((l, i) => {
      const p = view.dark![i];
      l.set(p?.x ?? 0, p?.y ?? 0, p ? 1 : 0);
    });
    const k = this.kind.array as Float32Array;
    for (const b of this.bricks) {
      const i = b.id;
      const s = this.springs[i];
      s.update(dt);
      const before = this.spawnT[i];
      this.spawnT[i] += dt;
      // Matérialisation : flash et petit rebond quand la brique "atterrit"
      if (before < 0.42 && this.spawnT[i] >= 0.42 && b.alive) {
        this.flash[i] = 0.9;
        s.kick(-4);
      }
      this.flash[i] = Math.max(0, this.flash[i] - dt * 3);
      const card = b.alive && b.kind === 'brick' ? view.card(b.uid) : undefined;
      if (this.fall[i] > 0) this.fall[i] = Math.max(0, this.fall[i] - dt * (6 + this.fall[i] * 10));
      const block = b.kind === 'block' && (b.alive || b.gate);
      if (block) {
        const t = Math.min(1, Math.max(0, this.spawnT[i] / 0.45));
        this.dummy.position.set(b.x, b.y + (1 - easeOutBack(t)) * 6, 0);
        this.dummy.scale.set(b.w, b.h, b.gate && !b.alive ? 0.08 : 0.7);
        this.dummy.rotation.set(s.value * 0.2, 0, 0);
        if (t <= 0) this.dummy.scale.setScalar(0);
        this.mesh.setColorAt(i, this.col.setRGB(0.3, 0.32, 0.4).lerp(WHITE, this.flash[i]));
        k[i * 4] = b.isSwitch ? 10 : b.gate ? (b.alive ? 11 : 12) : 9; k[i * 4 + 1] = 0; k[i * 4 + 2] = 0; k[i * 4 + 3] = 0;
      } else if (!b.alive || !card) {
        this.dummy.scale.setScalar(0);
      } else {
        const t = Math.min(1, Math.max(0, this.spawnT[i] / 0.45));
        const drop = (1 - easeOutBack(t)) * 6;
        const wave = Math.sin(this.time * 2.2 + b.x * 0.6 + b.y * 0.9) * (0.04 + heat * 0.08);
        // Tapis roulant : au bord, la brique rentre dans le mur au lieu de déborder du cadre
        let x = b.x, w = b.w;
        if (b.belt) {
          const l = Math.max(b.x - b.w / 2, FIELD.left), r = Math.min(b.x + b.w / 2, FIELD.right);
          x = (l + r) / 2;
          w = Math.max(0, r - l);
        }
        this.dummy.position.set(x, b.y + drop + wave + this.fall[i], 0);
        const sq = s.value;
        this.dummy.scale.set(w * (1 + sq * 0.6), b.h * (1 - sq * 0.4), 0.55 * (1 + sq));
        this.dummy.rotation.set(sq * 0.4, 0, Math.sin(this.time * 1.3 + b.x) * 0.02 + sq * 0.3);
        if (t <= 0) this.dummy.scale.setScalar(0);
        // Joker : sans couleur ni valeur affichées, il prendra celles qui arrangent la Main
        this.col.copy(card.enh === 'joker' ? JOKER : BRICK_COLORS[card.color]).lerp(WHITE, this.flash[i]);
        this.mesh.setColorAt(i, this.col);
        const eclipsed = view.eclipse >= 0 && card.color === view.eclipse && !isColorless(card);
        k[i * 4] = ENH[card.enh].code;
        k[i * 4 + 1] = EDITION[card.edition].code;
        const cracked = (card.enh === 'acier' && b.hp < 2) || (card.enh === 'pinata' && b.hp < 4);
        k[i * 4 + 2] = (view.selected.has(i) ? 1 : 0) + (eclipsed ? 2 : 0) + (cracked ? 4 : 0)
          + (view.aimed === i ? 8 : 0) + (!view.fog && view.useful.has(card.uid) ? 16 : 0) + (b.star ? 32 : 0);
        k[i * 4 + 3] = view.fog || isColorless(card) || card.enh === 'joker' ? 0 : card.value;
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.kind.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
const WHITE = new THREE.Color(1, 1, 1);
const JOKER = new THREE.Color(0.95, 0.9, 1);
