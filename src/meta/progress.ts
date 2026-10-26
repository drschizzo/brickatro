import { STAKES } from '../rules/decks';
import type { Run } from '../rules/run';
import { loadProfile, saveProfile, type Profile } from './save';

/**
 * Progression du joueur entre les parties : chaque évènement du run passe par ici,
 * et le profil est sauvegardé aussitôt.
 */
export class Progress {
  readonly profile: Profile = loadProfile();

  private save() {
    saveProfile(this.profile);
  }

  /** Une partie commence avec ce deck. */
  runStarted(deckId: string) {
    this.profile.runs++;
    this.profile.lastDeck = deckId;
    this.profile.bestAnte = Math.max(this.profile.bestAnte, 1);
    this.save();
  }

  /** Une Ante est atteinte. */
  anteReached(ante: number) {
    this.profile.bestAnte = Math.max(this.profile.bestAnte, ante);
    this.save();
  }

  /** Un encaissement : meilleur coup ? */
  handScored(total: number) {
    if (total <= this.profile.bestHand) return;
    this.profile.bestHand = total;
    this.save();
  }

  /** Fin de partie (défaite ou abandon). */
  runEnded(run: Run) {
    this.profile.bestAnte = Math.max(this.profile.bestAnte, run.ante);
    this.profile.bestHand = Math.max(this.profile.bestHand, run.stats.bestHand);
    this.save();
  }

  /** Victoire : la Mise suivante se débloque. */
  runWon(run: Run) {
    this.profile.wins++;
    this.profile.maxStake = Math.min(STAKES.length - 1, Math.max(this.profile.maxStake, run.stakeIdx + 1));
    this.profile.bestAnte = Math.max(this.profile.bestAnte, run.ante);
    this.save();
  }

  /** Reliques vues (collection). */
  relicsSeen(ids: Iterable<string>) {
    const seen = new Set(this.profile.seenRelics);
    for (const id of ids) seen.add(id);
    if (seen.size === this.profile.seenRelics.length) return;
    this.profile.seenRelics = [...seen];
    this.save();
  }

  tutorialSeen() {
    this.profile.tutoSeen = true;
    this.save();
  }
}
