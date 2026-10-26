/**
 * Entrées unifiées desktop / mobile.
 * - Souris : la raquette suit le curseur, clic = lancer, clic maintenu = attraper/encaisser.
 * - Tactile : glisser n'importe où (relatif), gros bouton = lancer / attraper.
 * - Clavier : ←/→ (ou Q/D, A/D), Espace = lancer / attraper.
 */
export class Input {
  /** x monde visé (absolu souris) ou delta (tactile/clavier) appliqué par le jeu. */
  mouseX: number | null = null;
  dragDelta = 0; // pixels accumulés depuis la dernière frame
  keyDir = 0;
  held = false;
  holdStart = 0;
  touch = false;
  onPress: () => void = () => {};
  onFirstGesture: () => void = () => {};
  onRelease: () => void = () => {};
  /** Glissement horizontal du doigt sur le gros bouton (visée tactile), en pixels. */
  btnDrag = 0;
  onMute: () => void = () => {};
  onKey: (code: string) => void = () => {};
  /** Clic/tap sur le terrain, prioritaire (sélection de briques). Retourne true si consommé. */
  onTap: ((x: number, y: number) => boolean) | null = null;

  private dragId: number | null = null;
  private lastX = 0;
  private keys = new Set<string>();

  constructor(catchBtn: HTMLElement, private isBlocked: () => boolean) {
    // Écran tactile : boutons affichés d'emblée (évite que la mise en page saute au premier contact)
    if (matchMedia('(pointer: coarse)').matches) this.setTouch();
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;
      } else if (e.pointerId === this.dragId) {
        this.dragDelta += e.clientX - this.lastX;
        this.lastX = e.clientX;
      }
    });
    window.addEventListener('pointerdown', (e) => {
      this.onFirstGesture();
      // Au doigt, les panneaux d'information laissent passer le glissé (la barre du bas est sous le pouce)
      const blockers = e.pointerType === 'mouse' ? 'button, .card, input, #hud, #side, #targetBar' : 'button, .card, input, #targetBar';
      if (this.isBlocked() || (e.target as HTMLElement).closest(blockers)) return;
      if (this.onTap?.(e.clientX, e.clientY)) return;
      if (e.pointerType === 'mouse') {
        if (e.button !== 0) return;
        this.press();
      } else {
        this.setTouch();
        this.dragId = e.pointerId;
        this.lastX = e.clientX;
      }
    });
    const release = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && this.held) {
        this.held = false;
        this.onRelease();
      }
      if (e.pointerId === this.dragId) this.dragId = null;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    catchBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onFirstGesture();
      this.setTouch();
      catchBtn.setPointerCapture(e.pointerId);
      this.btnLastX = e.clientX;
      this.press();
    });
    catchBtn.addEventListener('pointermove', (e) => {
      if (!this.held) return;
      this.btnDrag += e.clientX - this.btnLastX;
      this.btnLastX = e.clientX;
    });
    const up = (e: PointerEvent) => {
      e.stopPropagation();
      if (!this.held) return;
      this.held = false;
      this.onRelease();
    };
    catchBtn.addEventListener('pointerup', up);
    catchBtn.addEventListener('pointercancel', up);
    catchBtn.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      this.onFirstGesture();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') {
        e.preventDefault();
        if (!this.isBlocked()) this.press();
      }
      if (e.code === 'KeyM') this.onMute();
      else if (!this.isBlocked()) this.onKey(e.code);
      this.updateKeys();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space' && this.held) {
        this.held = false;
        this.onRelease();
      }
      this.updateKeys();
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.held = false;
      this.updateKeys();
    });
  }

  mouseY = 0;
  private btnLastX = 0;

  consumeBtnDrag() {
    const d = this.btnDrag;
    this.btnDrag = 0;
    return d;
  }

  private press() {
    this.held = true;
    this.holdStart = performance.now();
    this.onPress();
  }

  private setTouch() {
    if (this.touch) return;
    this.touch = true;
    document.body.classList.add('touch');
    window.dispatchEvent(new Event('resize'));
  }

  private updateKeys() {
    const l = this.keys.has('ArrowLeft') || this.keys.has('KeyA') || this.keys.has('KeyQ');
    const r = this.keys.has('ArrowRight') || this.keys.has('KeyD');
    this.keyDir = (r ? 1 : 0) - (l ? 1 : 0);
    if (this.keyDir) this.mouseX = null;
  }

  consumeDrag() {
    const d = this.dragDelta;
    this.dragDelta = 0;
    return d;
  }
}
