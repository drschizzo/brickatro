import * as THREE from 'three';

/**
 * Colonnes de lumière verticales (encaissements) : un pilier additif qui jaillit
 * de la raquette, s'élargit puis se dissout, avec des bandes qui montent.
 */
export class Beams {
  readonly group = new THREE.Group();
  private items: { mesh: THREE.Mesh; u: { uT: { value: number }; uColor: { value: THREE.Color }; uPower: { value: number } }; life: number; max: number }[] = [];

  constructor(n = 3) {
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    geo.translate(0, 0.5, 0);
    for (let i = 0; i < n; i++) {
      const u = { uT: { value: 1 }, uColor: { value: new THREE.Color() }, uPower: { value: 1 } };
      const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          uniform float uT, uPower; uniform vec3 uColor; varying vec2 vUv;
          void main() {
            float x = abs(vUv.x - 0.5) * 2.0;
            float core = exp(-x * x * 18.0);
            float soft = exp(-x * x * 3.0) * 0.35;
            float rise = smoothstep(0.0, 0.25, uT);
            float top = smoothstep(rise, rise - 0.35, vUv.y);
            float bands = 0.75 + 0.25 * sin(vUv.y * 40.0 - uT * 30.0);
            float fade = (1.0 - smoothstep(0.35, 1.0, uT));
            float a = (core * 1.6 + soft) * top * bands * fade * uPower;
            gl_FragColor = vec4(uColor * a * 2.2, 1.0);
          }`,
      }));
      mesh.visible = false;
      this.group.add(mesh);
      this.items.push({ mesh, u, life: 0, max: 1 });
    }
  }

  spawn(x: number, y: number, color: THREE.Color, power: number, camera: THREE.Camera) {
    const it = this.items.find((b) => b.life <= 0) ?? this.items[0];
    it.life = it.max = 0.9;
    it.mesh.position.set(x, y, 0.4);
    it.mesh.quaternion.copy(camera.quaternion);
    it.mesh.scale.set(1.2 + power * 2.4, 26, 1);
    it.u.uColor.value.copy(color);
    it.u.uPower.value = 0.6 + power * 0.8;
    it.mesh.visible = true;
  }

  update(dt: number) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      it.u.uT.value = 1 - it.life / it.max;
      if (it.life <= 0) it.mesh.visible = false;
    }
  }
}

/**
 * Comètes : éclats dorés qui partent d'un point du terrain et filent en courbe
 * vers une cible (le compteur de score), avec une traînée. Rendu en points additifs.
 */
export class Comets {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private items: { p0: THREE.Vector3; p1: THREE.Vector3; c: THREE.Vector3; t: number; dur: number; delay: number; color: THREE.Color; done: boolean }[] = [];
  private readonly TRAIL = 6;
  onArrive: (() => void) | null = null;

  constructor(private max = 60) {
    const n = max * this.TRAIL;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      vertexShader: /* glsl */ `
        attribute float aSize; varying vec3 vC;
        void main() {
          vC = color;
          // Taille nulle = emplacement libre. Un point de taille 0 reste dessiné sur 1 pixel (Metal/ANGLE) :
          // des centaines de ces pixels, avec la couleur d'anciennes comètes, s'empilaient en additif et le
          // bloom les étalait en carrés lumineux. On les envoie hors de l'écran.
          if (aSize <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * 300.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = exp(-d * d * 4.0);
          gl_FragColor = vec4(vC * a, 1.0);
        }`,
    }));
    this.points.frustumCulled = false;
  }

  launch(from: { x: number; y: number }, to: { x: number; y: number }, color: THREE.Color, count: number) {
    for (let i = 0; i < count; i++) {
      if (this.items.length >= this.max) this.items.shift();
      const p0 = new THREE.Vector3(from.x + (Math.random() - 0.5) * 2, from.y + Math.random() * 0.6, 0.5);
      const p1 = new THREE.Vector3(to.x, to.y, 0.5);
      // Point de contrôle : la comète part vers le haut avant de plonger sur la cible
      const c = new THREE.Vector3((p0.x + p1.x) / 2 + (Math.random() - 0.5) * 8, Math.max(p0.y, p1.y) + 4 + Math.random() * 6, 0.5);
      this.items.push({ p0, p1, c, t: 0, dur: 0.55 + Math.random() * 0.35, delay: i * 0.018, color: color.clone(), done: false });
    }
  }

  private at(it: { p0: THREE.Vector3; p1: THREE.Vector3; c: THREE.Vector3 }, t: number, out: THREE.Vector3) {
    const u = 1 - t;
    return out.set(
      u * u * it.p0.x + 2 * u * t * it.c.x + t * t * it.p1.x,
      u * u * it.p0.y + 2 * u * t * it.c.y + t * t * it.p1.y,
      0.5,
    );
  }

  update(dt: number) {
    const v = new THREE.Vector3();
    this.size.fill(0);
    this.items.forEach((it, i) => {
      if (it.delay > 0) { it.delay -= dt; return; }
      it.t += dt / it.dur;
      if (it.t >= 1 && !it.done) {
        it.done = true;
        this.onArrive?.();
      }
      for (let k = 0; k < this.TRAIL; k++) {
        const tk = Math.min(1, Math.max(0, it.t - k * 0.035));
        const e = tk * tk * (3 - 2 * tk);
        this.at(it, e, v);
        const o = (i * this.TRAIL + k) * 3;
        this.pos[o] = v.x; this.pos[o + 1] = v.y; this.pos[o + 2] = v.z;
        const fade = (1 - k / this.TRAIL) * (it.t >= 1 ? 0 : 1);
        this.col[o] = it.color.r * 2.5 * fade; this.col[o + 1] = it.color.g * 2.5 * fade; this.col[o + 2] = it.color.b * 2.5 * fade;
        this.size[i * this.TRAIL + k] = (0.55 - k * 0.07) * fade;
      }
    });
    const g = this.points.geometry;
    g.setDrawRange(0, this.items.length * this.TRAIL); // avant le filtrage : les emplacements écrits ci-dessus
    this.items = this.items.filter((it) => !it.done || it.t < 1.05);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }
}
