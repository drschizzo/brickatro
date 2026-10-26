/**
 * Paliers de qualité graphique. Choisis au démarrage (appareil tactile = moyen),
 * forçables par l'URL (?q=low|medium|high), puis abaissés à chaud par Stage
 * si les images par seconde ne suivent pas.
 */
export type Tier = 'low' | 'medium' | 'high';

export interface Quality {
  tier: Tier;
  /** Plafond du ratio de pixels (le gouverneur peut descendre en dessous). */
  dprCap: number;
  /** Plancher du ratio de pixels pour le gouverneur. */
  dprMin: number;
  /** Pixels physiques maximum par image (le ratio de pixels baisse sur les très grands écrans). */
  pixelBudget: number;
  shadowSize: number;
  softShadows: boolean;
  /** Lumières d'impact simultanées (fixé à la compilation des shaders). */
  flashLights: number;
  antialias: 'smaa' | 'fxaa' | 'none';
  bloomLevels: number;
  /** Matières à vernis (clearcoat) pour les petits éléments (particules). */
  physicalParticles: boolean;
  particles: number;
}

const PRESETS: Record<Tier, Omit<Quality, 'tier'>> = {
  high: { dprCap: 2, dprMin: 1, pixelBudget: 4.2e6, shadowSize: 2048, softShadows: true, flashLights: 4, antialias: 'smaa', bloomLevels: 7, physicalParticles: true, particles: 700 },
  medium: { dprCap: 1.75, dprMin: 0.85, pixelBudget: 2.6e6, shadowSize: 1024, softShadows: false, flashLights: 3, antialias: 'fxaa', bloomLevels: 5, physicalParticles: false, particles: 450 },
  low: { dprCap: 1.25, dprMin: 0.7, pixelBudget: 1.5e6, shadowSize: 512, softShadows: false, flashLights: 2, antialias: 'fxaa', bloomLevels: 4, physicalParticles: false, particles: 300 },
};

function detect(): Tier {
  const forced = new URLSearchParams(location.search).get('q');
  if (forced === 'low' || forced === 'medium' || forced === 'high') return forced;
  // Téléphones et tablettes : palier moyen, le gouverneur affine ensuite
  return matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';
}

const tier = detect();
export const QUALITY: Quality = { tier, ...PRESETS[tier] };
// Lu par le CSS : sous le palier haut, pas de flou derrière les panneaux (coûteux sur un canvas animé)
document.documentElement.dataset.q = tier;
