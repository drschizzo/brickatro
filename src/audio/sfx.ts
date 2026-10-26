/** Synthé Web Audio procédural : aucun asset, tout est en gamme pentatonique → toujours juste. */
import { Music } from './music';

const PENTA = [0, 2, 4, 7, 9];
const BASE = 220; // La3

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private music?: Music;
  muted = false;

  /** Doit être appelé depuis un geste utilisateur (politique autoplay). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(comp).connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.music = new Music(ctx, this.master);
    this.music.start();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
  }

  private freq(step: number) {
    const oct = Math.floor(step / 5);
    return BASE * Math.pow(2, (PENTA[((step % 5) + 5) % 5] + 12 * oct) / 12);
  }

  private tone(f: number, type: OscillatorType, dur: number, vol: number, when = 0, slideTo?: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(dur: number, vol: number, freq: number, when = 0, q = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur);
  }

  /** La hauteur monte avec chaque brique du Lancer : le son de l'addiction. */
  brick(n: number) {
    const f = this.freq(Math.min(n, 22) + 5);
    this.tone(f, 'square', 0.12, 0.08);
    this.tone(f * 2, 'triangle', 0.18, 0.1);
    this.hiss(0.05, 0.15, 3000, 0, 0.8);
  }
  paddle(rebounds: number) {
    this.tone(140, 'sine', 0.18, 0.35, 0, 60);
    this.tone(this.freq(rebounds), 'triangle', 0.15, 0.08);
  }
  wall() {
    this.tone(1200, 'square', 0.03, 0.03);
  }
  launch() {
    this.hiss(0.25, 0.12, 1200, 0, 0.6);
    this.tone(300, 'sine', 0.2, 0.1, 0, 700);
  }
  figure(rank: number) {
    [0, 2, 4].forEach((s, i) => this.tone(this.freq(rank * 2 + s + 8), 'square', 0.25, 0.06, i * 0.05));
    this.hiss(0.3, 0.1, 6000, 0, 0.5);
  }
  armed() {
    this.tone(880, 'sine', 0.06, 0.05);
  }
  /** Étape du décompte : jetons en bleu (plus grave), mult en rouge (plus aigu). */
  step(i: number, kind: 'chips' | 'mult' | 'xmult') {
    const base = kind === 'chips' ? 5 : kind === 'mult' ? 8 : 11;
    const f = this.freq(base + i);
    this.tone(f, kind === 'xmult' ? 'sawtooth' : 'square', 0.14, kind === 'xmult' ? 0.07 : 0.06);
    this.tone(f * 1.5, 'triangle', 0.1, 0.06);
    this.hiss(0.04, 0.2, 2500);
  }
  cashIn(power: number) {
    const p = Math.min(1, power);
    this.tone(90, 'sine', 0.6 + p * 0.4, 0.6, 0, 35);
    this.hiss(0.5 + p * 0.5, 0.3, 800, 0, 0.4);
    [0, 2, 4, 5].forEach((s, i) => this.tone(this.freq(10 + s), 'square', 0.5, 0.05, 0.03 * i));
  }
  lost() {
    this.tone(400, 'sawtooth', 0.6, 0.12, 0, 60);
    this.tone(300, 'square', 0.5, 0.06, 0.05, 50);
    this.hiss(0.6, 0.2, 400, 0, 0.5);
  }
  win() {
    [0, 2, 4, 5, 7, 10].forEach((s, i) => this.tone(this.freq(8 + s), 'square', 0.3, 0.06, i * 0.08));
  }
  click() {
    this.tone(660, 'triangle', 0.05, 0.08);
  }
  error() {
    this.tone(180, 'square', 0.12, 0.08);
    this.tone(140, 'square', 0.15, 0.08, 0.08);
  }
  coin() {
    this.tone(1320, 'square', 0.06, 0.05);
    this.tone(1760, 'square', 0.12, 0.05, 0.05);
  }
  boom() {
    this.tone(70, 'sine', 0.5, 0.6, 0, 30);
    this.hiss(0.5, 0.45, 500, 0, 0.4);
  }
  clang() {
    this.tone(900, 'square', 0.08, 0.06);
    this.tone(1350, 'triangle', 0.25, 0.08);
  }
  glass() {
    for (let i = 0; i < 5; i++) this.tone(2000 + Math.random() * 2500, 'triangle', 0.15, 0.05, i * 0.03);
    this.hiss(0.3, 0.2, 7000, 0, 1);
  }
  shuffle() {
    for (let i = 0; i < 6; i++) this.hiss(0.05, 0.15, 1500 + i * 300, i * 0.04, 2);
  }
  rune() {
    [0, 3, 5, 8].forEach((s, i) => this.tone(this.freq(s + 6), 'sine', 0.4, 0.07, i * 0.06));
  }
}
