import * as THREE from 'three';
import { QUALITY } from './quality';

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number; ry: number; vr: number;
  life: number; max: number; size: number;
}

/**
 * Éclats : fragments plats et anguleux (tétraèdres aplatis), matière laquée qui accroche la lumière,
 * avec une lueur de la couleur de la brique. Pool sans allocation pendant le jeu.
 */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private ps: P[] = [];
  private next = 0;
  private dummy = new THREE.Object3D();
  private col = new THREE.Color();

  constructor(private count = QUALITY.particles) {
    const geo = new THREE.TetrahedronGeometry(1, 0);
    geo.scale(1, 1, 0.25);
    const mat = QUALITY.physicalParticles
      ? new THREE.MeshPhysicalMaterial({ roughness: 0.2, metalness: 0.1, clearcoat: 1, envMapIntensity: 1.4 })
      : new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.1, envMapIntensity: 1.4 });
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n totalEmissiveRadiance += vColor.rgb * 0.9;',
      );
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = QUALITY.tier === 'high';
    for (let i = 0; i < count; i++) {
      this.ps.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, vr: 0, life: 0, max: 1, size: 0 });
      this.mesh.setColorAt(i, this.col.set(1, 1, 1));
      this.mesh.setMatrixAt(i, ZERO);
    }
  }

  burst(x: number, y: number, color: THREE.Color, n: number, power = 1, dirX = 0, dirY = 0) {
    for (let k = 0; k < n; k++) {
      const p = this.ps[this.next];
      const i = this.next;
      this.next = (this.next + 1) % this.count;
      const a = Math.random() * Math.PI * 2;
      const sp = (2 + Math.random() * 8) * power;
      p.x = x + (Math.random() - 0.5) * 0.8; p.y = y + (Math.random() - 0.5) * 0.3; p.z = 0;
      p.vx = Math.cos(a) * sp + dirX * 6;
      p.vy = Math.sin(a) * sp + dirY * 6;
      p.vz = (Math.random() * 0.8 + 0.2) * 7 * power;
      p.rx = Math.random() * 6; p.ry = Math.random() * 6;
      p.vr = (Math.random() - 0.5) * 24;
      p.max = p.life = 0.6 + Math.random() * 0.8;
      p.size = 0.07 + Math.random() * 0.2 * Math.min(1.5, power);
      this.col.copy(color);
      if (Math.random() < 0.15) this.col.setRGB(1.6, 1.5, 1.3);
      this.mesh.setColorAt(i, this.col);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    // Une particule éteinte garde sa matrice nulle : on ne la recalcule pas, et sans particule vive rien n'est envoyé au GPU
    let dirty = false;
    for (let i = 0; i < this.count; i++) {
      const p = this.ps[i];
      if (p.life <= 0) {
        if (p.size === 0) continue;
        p.size = 0;
        this.dummy.scale.setScalar(0);
      } else {
        p.life -= dt;
        p.vy -= 20 * dt;
        p.vx *= 1 - 1.2 * dt;
        p.vz *= 1 - 1.2 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rx += p.vr * dt; p.ry += p.vr * 0.7 * dt;
        const s = p.size * Math.min(1, (p.life / p.max) * 2.5);
        this.dummy.position.set(p.x, p.y, p.z);
        this.dummy.rotation.set(p.rx, p.ry, p.rx * 0.5);
        this.dummy.scale.setScalar(Math.max(0, s));
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Étincelles : traits lumineux étirés dans le sens de la vitesse (bloom → filaments). */
export class Sparks {
  readonly lines: THREE.LineSegments;
  private pos: Float32Array;
  private colors: Float32Array;
  private ps: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; r: number; g: number; b: number }[] = [];
  private next = 0;

  constructor(private count = 400) {
    this.pos = new Float32Array(count * 6);
    this.colors = new Float32Array(count * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.lines.frustumCulled = false;
    for (let i = 0; i < count; i++) this.ps.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, r: 1, g: 1, b: 1 });
  }

  burst(x: number, y: number, color: THREE.Color, n: number, power = 1, dirX = 0, dirY = 0) {
    for (let k = 0; k < n; k++) {
      const p = this.ps[this.next];
      this.next = (this.next + 1) % this.count;
      const a = Math.random() * Math.PI * 2;
      const sp = (6 + Math.random() * 16) * power;
      p.x = x; p.y = y; p.z = 0.2;
      p.vx = Math.cos(a) * sp + dirX * 8;
      p.vy = Math.sin(a) * sp + dirY * 8;
      p.vz = Math.random() * 4;
      p.max = p.life = 0.25 + Math.random() * 0.35;
      const w = Math.random() < 0.5 ? 1 : 0;
      p.r = (color.r + w) * 2.2; p.g = (color.g + w * 0.9) * 2.2; p.b = (color.b + w * 0.7) * 2.2;
    }
  }

  update(dt: number) {
    let dirty = false;
    for (let i = 0; i < this.count; i++) {
      const p = this.ps[i];
      const o = i * 6;
      if (p.life <= 0) {
        // Éteinte : couleur mise à zéro une seule fois (max sert de drapeau)
        if (p.max === 0) continue;
        p.max = 0;
        this.colors.fill(0, o, o + 6);
        dirty = true;
        continue;
      }
      dirty = true;
      p.life -= dt;
      p.vy -= 14 * dt;
      p.vx *= 1 - 3 * dt;
      p.vy *= 1 - 3 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = Math.max(0, p.life / p.max);
      const len = 0.035;
      this.pos[o] = p.x; this.pos[o + 1] = p.y; this.pos[o + 2] = p.z;
      this.pos[o + 3] = p.x - p.vx * len; this.pos[o + 4] = p.y - p.vy * len; this.pos[o + 5] = p.z;
      this.colors[o] = p.r * k; this.colors[o + 1] = p.g * k; this.colors[o + 2] = p.b * k;
      this.colors[o + 3] = 0; this.colors[o + 4] = 0; this.colors[o + 5] = 0;
    }
    if (!dirty) return;
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }
}

/** Anneaux d'onde de choc (impacts, encaissement). */
export class Rings {
  readonly group = new THREE.Group();
  private items: { mesh: THREE.Mesh; life: number; max: number; size: number }[] = [];

  constructor(n = 24) {
    const geo = new THREE.RingGeometry(0.85, 1, 48);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.items.push({ mesh, life: 0, max: 1, size: 1 });
    }
  }

  spawn(x: number, y: number, color: THREE.Color, size = 2, life = 0.35) {
    const it = this.items.find((r) => r.life <= 0) ?? this.items[0];
    it.life = it.max = life;
    it.size = size;
    it.mesh.position.set(x, y, 0.3);
    (it.mesh.material as THREE.MeshBasicMaterial).color.copy(color).multiplyScalar(2.5);
    it.mesh.visible = true;
  }

  update(dt: number) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      const t = 1 - it.life / it.max;
      it.mesh.scale.setScalar(0.2 + it.size * (1 - Math.pow(1 - t, 3)));
      (it.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      if (it.life <= 0) it.mesh.visible = false;
    }
  }
}
