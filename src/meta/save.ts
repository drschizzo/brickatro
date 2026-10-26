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

const RUN_KEY = 'brickatro.run.v1';

/** Run en cours (reprise au début du Mur), ou null. */
export function loadRunSave<T>(): T | null {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function storeRunSave(save: unknown | null) {
  try {
    if (save) localStorage.setItem(RUN_KEY, JSON.stringify(save));
    else localStorage.removeItem(RUN_KEY);
  } catch {
    /* stockage indisponible */
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* stockage indisponible */
  }
}
