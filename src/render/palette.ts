import * as THREE from 'three';

/** Palette inspirée de Balatro : couleurs saturées, rouge/bleu dominants. */
export const BRICK_COLORS = [
  new THREE.Color('#fe5f55'), // Feu
  new THREE.Color('#2d9cff'), // Eau
  new THREE.Color('#ffc53d'), // Foudre
  new THREE.Color('#3fd18f'), // Terre
];
export const BRICK_CSS = ['#fe5f55', '#2d9cff', '#ffc53d', '#3fd18f'];

/** Couleur de la balle selon le combo : blanc → jaune → orange → rouge → violet. */
const HEAT = ['#ffffff', '#fff3a0', '#ffb43d', '#ff5a3d', '#ff2d8a', '#b85cff'].map((c) => new THREE.Color(c));
export function heatColor(t: number, out: THREE.Color) {
  const x = Math.min(HEAT.length - 1.001, Math.max(0, t * (HEAT.length - 1)));
  const i = Math.floor(x);
  return out.copy(HEAT[i]).lerp(HEAT[i + 1], x - i);
}
