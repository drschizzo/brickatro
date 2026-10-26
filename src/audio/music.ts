/**
 * Boucle lofi procédurale : Rhodes feutré, basse ronde, batterie swinguée, craquement vinyle.
 * Grille ii–V–I–vi en La majeur → reste juste avec la pentatonique des SFX.
 */
const BPM = 72;
const STEP = 60 / BPM / 4; // double-croche
const SWING = STEP * 0.28;
const LOOKAHEAD = 1.5; // s, large pour survivre au throttling des onglets en arrière-plan
const VOL = 0.22;

/** Bm9 – E9 – Amaj9 – F#m9 (notes MIDI). */
const BARS = [
  { root: 47, keys: [57, 61, 62, 66] },
  { root: 40, keys: [56, 59, 62, 66] },
  { root: 45, keys: [56, 59, 61, 64] },
  { root: 42, keys: [57, 61, 64, 68] },
];
const MELODY = [69, 71, 73, 76, 78, 81];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  private bus: GainNode;
  private keysIn: BiquadFilterNode;
  private echo: GainNode;
  private wobble: GainNode;
  private noise: AudioBuffer;
  private step = 0;
  private t0 = 0;
  private timer = 0;
  private lastLead = 0;

  constructor(private ctx: AudioContext, out: AudioNode) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    this.bus.connect(tone).connect(out);

    // Rhodes : passe-bas doux + délai en 3/8 de temps
    this.keysIn = ctx.createBiquadFilter();
    this.keysIn.type = 'lowpass';
    this.keysIn.frequency.value = 1700;
    this.keysIn.connect(this.bus);
    const delay = ctx.createDelay(2);
    delay.delayTime.value = STEP * 6;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    this.echo = ctx.createGain();
    this.echo.gain.value = 0.35;
    this.echo.connect(delay).connect(fb).connect(delay);
    delay.connect(this.keysIn);

    // Pleurage de bande : un LFO commun module le detune de chaque note
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.45;
    this.wobble = ctx.createGain();
    this.wobble.gain.value = 9;
    lfo.connect(this.wobble);
    lfo.start();

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.vinyl();
  }

  start() {
    if (this.timer) return;
    const now = this.ctx.currentTime;
    this.t0 = now + 0.1;
    this.step = 0;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setValueAtTime(0, now);
    this.bus.gain.linearRampToValueAtTime(VOL, now + 4);
    this.timer = window.setInterval(() => this.schedule(), 250);
    this.schedule();
  }

  private schedule() {
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    for (;;) {
      const t = this.t0 + this.step * STEP + (this.step % 2 ? SWING : 0);
      if (t > horizon) break;
      // Rattrapage après une longue suspension : on recale au lieu de tout jouer d'un coup
      if (t < this.ctx.currentTime - 0.05) {
        this.t0 = this.ctx.currentTime + 0.05 - this.step * STEP;
        continue;
      }
      this.play(this.step, t);
      this.step++;
    }
  }

  private play(s: number, t: number) {
    const i = s % 16;
    const bar = BARS[Math.floor(s / 16) % BARS.length];
    const r = Math.random;

    if (i === 0) {
      bar.keys.forEach((m, k) => this.key(mtof(m), t + k * 0.018, 2.6, 0.05));
      this.bass(mtof(bar.root), t, 1.1);
    }
    if (i === 10) {
      if (r() < 0.6) bar.keys.slice(1).forEach((m, k) => this.key(mtof(m), t + k * 0.014, 1.2, 0.028));
      this.bass(mtof(bar.root + (r() < 0.4 ? 7 : 0)), t, 0.6);
    }

    if (i === 0 || i === 7 || (i === 10 && r() < 0.7)) this.kick(t);
    if (i === 4 || i === 12) this.snare(t);
    if (i % 2 === 0) this.hat(t, i % 4 === 0 ? 0.05 : 0.035);
    else if (r() < 0.25) this.hat(t, 0.015);

    // Mélodie clairsemée, plutôt sur les croches, jamais deux notes trop serrées
    if (i % 2 === 0 && i !== 0 && s - this.lastLead > 3 && r() < 0.16) {
      this.lastLead = s;
      this.key(mtof(MELODY[Math.floor(r() * MELODY.length)]), t, 1.4, 0.035, true);
    }
  }

  private key(f: number, t: number, dur: number, vol: number, echo = false) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(vol * 0.4, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.keysIn);
    if (echo) g.connect(this.echo);
    for (const [mul, type, amp] of [[1, 'sine', 1], [2, 'sine', 0.22], [1, 'triangle', 0.25]] as const) {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = type;
      o.frequency.value = f * mul;
      og.gain.value = amp;
      this.wobble.connect(o.detune);
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
      o.onended = () => this.wobble.disconnect(o.detune);
    }
  }

  private bass(f: number, t: number, dur: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.32);
  }

  private snare(t: number) {
    this.noiseHit(t, 0.18, 0.09, 'bandpass', 1700, 0.7);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.value = 190;
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.1);
  }

  private hat(t: number, vol: number) {
    this.noiseHit(t, 0.04, vol, 'highpass', 6500, 0.7);
  }

  private noiseHit(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number, q: number) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.bus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur);
  }

  /** Souffle + craquements en boucle, joués en continu. */
  private vinyl() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.06;
      if (Math.random() < 0.00012) d[i] = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6);
    }
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2500;
    f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.18;
    s.connect(f).connect(g).connect(this.bus);
    s.start();
  }
}
