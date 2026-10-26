import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Spring } from '../core/math';
import { BALL_R, FIELD, MAX_BOUNCE_ANGLE, type Ball, type Paddle } from '../sim/world';
import { heatColor } from './palette';

const TRAIL = 40;

/**
 * Balle : cœur blanc chaud avec liseré coloré (shader fresnel), halo, et traînée en ruban
 * continu dont la largeur et l'opacité décroissent (au lieu de sphères empilées).
 */
export class BallRenderer {
  readonly group = new THREE.Group();
  private core: THREE.Mesh;
  private halo: THREE.Mesh;
  private ribbon: THREE.Mesh;
  private ribbonPos: Float32Array;
  private ribbonAlpha: Float32Array;
  private history: THREE.Vector3[] = [];
  private squash = new Spring(500, 16);
  readonly color = new THREE.Color(1, 1, 1);
  private coreU = { uColor: { value: new THREE.Color() }, uHeat: { value: 0 } };
  private trailU = { uColor: { value: new THREE.Color() } };

  constructor() {
    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 32, 20),
      new THREE.ShaderMaterial({
        uniforms: this.coreU,
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uHeat;
          varying vec3 vN; varying vec3 vV;
          void main() {
            float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.2);
            vec3 hot = vec3(1.0, 0.98, 0.94) * (2.6 + uHeat * 2.0);
            gl_FragColor = vec4(mix(hot, uColor * (3.0 + uHeat * 3.0), f), 1.0);
          }`,
      }),
    );
    this.halo = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: this.coreU,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uHeat; varying vec2 vUv;
          void main() {
            float d = length(vUv - 0.5) * 2.0;
            float a = exp(-d * d * 5.0) * (0.35 + uHeat * 0.6);
            gl_FragColor = vec4(uColor * a * 1.6, 1.0);
          }`,
      }),
    );
    this.halo.scale.setScalar(2.4);

    // Ruban de traînée : 2 sommets par point d'historique
    const geo = new THREE.BufferGeometry();
    this.ribbonPos = new Float32Array(TRAIL * 2 * 3);
    this.ribbonAlpha = new Float32Array(TRAIL * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.ribbonPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.ribbonAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    this.ribbon = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.trailU,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA * vA * 1.8, 1.0); }',
    }));
    this.ribbon.frustumCulled = false;
    for (let i = 0; i < TRAIL; i++) this.history.push(new THREE.Vector3());
    this.group.add(this.ribbon, this.halo, this.core);
  }

  impact(strength = 1) {
    this.squash.kick(strength * 9);
  }

  /** Repart d'une position (nouvelle balle, relève) : la traînée ne doit pas traverser le terrain. */
  reset(x: number, y: number) {
    for (const p of this.history) p.set(x, y, 0);
  }

  update(dt: number, ball: Ball, heat: number, flying: boolean, camera: THREE.Camera) {
    this.squash.update(dt);
    heatColor(heat, this.color);
    this.coreU.uColor.value.copy(this.color);
    this.coreU.uHeat.value = heat;
    this.trailU.uColor.value.copy(this.color);

    this.core.position.set(ball.x, ball.y, 0);
    this.halo.position.set(ball.x, ball.y, 0.05);
    this.halo.quaternion.copy(camera.quaternion);
    const ang = Math.atan2(ball.dy, ball.dx);
    const stretch = flying ? 1 + Math.min(0.35, ball.speed * 0.008) : 1;
    const sq = this.squash.value * 0.08;
    this.core.rotation.set(0, 0, ang);
    this.core.scale.set(stretch - sq, 1 / stretch + sq, 1);
    this.halo.scale.setScalar(2.2 + Math.sin(performance.now() * 0.012) * 0.15 + heat * 1.2);

    // Historique → ruban perpendiculaire à la direction locale
    const head = this.history.pop()!;
    head.set(ball.x, ball.y, 0);
    this.history.unshift(head);
    const width = (0.26 + heat * 0.22) * (flying ? 1 : 0);
    for (let i = 0; i < TRAIL; i++) {
      const p = this.history[i];
      const q = this.history[Math.min(TRAIL - 1, i + 1)];
      let tx = p.x - q.x, ty = p.y - q.y;
      const l = Math.hypot(tx, ty);
      if (l < 1e-4) { tx = 1; ty = 0; } else { tx /= l; ty /= l; }
      const k = 1 - i / (TRAIL - 1);
      const w = width * k;
      this.ribbonPos.set([p.x - ty * w, p.y + tx * w, -0.02, p.x + ty * w, p.y - tx * w, -0.02], i * 6);
      this.ribbonAlpha[i * 2] = this.ribbonAlpha[i * 2 + 1] = flying ? k : 0;
    }
    this.ribbon.geometry.attributes.position.needsUpdate = true;
    this.ribbon.geometry.attributes.aAlpha.needsUpdate = true;
  }
}

/**
 * Raquette : châssis métal sombre laqué, bande néon (bleue, dorée quand on attrape),
 * et éventail holographique des angles possibles pendant la visée verrouillée.
 */
export class PaddleRenderer {
  readonly group = new THREE.Group();
  private body: THREE.Mesh;
  private strip: THREE.Mesh;
  private glow: THREE.Mesh;
  private fan: THREE.Mesh;
  private squash = new Spring(380, 12);
  private stripMat: THREE.MeshBasicMaterial;
  private armedT = 0;
  private lockT = 0;
  private fanU = { uOpacity: { value: 0 }, uAngle: { value: 0 }, uMax: { value: MAX_BOUNCE_ANGLE } };
  private glowU = { uOpacity: { value: 0 }, uColor: { value: new THREE.Color('#ffc53d').multiplyScalar(1.6) } };

  /** flip : raquette jumelle accrochée au plafond (tête en bas). */
  constructor(private paddle: Paddle, private flip = false) {
    this.body = new THREE.Mesh(
      new RoundedBoxGeometry(1, 1, 1, 4, 0.22),
      new THREE.MeshPhysicalMaterial({ color: '#56618a', metalness: 0.7, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.2 }),
    );
    this.body.castShadow = true;
    this.stripMat = new THREE.MeshBasicMaterial({ color: '#6a9cff', toneMapped: false });
    this.strip = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.stripMat);
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: this.glowU,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform float uOpacity; uniform vec3 uColor; varying vec2 vUv;
          void main(){ vec2 p = (vUv - 0.5) * 2.0; float d = length(p * vec2(1.0, 1.6));
            float a = smoothstep(1.0, 0.0, d); a *= a; gl_FragColor = vec4(uColor * a * uOpacity, 1.0); }`,
      }),
    );
    // Éventail : secteur au-dessus du point d'impact, graduations + rayon de l'angle visé
    this.fan = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: this.fanU,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          uniform float uOpacity, uAngle, uMax; varying vec2 vUv;
          void main() {
            vec2 p = vec2(vUv.x - 0.5, vUv.y) * 2.0;
            float r = length(p);
            float a = atan(p.x, p.y);
            if (abs(a) > uMax || r > 1.0 || r < 0.15) discard;
            float ring = smoothstep(0.025, 0.0, abs(r - 0.97)) + smoothstep(0.015, 0.0, abs(r - 0.6)) * 0.4;
            float ticks = smoothstep(0.012, 0.0, abs(fract(a / 0.1745 + 0.5) - 0.5) * 0.1745 * r) * step(0.86, r);
            float beam = exp(-pow((a - uAngle) * r * 20.0, 2.0)) * smoothstep(0.15, 0.4, r);
            float fill = 0.05 * smoothstep(1.0, 0.2, r);
            vec3 col = vec3(0.45, 0.75, 1.0) * (ring * 0.6 + ticks * 0.8 + fill) + vec3(1.0, 0.85, 0.4) * beam * 1.5;
            gl_FragColor = vec4(col * uOpacity, 1.0);
          }`,
      }),
    );
    this.fan.visible = false;
    this.group.add(this.glow, this.body, this.strip);
  }

  /** L'éventail vit dans le repère du monde (il reste centré sur le point d'impact). */
  get fanMesh() {
    return this.fan;
  }

  hit(strength = 1) {
    this.squash.kick(strength * 10);
  }

  update(dt: number, armed: boolean, lock: { landX: number; angle: number } | null) {
    const p = this.paddle;
    this.squash.update(dt);
    this.armedT += ((armed ? 1 : 0) - this.armedT) * Math.min(1, dt * 18);
    this.lockT += ((lock ? 1 : 0) - this.lockT) * Math.min(1, dt * 14);
    const sq = this.squash.value * 0.06;
    this.group.position.set(p.x, p.y + (this.flip ? sq : -sq) * 0.6, 0);
    this.group.rotation.z = (this.flip ? Math.PI : 0) - p.vx * 0.003;
    this.body.scale.set(p.w * (1 + sq), p.h * (1 - sq * 1.5), 0.8);
    this.strip.scale.set(p.w * 0.9 * (1 + sq), 0.12, 0.06);
    this.strip.position.set(0, p.h * 0.18, 0.42);
    const pulse = 0.85 + Math.sin(performance.now() * 0.006) * 0.15;
    this.stripMat.color.set('#5f8dff').lerp(GOLD, this.armedT).multiplyScalar((1.6 + this.armedT * 1.5) * pulse);
    this.glow.scale.set(p.w * 1.9, 2.4, 1);
    this.glow.position.set(0, 0.5, -0.2);
    this.glowU.uOpacity.value = this.armedT * 0.9;
    this.fan.visible = this.lockT > 0.01;
    if (lock) {
      const size = 6.5;
      this.fan.scale.set(size * 2, size, 1);
      this.fan.position.set(lock.landX, p.y + p.h / 2 + BALL_R + size / 2, -0.3);
      this.fanU.uAngle.value = lock.angle;
    }
    this.fanU.uOpacity.value = this.lockT * 0.8;
  }
}
const GOLD = new THREE.Color('#ffc53d');

/**
 * Cadre du terrain : panneau de verre sombre qui reçoit les ombres (avec une grille très discrète),
 * et rails néon parcourus d'impulsions lumineuses à chaque rebond.
 */
export class Frame {
  readonly group = new THREE.Group();
  private u = {
    uTime: { value: 0 },
    uPulse: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 9, 0)) },
    uHeat: { value: 0 },
    uRail: { value: new THREE.Color('#4d73ff') },
  };
  private nextPulse = 0;

  constructor() {
    const H = FIELD.top - FIELD.bottom;
    const W = FIELD.right - FIELD.left;
    // Panneau du fond : dalles bleu nuit semi-brillantes. Assez claires pour que les ombres portées
    // et les flaques de lumière (balle, impacts) se lisent ; la brillance varie doucement sur le panneau.
    const panelMat = new THREE.MeshStandardMaterial({ color: '#121a3a', roughness: 0.32, metalness: 0.25, envMapIntensity: 0.35 });
    panelMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
          varying vec3 vWP;
          float tileHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
          float smoothNoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(tileHash(i), tileHash(i + vec2(1, 0)), u.x), mix(tileHash(i + vec2(0, 1)), tileHash(i + vec2(1, 1)), u.x), u.y);
          }`)
        // Variation continue (pas une valeur par dalle) : avec une rugosité qui saute d'une dalle à l'autre,
        // le reflet des lumières proches (balle, impacts) se découpait en carrés que le bloom accentuait.
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor *= 0.8 + 0.4 * smoothNoise(vWP.xy * 0.3);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          vec2 g = abs(fract(vWP.xy) - 0.5);
          float line = smoothstep(0.03, 0.0, 0.5 - max(g.x, g.y));
          float fade = smoothstep(${FIELD.bottom.toFixed(1)}, ${(FIELD.bottom + 10).toFixed(1)}, vWP.y);
          diffuseColor.rgb *= 1.0 - line * 0.55;
          totalEmissiveRadiance += vec3(0.1, 0.2, 0.45) * line * 0.18 * fade;`);
    };
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(W, H), panelMat);
    panel.position.set(0, (FIELD.top + FIELD.bottom) / 2, -1);
    panel.receiveShadow = true;

    // Rails néon : flux d'énergie continu + impulsions qui se propagent depuis les points d'impact
    const railMat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: 'varying vec3 vWP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */ `
        uniform float uTime, uHeat; uniform vec4 uPulse[4]; uniform vec3 uRail; varying vec3 vWP;
        void main() {
          float s = vWP.y + abs(vWP.x);
          float flow = 0.5 + 0.5 * sin(s * 1.4 - uTime * (2.0 + uHeat * 4.0));
          vec3 base = mix(uRail, vec3(1.0, 0.5, 0.3), uHeat) * (0.55 + flow * 0.35);
          float glow = 0.0;
          for (int i = 0; i < 4; i++) {
            vec4 p = uPulse[i];
            if (p.z > 1.0) continue;
            float d = distance(vWP.xy, p.xy);
            float front = exp(-pow((d - p.z * 14.0) * 1.2, 2.0));
            glow += (front + exp(-d * 2.0) * (1.0 - p.z)) * p.w * (1.0 - p.z);
          }
          gl_FragColor = vec4(base + vec3(1.0, 0.95, 0.85) * glow * 3.0, 1.0);
        }`,
    });
    const t = 0.1;
    const left = new THREE.Mesh(new THREE.CylinderGeometry(t, t, H, 8), railMat);
    left.position.set(FIELD.left - t, (FIELD.top + FIELD.bottom) / 2, 0);
    const right = left.clone();
    right.position.x = FIELD.right + t;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(t, t, W + t * 4, 8), railMat);
    top.rotation.z = Math.PI / 2;
    top.position.set(0, FIELD.top + t, 0);
    const danger = new THREE.Mesh(
      new THREE.PlaneGeometry(W, 0.05),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3d5a').multiplyScalar(1.4), transparent: true, opacity: 0.5, toneMapped: false }),
    );
    danger.position.set(0, FIELD.bottom + 0.6, 0);
    this.group.add(panel, left, right, top, danger);
  }

  /** Couleur des rails (biome). */
  setRail(color: string) {
    this.u.uRail.value.set(color).convertSRGBToLinear().multiplyScalar(1.3);
  }

  /** Impulsion lumineuse depuis un point du cadre. */
  pulse(x: number, y: number, strength = 1) {
    this.u.uPulse.value[this.nextPulse].set(x, y, 0, strength);
    this.nextPulse = (this.nextPulse + 1) % 4;
  }

  update(dt: number, heat: number) {
    this.u.uTime.value += dt;
    this.u.uHeat.value += (heat - this.u.uHeat.value) * Math.min(1, dt * 2);
    for (const p of this.u.uPulse.value) p.z += dt * 1.2;
  }
}
