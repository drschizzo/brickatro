/** Screen shake à base de "trauma" (Squirrel Eiserloh) : intensité = trauma², bruit lisse. */
export class Shake {
  trauma = 0;
  x = 0;
  y = 0;
  rot = 0;
  private t = 0;
  add(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }
  update(dt: number) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma;
    const n = (f: number, o: number) =>
      Math.sin(this.t * f + o) * 0.6 + Math.sin(this.t * f * 2.13 + o * 1.7) * 0.4;
    this.x = s * 0.9 * n(37, 0);
    this.y = s * 0.9 * n(41, 11);
    this.rot = s * 0.04 * n(29, 23);
  }
}
