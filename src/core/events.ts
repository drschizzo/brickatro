type Handler<T> = (payload: T) => void;

/** Petit bus d'événements typé : la sim émet, le rendu / l'audio / le HUD écoutent. */
export class Emitter<M extends Record<string, unknown>> {
  private handlers: { [K in keyof M]?: Handler<M[K]>[] } = {};
  on<K extends keyof M>(type: K, h: Handler<M[K]>) {
    (this.handlers[type] ??= []).push(h);
  }
  emit<K extends keyof M>(type: K, payload: M[K]) {
    this.handlers[type]?.forEach((h) => h(payload));
  }
}
