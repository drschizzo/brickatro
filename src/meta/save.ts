/** Profil persistant (localStorage, protégé : le jeu marche même sans stockage). */
export interface Profile {
  bestAnte: number;
  wins: number;
  maxStake: number;
  bestHand: number;
  runs: number;
  seenRelics: string[];
  lastDeck: string;
  /** Tutoriel vu (proposé automatiquement au premier « Jouer »). */
  tutoSeen: boolean;
}

const KEY = 'brickatro.profile.v1';
const DEFAULT: Profile = { bestAnte: 0, wins: 0, maxStake: 0, bestHand: 0, runs: 0, seenRelics: [], lastDeck: 'rouge', tutoSeen: false };

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    /* stockage indisponible */
  }
  return { ...DEFAULT, seenRelics: [] };
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* stockage indisponible */
  }
}
