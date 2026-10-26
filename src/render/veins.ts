import * as THREE from 'three';
import type { BrickCard } from '../rules/bricks';
import type { Brick } from '../sim/world';
import { BRICK_COLORS } from './palette';

const MAX_VEINS = 40;
const SUITE_C = new THREE.Color('#8fe9ff');
const GRAPPE_C = new THREE.Color('#d39bff');

/**
 * Filons : une plaque lumineuse derrière chaque groupe de briques organisé.
 * Cyan = Suite (valeurs croissantes), couleur des briques = Couleur, violet = Grappe (paires).
 */
export class VeinRenderer {
  readonly mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private col = new THREE.Color();
  private uniforms = { uTime: { value: 0 } };
  private kind: THREE.InstancedBufferAttribute;
  private groups = new Map<number, Brick[]>();

  constructor(private bricks: Brick[]) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.kind = new THREE.InstancedBufferAttribute(new Float32Array(MAX_VEINS * 2), 2);
    this.kind.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aVein', this.kind);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: `
        attribute vec2 aVein; varying vec2 vUv; varying vec2 vSize; varying vec3 vCol; varying float vKind;
        void main() {
          vUv = uv; vKind = aVein.x;
          vCol = instanceColor;
          vSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime; varying vec2 vUv; varying vec2 vSize; varying vec3 vCol; varying float vKind;
        void main() {
          vec2 p = (vUv - 0.5) * vSize;
          vec2 h = vSize * 0.5 - 0.12;
          float d = length(max(abs(p) - h, 0.0)) - 0.12;
          float rim = smoothstep(0.0, -0.04, d) * smoothstep(-0.13, -0.05, d);
          float fill = smoothstep(0.0, -0.05, d) * 0.12;
          float a = rim * 2.2 + fill;
          // Suite : chevrons qui montent vers la droite (sens des valeurs)
          if (vKind < 1.5) a += smoothstep(0.0, -0.05, d) * 0.18 * step(0.75, fract(p.x * 1.4 - abs(p.y) * 1.2 - uTime * 0.6));
          if (d > 0.0) discard;
          gl_FragColor = vec4(vCol * a * (0.85 + 0.15 * sin(uTime * 2.5)), 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_VEINS);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX_VEINS; i++) this.mesh.setColorAt(i, this.col.set(0, 0, 0));
  }

  update(dt: number, card: (uid: number) => BrickCard | undefined, hidden: boolean) {
    this.uniforms.uTime.value += dt;
    // Regroupement sans allocation par brique (appelé à chaque image)
    const groups = this.groups;
    if (groups.size > 200) groups.clear(); // identifiants de filons des murs précédents
    for (const list of groups.values()) list.length = 0;
    for (const b of this.bricks) {
      if (!b.vein || !b.alive) continue;
      let list = groups.get(b.vein);
      if (!list) groups.set(b.vein, (list = []));
      list.push(b);
    }
    let n = 0;
    const k = this.kind.array as Float32Array;
    for (const g of groups.values()) {
      if (hidden || n >= MAX_VEINS) break;
      if (!g.length) continue;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, c0 = Infinity, c1 = -Infinity;
      for (const b of g) {
        x0 = Math.min(x0, b.x - b.w / 2); x1 = Math.max(x1, b.x + b.w / 2);
        y0 = Math.min(y0, b.y - b.h / 2); y1 = Math.max(y1, b.y + b.h / 2);
        c0 = Math.min(c0, b.col); c1 = Math.max(c1, b.col);
      }
      // Filon coupé en deux par la boucle d'un tapis roulant : pas de plaque le temps du passage
      if (x1 - x0 > (c1 - c0 + 1) * (g[0].w + 0.1) + 0.3) continue;
      const b0 = g[0];
      this.dummy.position.set((x0 + x1) / 2, (y0 + y1) / 2, -0.32);
      this.dummy.scale.set(x1 - x0 + 0.34, y1 - y0 + 0.3, 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      const kind = b0.veinKind;
      const c = kind === 'suite' ? SUITE_C : kind === 'grappe' ? GRAPPE_C : BRICK_COLORS[card(b0.uid)?.color ?? b0.color];
      this.mesh.setColorAt(n, this.col.copy(c));
      k[n * 2] = kind === 'suite' ? 1 : kind === 'couleur' ? 2 : 3;
      n++;
    }
    this.mesh.count = n;
    this.kind.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
