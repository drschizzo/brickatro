import { BOSSES } from '../src/rules/bosses';
import { FIGURE_BY_ID, type FigureId } from '../src/rules/figures';
import { LAYOUT_BY_ID } from '../src/rules/layouts';
import { PROWESS, type ProwessId } from '../src/rules/prowess';
import { RELIC_BY_ID } from '../src/rules/relics';
import type { BotConfig, RunRecord } from './bot';

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : '—');
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(0)}k` : `${Math.round(n)}`);
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);
/** "Progression" d'un run : Ante + fraction du mur atteint (pour comparer finement). */
const progress = (r: RunRecord) => r.ante + r.wallIdx / 3 + (r.won ? 0.34 : 0);

export function accuracy(recs: RunRecord[]) {
  const w = recs.flatMap((r) => r.walls);
  const shots = w.reduce((s, x) => s + x.shots, 0);
  return shots ? w.reduce((s, x) => s + x.hits, 0) / shots : 0;
}

export function compareLine(label: string, recs: RunRecord[]) {
  const antes = recs.map((r) => r.ante);
  const deaths = new Map<string, number>();
  recs.filter((r) => !r.won).forEach((r) => deaths.set(r.diedAt, (deaths.get(r.diedAt) ?? 0) + 1));
  const top = [...deaths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} (${pct(v, recs.length)})`).join(', ');
  return `${label}  ${lpad(mean(antes).toFixed(2), 8)}  ${lpad(median(antes), 8)}  ${lpad(pct(recs.filter((r) => r.won).length, recs.length), 9)}  ${lpad((accuracy(recs) * 100).toFixed(0) + '%', 9)}  ${top}`;
}

const FIG_ORDER: FigureId[] = ['haute', 'paire', 'doublepaire', 'brelan', 'suite', 'couleur', 'full', 'carre', 'quinteflush'];
const FIG_SHORT: Record<FigureId, string> = {
  haute: 'Haute', paire: 'Paire', doublepaire: '2Paires', brelan: 'Brelan', suite: 'Suite', couleur: 'Couleur', full: 'Full', carre: 'Carré', quinteflush: 'QFlush',
};

/** Part des Mains dont au moins 3 / 4 briques viennent d'un même Filon. */
export function veinLine(recs: RunRecord[]) {
  const cashes = recs.flatMap((r) => r.cashes);
  const p = (k: number) => pct(cashes.filter((c) => (c.veinMax ?? 0) >= k).length, cashes.length);
  return `même Filon ≥3 ${p(3)} · ≥4 ${p(4)}`;
}

/** Répartition des mains encaissées sur une ligne (+ part des mains ≥ Brelan). */
export function figureLine(recs: RunRecord[]) {
  const cashes = recs.flatMap((r) => r.cashes);
  const n = cashes.length || 1;
  const share = (f: FigureId) => cashes.filter((c) => c.figure === f).length / n;
  const strong = FIG_ORDER.slice(3).reduce((s, f) => s + share(f), 0);
  return `${FIG_ORDER.map((f) => `${FIG_SHORT[f]} ${(100 * share(f)).toFixed(0)}%`).join(' · ')}  │ ≥Brelan ${(100 * strong).toFixed(0)}%`;
}

export function report(recs: RunRecord[], cfg: BotConfig, seconds: number): string {
  const L: string[] = [];
  const h = (t: string) => L.push(`\n━━ ${t} ${'━'.repeat(Math.max(0, 60 - t.length))}`);
  const n = recs.length;
  const wins = recs.filter((r) => r.won).length;

  L.push(`\nBRICKATRO · banc de simulation`);
  L.push(`${n} runs · joueur ${cfg.skill.name} (σ angle ${cfg.skill.angleSigma}°, en retard ${cfg.skill.late}, σ course ${cfg.skill.aimSigma}) · boutique ${cfg.shop} · deck ${cfg.deck} · mise ${cfg.stake} · ${seconds.toFixed(0)}s`);

  // ── Progression
  h('Progression');
  L.push(`Victoires : ${wins}/${n} (${pct(wins, n)}) · Ante moyenne atteinte : ${mean(recs.map((r) => r.ante)).toFixed(2)} · médiane : ${median(recs.map((r) => r.ante))}`);
  const maxA = Math.max(...recs.map((r) => r.ante));
  for (let a = 1; a <= maxA; a++) {
    const reached = recs.filter((r) => r.ante >= a).length;
    const died = recs.filter((r) => !r.won && r.ante === a);
    const byWall = [0, 1, 2].map((w) => died.filter((r) => r.wallIdx === w).length);
    L.push(`Ante ${a} : atteinte ${lpad(pct(reached, n), 4)} · morts ${lpad(died.length, 3)} (petit ${byWall[0]}, grand ${byWall[1]}, boss ${byWall[2]})  ${'█'.repeat(Math.round((reached / n) * 30))}`);
  }

  // ── Marge de score : score obtenu / objectif, par Ante
  h('Score / objectif par Ante (médiane des murs)');
  for (let a = 1; a <= maxA; a++) {
    const walls = recs.flatMap((r) => r.walls).filter((w) => w.ante === a);
    if (!walls.length) continue;
    const ratio = walls.map((w) => w.score / w.target);
    const lanc = walls.filter((w) => w.won).map((w) => w.lancersUsed);
    L.push(`Ante ${a} : score/objectif médian ${median(ratio).toFixed(2)} · lancers utilisés (murs gagnés) ${mean(lanc).toFixed(1)} · murs perdus ${pct(walls.filter((w) => !w.won).length, walls.length)}`);
  }

  // ── Boss
  h('Boss : taux d\'échec');
  const bossRows = BOSSES.map((b) => {
    const enc = recs.flatMap((r) => r.walls).filter((w) => !!w.boss?.split('+').includes(b.id));
    return { b, enc: enc.length, lost: enc.filter((w) => !w.won).length, ratio: median(enc.map((w) => w.score / w.target)) };
  }).filter((x) => x.enc).sort((a, b) => b.lost / b.enc - a.lost / a.enc);
  for (const x of bossRows) L.push(`${pad(x.b.name, 16)} ${lpad(x.enc, 4)} rencontres · échec ${lpad(pct(x.lost, x.enc), 4)} · score/obj médian ${x.ratio.toFixed(2)}`);

  // ── Motifs
  h('Motifs de mur : difficulté');
  const layouts = new Map<string, { enc: number; lost: number; bricks: number[]; ratio: number[] }>();
  for (const w of recs.flatMap((r) => r.walls)) {
    const e = layouts.get(w.layout) ?? { enc: 0, lost: 0, bricks: [], ratio: [] };
    e.enc++;
    if (!w.won) e.lost++;
    e.bricks.push(w.bricks / Math.max(1, w.lancersUsed));
    e.ratio.push(w.score / w.target);
    layouts.set(w.layout, e);
  }
  [...layouts.entries()].sort((a, b) => b[1].lost / b[1].enc - a[1].lost / a[1].enc).forEach(([id, e]) =>
    L.push(`${pad(LAYOUT_BY_ID[id]?.name ?? id, 15)} ${lpad(e.enc, 4)} murs · échec ${lpad(pct(e.lost, e.enc), 4)} · briques/lancer ${mean(e.bricks).toFixed(1)} · score/obj ${median(e.ratio).toFixed(2)}`));

  // ── Mains et prouesses
  const cashes = recs.flatMap((r) => r.cashes);
  h(`Mains encaissées (${cashes.length})`);
  const figs = new Map<string, number[]>();
  for (const c of cashes) figs.set(c.figure ?? '-', [...(figs.get(c.figure ?? '-') ?? []), c.total]);
  [...figs.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([f, t]) =>
    L.push(`${pad(FIGURE_BY_ID[f as FigureId]?.name ?? f, 14)} ${lpad(pct(t.length, cashes.length), 4)} · score médian ${lpad(fmt(median(t)), 6)}`));
  const vm = (k: number) => pct(cashes.filter((c) => (c.veinMax ?? 0) >= k).length, cashes.length);
  L.push(`Mains tirées d'un même Filon : ≥2 briques ${vm(2)} · ≥3 ${vm(3)} · ≥4 ${vm(4)} · 5 ${vm(5)}`);
  const cm = (k: 'cards' | 'rebounds' | 'shards' | 'shardChips') => mean(cashes.map((c) => c[k] ?? 0)).toFixed(1);
  const wallCount = recs.reduce((n, r) => n + r.walls.length, 0);
  const ord = cashes.reduce((n, c) => n + (c.orders ?? 0), 0);
  if (ord) L.push(`Commandes remplies : ${(ord / wallCount).toFixed(2)} par mur (sur 2) · ${pct(cashes.filter((c) => c.orders).length, cashes.length)} des Mains`);
  L.push(`Par encaissement : ${cm('cards')} briques dans la Main · ${cm('rebounds')} renvois · ${cm('shards')} Éclats (+${cm('shardChips')} Jetons)`);
  h('Prouesses (part des encaissements où elles apparaissent)');
  const pw = new Map<string, number>();
  cashes.forEach((c) => new Set(c.prowess).forEach((p) => pw.set(p, (pw.get(p) ?? 0) + 1)));
  [...pw.entries()].sort((a, b) => b[1] - a[1]).forEach(([p, k]) => L.push(`${pad(PROWESS[p as ProwessId]?.name ?? p, 14)} ${pct(k, cashes.length)}`));

  // ── Lancers
  h('Lancers');
  const walls = recs.flatMap((r) => r.walls);
  const lancers = walls.reduce((s, w) => s + w.lancersUsed, 0);
  const lost = walls.reduce((s, w) => s + w.ballsLost, 0);
  L.push(`Balles perdues : ${pct(lost, lancers)} des lancers · briques par lancer ${mean(walls.map((w) => w.bricks / Math.max(1, w.lancersUsed))).toFixed(1)} · rebonds raquette par lancer ${mean(walls.map((w) => w.trips / Math.max(1, w.lancersUsed))).toFixed(1)}`);
  const shots = walls.reduce((s, w) => s + w.shots, 0);
  const hits = walls.reduce((s, w) => s + w.hits, 0);
  L.push(`Précision : ${pct(hits, shots)} des renvois visés touchent la brique voulue (${shots} tirs)`);
  const rs = recs.map((r) => r.reach).filter(Boolean) as NonNullable<RunRecord['reach']>[];
  const rsum = (k: keyof NonNullable<RunRecord['reach']>) => rs.reduce((s, r) => s + r[k], 0);
  if (rsum('decisions')) L.push(`Atteignabilité (renvois avec une Main entamée) : brique qui monte la Figure sur le mur ${pct(rsum('onWall'), rsum('decisions'))} · atteignable ${pct(rsum('reachable'), rsum('decisions'))} · ${(rsum('bricks') / rsum('decisions')).toFixed(1)} briques atteignables dont ${(rsum('usefulReach') / rsum('decisions')).toFixed(1)} utiles`);
  L.push(`Balles bloquées (timeout) : ${recs.reduce((s, r) => s + r.stuck, 0)} · Runes utilisées/run ${mean(recs.map((r) => r.runes)).toFixed(1)} · Astres/run ${mean(recs.map((r) => r.astres)).toFixed(1)} · Outils utilisés/run ${mean(recs.map((r) => r.tools)).toFixed(1)} · Sauvetages (Secousse)/run ${mean(recs.map((r) => r.saves ?? 0)).toFixed(1)}`);
  const owned = (id: string) => pct(recs.filter((r) => r.toolsOwned.includes(id)).length, recs.length);
  L.push(`Outils en fin de run : Pince ${owned('echange')} · Arbalète ${owned('trait')}`);
  const money = [1, 2, 3, 4, 5, 6, 7].map((a) => mean(recs.filter((r) => r.moneyByAnte[a] !== undefined).map((r) => r.moneyByAnte[a])));
  const resc = recs.reduce((n, r) => n + (r.rescues ?? 0), 0);
  const rem = recs.reduce((n, r) => n + (r.removed ?? 0), 0), ret = recs.reduce((n, r) => n + (r.retailed ?? 0), 0);
  if (rem || ret) L.push(`Atelier : ${(rem / recs.length).toFixed(1)} briques retirées et ${(ret / recs.length).toFixed(1)} retaillées par run`);
  const dis = recs.reduce((n, r) => n + (r.discards ?? 0), 0), disB = recs.reduce((n, r) => n + (r.discarded ?? 0), 0);
  const nWalls = recs.reduce((n, r) => n + r.walls.length, 0);
  if (dis) L.push(`Défausses : ${(dis / nWalls).toFixed(2)} par Mur, ${(disB / dis).toFixed(1)} briques chacune`);
  if (resc) L.push(`Lancers de secours achetés : ${(resc / recs.length).toFixed(2)} par run`);
  L.push(`Argent en fin d'Ante : ${money.map((m, i) => `A${i + 1} $${m.toFixed(0)}`).join(' · ')}`);

  // ── Reliques
  if (recs.some((r) => r.relicsEver.length)) {
    const base = mean(recs.map(progress));
    h('Reliques : impact (progression moyenne quand possédée en fin de run, vs moyenne globale)');
    L.push(`${pad('Relique', 18)} ${lpad('achats', 6)} ${lpad('fin', 5)} ${lpad('impact', 7)}  ${'victoires'}`);
    const rows = Object.keys(RELIC_BY_ID).map((id) => {
      const owned = recs.filter((r) => r.relics.includes(id));
      const bought = recs.filter((r) => r.relicsEver.some((x) => x.id === id)).length;
      return { id, bought, owned: owned.length, impact: owned.length ? mean(owned.map(progress)) - base : NaN, wins: owned.filter((r) => r.won).length };
    }).filter((x) => x.bought).sort((a, b) => (b.impact || -9) - (a.impact || -9));
    for (const x of rows) {
      L.push(`${pad(RELIC_BY_ID[x.id].name, 18)} ${lpad(x.bought, 6)} ${lpad(x.owned, 5)} ${lpad(Number.isNaN(x.impact) ? '—' : (x.impact >= 0 ? '+' : '') + x.impact.toFixed(2), 7)}  ${x.owned ? pct(x.wins, x.owned) : '—'}`);
    }
    const never = Object.keys(RELIC_BY_ID).filter((id) => !rows.some((r) => r.id === id));
    if (never.length) L.push(`Jamais achetées : ${never.map((id) => RELIC_BY_ID[id].name).join(', ')}`);

    // ── Synergies : paires dont la progression dépasse celle de chaque relique seule
    h('Synergies : paires les plus fortes (min 5 runs, "lift" = gain vs la meilleure des deux seules)');
    const single = new Map<string, number>();
    rows.forEach((x) => single.set(x.id, x.impact + base));
    const pairs = new Map<string, number[]>();
    for (const r of recs) {
      const rel = [...new Set(r.relics)].sort();
      for (let i = 0; i < rel.length; i++) for (let j = i + 1; j < rel.length; j++) {
        const k = `${rel[i]}+${rel[j]}`;
        pairs.set(k, [...(pairs.get(k) ?? []), progress(r)]);
      }
    }
    const pairRows = [...pairs.entries()].filter(([, v]) => v.length >= 5).map(([k, v]) => {
      const [a, b] = k.split('+');
      const m = mean(v);
      return { k, a, b, n: v.length, m, lift: m - Math.max(single.get(a) ?? base, single.get(b) ?? base) };
    }).sort((x, y) => y.lift - x.lift).slice(0, 10);
    for (const p of pairRows) L.push(`${pad(`${RELIC_BY_ID[p.a].name} + ${RELIC_BY_ID[p.b].name}`, 36)} ${lpad(p.n, 4)} runs · progression ${p.m.toFixed(2)} · lift ${p.lift >= 0 ? '+' : ''}${p.lift.toFixed(2)}`);
    if (!pairRows.length) L.push('Pas assez de données (augmente --runs).');
  }

  // ── Meilleurs runs
  h('Meilleures mains');
  const best = [...recs].sort((a, b) => b.bestHand - a.bestHand).slice(0, 3);
  for (const r of best) L.push(`seed ${r.seed} · ${fmt(r.bestHand)} · Ante ${r.ante}${r.won ? ' (victoire)' : ''} · ${r.relics.map((id) => RELIC_BY_ID[id].name).join(', ')}`);
  return L.join('\n');
}
