import * as THREE from 'three';

/** La nébuleuse est floue par nature : calculée à 1/4 de la résolution (1/16 des pixels), puis agrandie. */
const NEBULA_SCALE = 0.25;

const FULLSCREEN_VS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;

/**
 * Fond : nébuleuse profonde (fbm à domaines déformés) + champ d'étoiles en parallaxe.
 * Volontairement sombre et peu contrasté pour laisser le terrain lisible ;
 * il s'anime et se réchauffe avec la tension de la Main.
 *
 * Coût : le fbm (20 bruits par pixel) est rendu dans une petite cible basse résolution ;
 * seules les étoiles, nettes, sont calculées à pleine résolution. Le fond est dessiné après
 * les objets opaques avec test de profondeur : les pixels cachés par le terrain sont sautés.
 */
export class Background {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    uTime: { value: 0 },
    uHeat: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uParallax: { value: new THREE.Vector2(0, 0) },
    uHue: { value: 0 },
    uFlash: { value: 0 },
  };
  private target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
  private nebula: THREE.Mesh;
  private nebulaCam = new THREE.Camera();

  constructor() {
    this.nebula = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      depthWrite: false,
      depthTest: false,
      vertexShader: FULLSCREEN_VS,
      fragmentShader: /* glsl */ `
        uniform float uTime, uHeat, uHue;
        uniform vec2 uRes, uParallax;
        varying vec2 vUv;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
          for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
          return v;
        }
        vec3 hue(float h) { return 0.5 + 0.5 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67))); }

        void main() {
          vec2 uv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
          float t = uTime;
          // Nébuleuse : fbm déformé par un autre fbm, dérive lente
          vec2 p = uv * 1.6 + uParallax * 0.15 + vec2(t * 0.012, -t * 0.008);
          vec2 w = vec2(fbm(p + t * 0.03), fbm(p + 5.2 - t * 0.025));
          float n = fbm(p + 2.2 * w);
          float n2 = fbm(p * 2.3 - w * 1.5 + 11.0);
          float h = uHue + 0.62 + 0.08 * sin(t * 0.05);
          vec3 deep = vec3(0.012, 0.016, 0.035);
          vec3 c1 = hue(h) * 0.22;
          vec3 c2 = mix(hue(h + 0.35), vec3(1.0, 0.45, 0.25), uHeat * 0.6) * 0.28;
          vec3 col = deep;
          col = mix(col, c1, smoothstep(0.35, 0.85, n));
          col = mix(col, c2, smoothstep(0.55, 0.95, n2) * (0.5 + 0.5 * n));
          // Filaments lumineux
          col += hue(h + 0.15) * pow(smoothstep(0.62, 0.7, n) * (1.0 - smoothstep(0.7, 0.78, n)), 1.5) * 0.12;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }));
    this.nebula.frustumCulled = false;

    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, tNebula: { value: this.target.texture } },
      depthWrite: false,
      vertexShader: FULLSCREEN_VS,
      fragmentShader: /* glsl */ `
        uniform float uTime, uHue, uFlash;
        uniform vec2 uRes, uParallax;
        uniform sampler2D tNebula;
        varying vec2 vUv;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        vec3 hue(float h) { return 0.5 + 0.5 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67))); }

        // Couche d'étoiles : cellules avec une étoile scintillante chacune
        float stars(vec2 uv, float scale, float t) {
          vec2 g = uv * scale;
          vec2 id = floor(g), f = fract(g) - 0.5;
          float h = hash(id);
          if (h < 0.86) return 0.0; // 86 % des cellules sont vides : on s'arrête là
          vec2 o = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
          float d = length(f - o * 0.7);
          float tw = 0.6 + 0.4 * sin(t * (1.0 + h * 3.0) + h * 40.0);
          return smoothstep(0.06, 0.0, d) * tw;
        }

        void main() {
          vec2 uv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
          float t = uTime;
          vec3 col = texture2D(tNebula, vUv).rgb;
          // Étoiles en trois plans de parallaxe
          col += vec3(0.8, 0.85, 1.0) * stars(uv + uParallax * 0.02, 18.0, t) * 0.5;
          col += vec3(0.9, 0.9, 1.0) * stars(uv + uParallax * 0.05 + 3.0, 34.0, t * 1.3) * 0.35;
          col += vec3(1.0, 0.95, 0.9) * stars(uv + uParallax * 0.1 + 7.0, 60.0, t * 1.7) * 0.25;
          // Éclat de la nébuleuse lors des gros encaissements
          float h = uHue + 0.62 + 0.08 * sin(t * 0.05);
          col *= 1.0 + uFlash * 2.5;
          col += hue(h + 0.1) * uFlash * 0.08;
          // Assombrissement central : le terrain reste lisible
          col *= mix(0.55, 1.0, smoothstep(0.15, 0.75, length(uv * vec2(0.8, 1.0))));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.frustumCulled = false;
    // Dernier des opaques : le test de profondeur élimine tout ce que le terrain recouvre
    this.mesh.renderOrder = 1000;
  }

  /** Taille du tampon de dessin (pixels physiques). */
  setSize(width: number, height: number) {
    this.target.setSize(Math.max(1, Math.round(width * NEBULA_SCALE)), Math.max(1, Math.round(height * NEBULA_SCALE)));
  }

  /** Calcule la nébuleuse basse résolution ; à appeler avant le rendu de la scène. */
  renderNebula(renderer: THREE.WebGLRenderer) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.nebula, this.nebulaCam);
    renderer.setRenderTarget(prev);
  }

  update(dt: number, heat: number, parallaxX: number, parallaxY: number) {
    this.uniforms.uTime.value += dt * (1 + heat * 1.5);
    this.uniforms.uHeat.value += (heat - this.uniforms.uHeat.value) * Math.min(1, dt * 2);
    this.uniforms.uParallax.value.set(parallaxX, parallaxY);
    this.uniforms.uFlash.value = Math.max(0, this.uniforms.uFlash.value - dt * 1.2);
  }
}
