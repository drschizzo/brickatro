import { BlendFunction, Effect } from 'postprocessing';
import { Uniform, Vector4 } from 'three';

const MAX_RIPPLES = 8;

/**
 * Ondes de choc en espace écran : un anneau qui se propage et réfracte l'image.
 * Plusieurs ondes simultanées (impacts, explosions, encaissements).
 */
export class RippleEffect extends Effect {
  private ripples: Vector4[];
  private next = 0;

  constructor() {
    const ripples = Array.from({ length: MAX_RIPPLES }, () => new Vector4(0, 0, 9, 0));
    super('RippleEffect', /* glsl */ `
      uniform vec4 uRipples[${MAX_RIPPLES}];
      void mainUv(inout vec2 uv) {
        float asp = resolution.x / resolution.y;
        vec2 acc = vec2(0.0);
        for (int i = 0; i < ${MAX_RIPPLES}; i++) {
          vec4 r = uRipples[i];
          if (r.w <= 0.0 || r.z > 1.2) continue;
          vec2 d = uv - r.xy;
          d.x *= asp;
          float dist = length(d);
          float radius = r.z * (0.35 + r.w * 0.5);
          float width = 0.025 + r.z * 0.04;
          float band = exp(-pow((dist - radius) / width, 2.0));
          float fade = (1.0 - smoothstep(0.0, 1.2, r.z)) * r.w;
          vec2 dir = d / max(dist, 1e-4);
          dir.x /= asp;
          acc += dir * band * fade;
        }
        uv -= acc * 0.018;
      }`, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([['uRipples', new Uniform(ripples)]]),
    });
    this.ripples = ripples;
  }

  /** uv : coordonnées écran (0..1, origine en bas à gauche). */
  spawn(u: number, v: number, strength: number) {
    const r = this.ripples[this.next];
    this.next = (this.next + 1) % MAX_RIPPLES;
    r.set(u, v, 0, Math.min(1.5, strength));
  }

  /** Avance les ondes ; retourne true tant qu'une onde est visible. */
  tick(dt: number) {
    let active = false;
    for (const r of this.ripples) {
      r.z += dt;
      if (r.w > 0 && r.z <= 1.2) active = true;
    }
    return active;
  }
}

/**
 * Étalonnage final : ombres froides, hautes lumières chaudes, légère saturation,
 * vignette douce et grain fin animé (remplace le CRT, trop "rétro").
 */
export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */ `
      uniform float uHeat;
      uniform float uFlash;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // Split-toning : ombres bleu-sarcelle, lumières ambrées (plus chaudes quand la Main chauffe)
        vec3 shadowTint = vec3(0.02, 0.05, 0.09);
        vec3 lightTint = mix(vec3(1.02, 0.99, 0.95), vec3(1.08, 0.97, 0.88), uHeat);
        c = mix(c + shadowTint * (1.0 - l), c * lightTint, smoothstep(0.2, 0.9, l));
        // Saturation légère
        c = mix(vec3(l), c, 1.08);
        // Vignette douce (ovale, suit le ratio)
        vec2 q = uv - 0.5;
        q.x *= resolution.x / resolution.y * 0.75;
        float vig = smoothstep(0.95, 0.25, length(q));
        c *= mix(0.62, 1.0, vig);
        // Flash blanc des gros encaissements
        c += uFlash * 0.25 * (1.0 - l);
        // Grain fin
        float g = hash(uv * resolution + fract(time * 13.0) * 100.0) - 0.5;
        c += g * 0.025;
        outputColor = vec4(c, inputColor.a);
      }`, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([['uHeat', new Uniform(0)], ['uFlash', new Uniform(0)]]),
    });
  }

  set heat(v: number) {
    this.uniforms.get('uHeat')!.value = v;
  }
  set flash(v: number) {
    this.uniforms.get('uFlash')!.value = v;
  }
}
