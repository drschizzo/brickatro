import * as THREE from 'three';

const MAX_DOTS = 160;
const SPACING = 0.42;

export interface GuidePath {
  pts: { x: number; y: number }[];
  color: THREE.Color;
  /** Taille des points (0..1). */
  size: number;
}

/**
 * Guide de visée : pointillés qui défilent le long de la trajectoire prédite,
 * plus un anneau là où la balle va toucher la raquette.
 */
export class AimGuide {
  readonly group = new THREE.Group();
  private dots: THREE.InstancedMesh;
  private marker: THREE.Mesh;
  private dummy = new THREE.Object3D();
  private time = 0;
  private alpha = 0;
  private paths: GuidePath[] = [];
  private markerX: number | null = null;
  private markerY = 0;
  private markerOk = true;

  constructor() {
    this.dots = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.09, 10),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
      MAX_DOTS,
    );
    this.dots.frustumCulled = false;
    for (let i = 0; i < MAX_DOTS; i++) this.dots.setColorAt(i, new THREE.Color(1, 1, 1));
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.45, 32),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.group.add(this.dots, this.marker);
  }

  set(paths: GuidePath[], marker: { x: number; y: number; ok: boolean } | null) {
    this.paths = paths;
    this.markerX = marker ? marker.x : null;
    if (marker) {
      this.markerY = marker.y;
      this.markerOk = marker.ok;
    }
  }

  update(dt: number) {
    this.time += dt;
    const visible = this.paths.length > 0 || this.markerX !== null;
    this.alpha += ((visible ? 1 : 0) - this.alpha) * Math.min(1, dt * 14);
    (this.dots.material as THREE.MeshBasicMaterial).opacity = this.alpha;
    let n = 0;
    const flow = (this.time * 1.6) % SPACING;
    for (const path of this.paths) {
      let carry = SPACING - flow;
      let traveled = 0;
      for (let i = 1; i < path.pts.length && n < MAX_DOTS; i++) {
        const a = path.pts[i - 1], b = path.pts[i];
        if (Number.isNaN(a.x) || Number.isNaN(b.x)) continue; // saut de portail
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        let d = carry;
        while (d < len && n < MAX_DOTS) {
          const t = d / len;
          const fade = Math.max(0.25, 1 - (traveled + d) / 30);
          this.dummy.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 0.35);
          this.dummy.scale.setScalar(path.size * fade);
          this.dummy.updateMatrix();
          this.dots.setMatrixAt(n, this.dummy.matrix);
          this.dots.setColorAt(n, path.color);
          n++;
          d += SPACING;
        }
        carry = d - len;
        traveled += len;
      }
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;

    const mm = this.marker.material as THREE.MeshBasicMaterial;
    if (this.markerX !== null) {
      this.marker.visible = true;
      this.marker.position.set(this.markerX, this.markerY, 0.35);
      this.marker.scale.setScalar(1 + Math.sin(this.time * 12) * 0.12);
      mm.color.set(this.markerOk ? '#9fffb0' : '#ff3d5a').multiplyScalar(2);
      mm.opacity = this.alpha;
    } else this.marker.visible = false;
  }
}
