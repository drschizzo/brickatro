/**
 * Banc de simulation Brickatro.
 *   npm run bench -- --runs 200 --skill moyen --shop greedy
 * Options : --runs N  --skill debutant|moyen|expert|parfait  --shop none|random|greedy
 *           --deck rouge|bleu|…  --stake 0..4  --seed S  --workers K  --risk 0.15  --maxAnte 8
 *           --assist DEG (visée assistée)  --out bench/out/nom.json  --compare (skill × boutique)
 *           --wall random|sorted|veins  --order 0..1  --lookahead K (pose des briques)  --sweep-wall [--deep]
 *           --relic id,id (Reliques de départ)  --gift r-mult (Rune offerte à chaque Mur)
 *           --tool echange,trait (Outils de départ)  --no-tools (n'achète pas d'Outil)
 *           Jeu de règles v3 par défaut, --classic pour les règles d'origine. Surcharges :
 *           --head [0.5] / --no-head (une carte par trajet, Jetons par Éclat)  --head-mode first|best  --jokers N
 *           --short / --no-short (Suite/Couleur à 4)  --orders / --no-orders (Commandes)  --tight / --no-tight (économie)  --no-atelier
 *           --target-mul 0.6 (échelle des objectifs)  --naive (vise au hasard, sans chercher de Figure)
 *           --discards N / --no-discard (Défausses par Mur, 2 en v3)
 *           --greedy (bot sans planification)  --plan-discount 0.6 (décote par brique planifiée)
 */
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { Bot, SKILLS, type BotConfig, type RunRecord, type ShopPolicy } from './bot';
import { report, compareLine, figureLine, veinLine } from './report';
import type { WallStyle } from '../src/rules/veins';

interface Job { cfg: BotConfig; seeds: number[] }

if (!isMainThread) {
  const { cfg, seeds } = workerData as Job;
  for (const seed of seeds) {
    const rec = new Bot(cfg, seed).playRun();
    parentPort!.postMessage(rec);
  }
  parentPort!.postMessage('done');
} else {
  void main();
}

/** --x → true, --no-x → false, absent → undefined (valeur du jeu de règles). */
function flag(name: string): boolean | undefined {
  if (process.argv.includes(`--no-${name}`)) return false;
  if (process.argv.includes(`--${name}`)) return true;
  return undefined;
}

function arg(name: string, def: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}

async function runBatch(cfg: BotConfig, runs: number, seed0: number, workers: number, label: string): Promise<RunRecord[]> {
  const seeds = Array.from({ length: runs }, (_, i) => seed0 + i * 7919);
  const chunks: number[][] = Array.from({ length: workers }, () => []);
  seeds.forEach((s, i) => chunks[i % workers].push(s));
  const out: RunRecord[] = [];
  const t0 = Date.now();
  await Promise.all(chunks.filter((c) => c.length).map((chunk) => new Promise<void>((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { cfg, seeds: chunk } satisfies Job });
    w.on('message', (m) => {
      if (m === 'done') { void w.terminate(); resolve(); return; }
      out.push(m as RunRecord);
      if (process.stdout.isTTY) process.stdout.write(`\r  ${label} : ${out.length}/${runs} runs (${((Date.now() - t0) / 1000).toFixed(0)}s)   `);
    });
    w.on('error', reject);
  })));
  if (process.stdout.isTTY) process.stdout.write('\n');
  return out.sort((a, b) => a.seed - b.seed);
}

async function main() {
  const runs = Number(arg('runs', '120'));
  const workers = Math.max(1, Number(arg('workers', String(Math.max(1, cpus().length - 1)))));
  const seed0 = Number(arg('seed', '1'));
  const base: Omit<BotConfig, 'skill' | 'shop'> = {
    deck: arg('deck', 'rouge'), stake: Number(arg('stake', '0')), riskMargin: Number(arg('risk', '0.15')), maxAnte: Number(arg('maxAnte', '8')),
    assistDeg: process.argv.includes('--assist') ? Number(arg('assist', '8')) : null,
    wall: process.argv.includes('--wall') || process.argv.includes('--order')
      ? { style: arg('wall', 'veins') as WallStyle, order: Number(arg('order', '0.6')), lookahead: Number(arg('lookahead', '20')) } : null,
    relics: arg('relic', '') ? arg('relic', '').split(',') : undefined,
    gift: arg('gift', '') || undefined,
    tools: arg('tool', '') ? arg('tool', '').split(',') : undefined,
    noTools: process.argv.includes('--no-tools'),
    noAtelier: process.argv.includes('--no-atelier'),
    atelierFree: process.argv.includes('--atelier-free'),
    atelierReserve: process.argv.includes('--atelier-reserve') ? Number(arg('atelier-reserve', '12')) : undefined,
    plan: process.argv.includes('--greedy') ? null : { discount: Number(arg('plan-discount', '0.8')) },
    ruleset: process.argv.includes('--classic') ? 'classic' : 'v3',
    targetScale: process.argv.includes('--target-mul') ? Number(arg('target-mul', '1')) : undefined,
    naive: process.argv.includes('--naive'),
    jokers: process.argv.includes('--jokers') ? Number(arg('jokers', '1')) : undefined,
    discardEdge: process.argv.includes('--discard-edge') ? Number(arg('discard-edge', '1.5')) : undefined,
    discards: process.argv.includes('--no-discard') ? 0 : process.argv.includes('--discards') ? Number(arg('discards', '2')) : undefined,
    short: flag('short'),
    orders: flag('orders'),
    tight: flag('tight'),
    head: process.argv.includes('--no-head') ? null
      : process.argv.includes('--head') ? { shardRate: Number(arg('head', '0.5')), mode: (arg('head-mode', '') || undefined) as 'first' | 'best' | undefined } : undefined,
  };
  mkdirSync('bench/out', { recursive: true });

  if (process.argv.includes('--sweep-assist')) {
    console.log(`\nBalayage de la visée assistée (${runs} runs chacun, joueur ${arg('skill', 'moyen')})\n`);
    const rows: string[] = [];
    for (const deg of [0, 4, 8, 12]) {
      const recs = await runBatch({ ...base, assistDeg: deg, skill: SKILLS[arg('skill', 'moyen')], shop: 'greedy' }, runs, seed0, workers, `assist ${deg}°`);
      rows.push(compareLine(`assist ${String(deg).padEnd(3)}° greedy `, recs));
    }
    console.log(['réglage             ante moy  ante méd  victoires  précision  meurt souvent à', ...rows].join('\n'));
    return;
  }

  if (process.argv.includes('--sweep-wall')) {
    console.log(`\nPose des briques (${runs} runs chacun, joueur ${arg('skill', 'moyen')}, boutique greedy)\n`);
    const rows: string[] = [];
    const figs: string[] = [];
    const configs: [WallStyle, number, number][] = process.argv.includes('--deep')
      ? [['veins', 0.6, 12], ['veins', 0.6, 20], ['veins', 0.6, 30], ['veins', 1, 20], ['veins', 1, 30]]
      : [['random', 0, 20], ['veins', 0.6, 20], ['veins', 1, 20], ['blocks', 0.6, 20], ['blocks', 1, 20], ['mixed', 0.6, 20], ['mixed', 1, 20]];
    for (const [style, order, lookahead] of configs) {
      const label = `${style.padEnd(6)} ${style === "random" ? "   " : order.toFixed(1)}`;
      const recs = await runBatch({ ...base, wall: { style, order, lookahead }, skill: SKILLS[arg('skill', 'moyen')], shop: 'greedy' }, runs, seed0, workers, label);
      rows.push(compareLine(`${label}        `, recs));
      figs.push(`${label}  ${figureLine(recs)}  │ ${veinLine(recs)}`);
    }
    console.log(['pose                ante moy  ante méd  victoires  précision  meurt souvent à', ...rows].join('\n'));
    console.log(['\nMains encaissées (% des encaissements)', ...figs].join('\n'));
    return;
  }

  if (process.argv.includes('--compare')) {
    console.log(`\nComparaison skill × boutique (${runs} runs chacun, deck ${base.deck}, mise ${base.stake})\n`);
    const rows: string[] = [];
    for (const skill of ['debutant', 'moyen', 'expert']) {
      for (const shop of ['none', 'random', 'greedy'] as ShopPolicy[]) {
        const recs = await runBatch({ ...base, skill: SKILLS[skill], shop }, runs, seed0, workers, `${skill}/${shop}`);
        rows.push(compareLine(`${skill.padEnd(9)} ${shop.padEnd(7)}`, recs));
      }
    }
    console.log(['joueur    boutique  ante moy  ante méd  victoires  précision  meurt souvent à', ...rows].join('\n'));
    return;
  }

  const cfg: BotConfig = { ...base, skill: SKILLS[arg('skill', 'moyen')] ?? SKILLS.moyen, shop: arg('shop', 'greedy') as ShopPolicy };
  const t0 = Date.now();
  const recs = await runBatch(cfg, runs, seed0, workers, `${cfg.skill.name}/${cfg.shop}`);
  console.log(report(recs, cfg, (Date.now() - t0) / 1000));
  const out = arg('out', `bench/out/${cfg.skill.name}-${cfg.shop}-${cfg.deck}-s${cfg.stake}.json`);
  writeFileSync(out, JSON.stringify({ cfg, runs: recs }, null, 0));
  console.log(`\nDonnées brutes : ${out}`);
}
