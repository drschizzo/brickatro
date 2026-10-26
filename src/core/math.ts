export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Lerp indépendant du framerate. */
export const damp = (a: number, b: number, lambda: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Ressort amorti (pour les wobbles). */
export class Spring {
  value = 0;
  vel = 0;
  constructor(public stiffness = 300, public damping = 14) {}
  kick(v: number) {
    this.vel += v;
  }
  update(dt: number, target = 0) {
    const f = -this.stiffness * (this.value - target) - this.damping * this.vel;
    this.vel += f * dt;
    this.value += this.vel * dt;
  }
}

export const easeOutBack = (t: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutElastic = (t: number) =>
  t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;

export const fmt = (n: number) => {
  // Mode infini : notation scientifique quand les scores s'envolent
  if (n >= 1e12) return n.toExponential(2).replace('e+', 'e');
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e7) return (n / 1e6).toFixed(1) + 'M';
  return Math.floor(n).toLocaleString('fr-FR');
};
