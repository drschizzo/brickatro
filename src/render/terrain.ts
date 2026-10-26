import * as THREE from 'three';
import { Spring } from '../core/math';
import type { Bumper, Portal } from '../sim/world';

/** Bumpers (champignons de flipper) et portails reliés. */
export class TerrainRenderer {
  readonly group = new THREE.Group();
  private bumpers: { mesh: THREE.Group; spring: Spring; src: Bumper; ring: THREE.Mesh }[] = [];
  private portals: { a: THREE.Group; b: THREE.Group; link: THREE.Line }[] = [];
  private time = 0;

  setup(bumpers: Bumper[], portals: Portal[]) {
    this.group.clear();
    this.bumpers = [];
    this.portals = [];
    for (const b of bumpers) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(b.r, b.r * 1.1, 0.6, 32),
        new THREE.MeshStandardMaterial({ color: '#ff4d9a', emissive: '#ff2d8a', emissiveIntensity: 0.9, roughness: 0.3 }),
      );
      body.rotation.x = Math.PI / 2;
      const cap = new THREE.Mesh(
        new THREE.CircleGeometry(b.r * 0.55, 24),
        new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe0f0').multiplyScalar(2), toneMapped: false }),
      );
      cap.position.z = 0.31;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(b.r * 1.05, b.r * 1.25, 32),
        new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2d8a').multiplyScalar(2), transparent: true, opacity: 0.5, toneMapped: false, depthWrite: false }),
      );
      ring.position.z = 0.05;
      g.add(body, cap, ring);
      g.position.set(b.x, b.y, 0);
      this.group.add(g);
      this.bumpers.push({ mesh: g, spring: new Spring(500, 12), src: b, ring });
    }
    for (const p of portals) {
      const make = (x: number, y: number, color: string) => {
        const g = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const r = new THREE.Mesh(
            new THREE.TorusGeometry(p.r * (0.55 + i * 0.22), 0.05, 8, 36, Math.PI * 1.4),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), toneMapped: false }),
          );
          r.rotation.z = i * 2;
          g.add(r);
        }
        const core = new THREE.Mesh(
          new THREE.CircleGeometry(p.r * 0.5, 24),
          new THREE.MeshBasicMaterial({ color: '#05020f' }),
        );
        g.add(core);
        g.position.set(x, y, 0);
        this.group.add(g);
        return g;
      };
      const a = make(p.ax, p.ay, '#b85cff');
      const b = make(p.bx, p.by, '#2dd4ff');
      const link = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p.ax, p.ay, -0.3), new THREE.Vector3(p.bx, p.by, -0.3)]),
        new THREE.LineDashedMaterial({ color: '#7a5cff', dashSize: 0.3, gapSize: 0.3, transparent: true, opacity: 0.35 }),
      );
      link.computeLineDistances();
      this.group.add(link);
      this.portals.push({ a, b, link });
    }
  }

  hitBumper(b: Bumper) {
    this.bumpers.find((x) => x.src === b)?.spring.kick(14);
  }

  update(dt: number) {
    this.time += dt;
    for (const b of this.bumpers) {
      b.spring.update(dt);
      const s = 1 + b.spring.value * 0.08;
      b.mesh.scale.set(s, s, 1);
      (b.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.min(0.6, Math.abs(b.spring.value) * 0.1) + Math.sin(this.time * 3) * 0.1;
    }
    for (const p of this.portals) {
      p.a.children.forEach((c, i) => (c.rotation.z += dt * (2 + i)));
      p.b.children.forEach((c, i) => (c.rotation.z -= dt * (2 + i)));
    }
  }
}
