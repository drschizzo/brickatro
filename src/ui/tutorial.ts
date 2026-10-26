import { BRICK_CSS } from '../render/palette';
import { rich } from '../rules/text';

/**
 * Tutoriel animé : 6 mini-scènes en CSS pur (aucun rendu 3D), une par notion.
 * On montre les commandes et le cœur de la boucle ; le reste (Reliques, Prouesses…)
 * n'est qu'évoqué : le joueur doit le découvrir lui-même.
 */
export interface TutoStep {
  title: string;
  /** Durée d'une boucle de l'animation. */
  dur: number;
  scene: string;
  text: string;
}

/** Libellé de commande selon l'appareil (body.touch bascule l'affichage). */
const k = (desk: string, touch: string) => `<span class="k-desk">${desk}</span><span class="k-touch">${touch}</span>`;
const kbd = (s: string) => `<kbd>${s}</kbd>`;

/** Images clés générées : [pourcentage, déclarations]. */
const kf = (name: string, frames: [number, string][]) => `@keyframes ${name}{${frames.map(([p, s]) => `${p}%{${s}}`).join('')}}`;
const at = (x: number, y: number) => `left:${x}cqw;top:${y}cqh`;
const show = (from: number, to: number, end = 100): [number, string][] => [
  [0, 'opacity:0'], [Math.max(0, from - 0.1), 'opacity:0'], [from, 'opacity:1'], [to, 'opacity:1'], [Math.min(end, to + 0.1), 'opacity:0'], [100, 'opacity:0'],
];
const brick = (value: number, color: number, cls = '', style = '') =>
  `<div class="t-brick ${cls}" style="--bc:${BRICK_CSS[color]};${style}"><b>${value}</b></div>`;
const holdChip = (anim: string) => `<div class="t-hold" style="animation-name:${anim}">${k('Clic', 'LANCER')}</div>`;

// ───────── 1. Viser et lancer ─────────
const s1 = `
<div class="tscene">
  <div class="t-row" style="top:10cqh">${[3, 8, 5, 1, 9].map((v, i) => brick(v, i % 4)).join('')}</div>
  <div class="t-paddle" style="left:50cqw"></div>
  <div class="t-pivot" style="${at(50, 82)};animation-name:t1rot">
    <div class="t-guide" style="animation-name:t1guide"></div>
    <div class="t-ball t-inpivot" style="animation-name:t1ball"></div>
  </div>
  ${holdChip('t1hold')}
  <div class="t-cap" style="animation-name:t1c1">Maintiens : vise</div>
  <div class="t-cap" style="animation-name:t1c2">Relâche : lance !</div>
</div>
<style>
${kf('t1rot', [[0, 'transform:rotate(-34deg)'], [25, 'transform:rotate(26deg)'], [42, 'transform:rotate(-6deg)'], [55, 'transform:rotate(14deg)'], [100, 'transform:rotate(14deg)']])}
${kf('t1guide', [[0, 'opacity:1'], [55, 'opacity:1'], [58, 'opacity:0'], [100, 'opacity:0']])}
${kf('t1ball', [[0, 'transform:translate(-50%,-50%)'], [57, 'transform:translate(-50%,-50%);opacity:1'], [82, 'transform:translate(-50%,-50%) translateY(-74cqh);opacity:1'], [84, 'transform:translate(-50%,-50%) translateY(-74cqh);opacity:0'], [100, 'opacity:0']])}
${kf('t1hold', [[0, ''], [2, 'background:rgba(79,215,255,.35);box-shadow:0 0 18px #4fd7ff;color:#fff'], [55, 'background:rgba(79,215,255,.35);box-shadow:0 0 18px #4fd7ff;color:#fff'], [57, ''], [100, '']])}
${kf('t1c1', show(2, 55))}
${kf('t1c2', show(57, 84))}
</style>`;

// ───────── 2. La Main : une carte par renvoi ─────────
// Deux trajets. Au 1er, le 7 et le 3 cassent : le 7 (meilleur) attend en pointillés, le 3 devient un Éclat.
// Au 2e, le 9 passe devant… puis le 7 vert fait une Paire et le remplace. Au retour sur la raquette, la brique en attente entre.
// La trajectoire est calculée (rebonds sur les bords des briques, le plafond et les murs) : la balle ne tourne jamais dans le vide.
const hits: { x: number; y: number; v: number; c: number; t: number }[] = [
  { x: 14, y: 16, v: 7, c: 0, t: 15.2 },
  { x: 50, y: 32, v: 3, c: 1, t: 25.6 },
  { x: 70, y: 16, v: 9, c: 2, t: 56 },
  { x: 86, y: 32, v: 7, c: 3, t: 64.2 },
];
const RENVOI = [36.1, 76];
const path: [number, number, number][] = [
  [0, 50, 80.8], [15.2, 22.5, 15.6], [18, 27.7, 3.2], [25.6, 41.5, 35.9], [RENVOI[0], 22.6, 80.8],
  [54.8, 59.1, 3.2], [56, 61.5, 8.3], [57.3, 63.9, 3.2], [64.2, 77.5, 32], [RENVOI[1], 54.5, 80.8], [96, 54.5, 80.8], [100, 50, 80.8],
];
/** La raquette va se placer sous la balle avant qu'elle redescende. */
const paddle: [number, string][] = [[0, 'left:50cqw'], [20, 'left:50cqw'], [32, 'left:22.6cqw'], [58, 'left:22.6cqw'], [70, 'left:54.5cqw'], [96, 'left:54.5cqw'], [100, 'left:50cqw']];
/** Brique de la Main : apparaît en pointillés à `from`, se fige au retour sur la raquette `fix` (ou disparaît à `gone`, remplacée). */
const pending = (from: number, fix: number | null, gone: number | null): [number, string][] => {
  const dash = 'opacity:1;transform:scale(1);outline:2px dashed #fff;outline-offset:2px';
  const f: [number, string][] = [[0, 'opacity:0;transform:scale(.3)'], [from - 0.1, 'opacity:0;transform:scale(.3)'], [from + 3, dash]];
  if (gone !== null) return [...f, [gone - 0.1, dash], [gone, 'opacity:0'], [100, 'opacity:0']];
  return [...f, [fix! - 0.1, dash], [fix!, 'opacity:1;transform:scale(1.2);outline:none'], [fix! + 4, 'opacity:1;transform:scale(1);outline:none'], [93, 'opacity:1;outline:none'], [97, 'opacity:0'], [100, 'opacity:0']];
};
const pop = (h: { x: number; y: number }, text: string, cls: string, anim: string) => `<div class="t-pop ${cls}" style="${at(h.x, h.y - 11)};animation-name:${anim}">${text}</div>`;
const s2 = `
<div class="tscene">
  ${hits.map((h, i) => brick(h.v, h.c, 't-abs', `${at(h.x, h.y)};animation-name:t2b${i}`)).join('')}
  ${pop(hits[0], '→ Main', 'gold', 't2p0')}${pop(hits[1], 'éclat', '', 't2p1')}${pop(hits[2], '→ Main', 'gold', 't2p2')}${pop(hits[2], 'éclat', '', 't2p3')}${pop(hits[3], '→ Main', 'gold', 't2p4')}
  <div class="t-paddle" style="animation-name:t2pad"></div>
  <div class="t-ball" style="animation-name:t2ball"></div>
  <div class="t-badge"><span style="animation-name:t2e1">Éclats ×1</span><span style="animation-name:t2e2">Éclats ×2</span></div>
  <div class="t-cap" style="animation-name:t2c1">Raquette : la meilleure entre</div>
  <div class="t-cap" style="animation-name:t2c2">Mieux ? Elle la remplace</div>
</div>
<div class="t-hand">
  <div class="t-slot">${brick(7, 0, '', 'animation-name:t2s0')}</div>
  <div class="t-slot t-stack">${brick(9, 2, '', 'animation-name:t2s1')}${brick(7, 3, '', 'animation-name:t2s2')}</div>
  ${'<div class="t-slot"></div>'.repeat(3)}
</div>
<div class="t-fig">
  <span style="animation-name:t2f0">Brique haute</span><span class="gold" style="animation-name:t2f1">Paire</span>
</div>
<style>
${hits.map((h, i) => kf(`t2b${i}`, [[0, 'opacity:1;transform:translate(-50%,-50%)'], [h.t - 0.5, 'opacity:1;transform:translate(-50%,-50%);filter:none'], [h.t, 'filter:brightness(2.4);transform:translate(-50%,-50%) scale(1.25)'], [h.t + 4, 'opacity:0;transform:translate(-50%,-50%) scale(1.6)'], [96, 'opacity:0;transform:translate(-50%,-50%) scale(.6)'], [100, 'opacity:1;transform:translate(-50%,-50%)']])).join('')}
${kf('t2ball', path.map(([p, x, y]) => [p, at(x, y)]))}
${kf('t2pad', paddle)}
${kf('t2s0', pending(hits[0].t, RENVOI[0], null))}
${kf('t2s1', pending(hits[2].t, null, hits[3].t))}
${kf('t2s2', pending(hits[3].t, RENVOI[1], null))}
${kf('t2p0', show(hits[0].t, RENVOI[0]))}
${kf('t2p1', show(hits[1].t, RENVOI[0]))}
${kf('t2p2', show(hits[2].t, hits[3].t))}
${kf('t2p3', show(hits[3].t, RENVOI[1]))}
${kf('t2p4', show(hits[3].t, RENVOI[1]))}
${kf('t2e1', show(hits[1].t, hits[3].t))}
${kf('t2e2', show(hits[3].t, 95))}
${kf('t2c1', show(RENVOI[0], 52))}
${kf('t2c2', show(hits[3].t, 92))}
${kf('t2f0', show(hits[0].t, hits[3].t))}
${kf('t2f1', show(hits[3].t, 95))}
</style>`;

// ───────── 3. Le renvoi et la Série ─────────
const s3 = `
<div class="tscene">
  <div class="t-slow" style="animation-name:t3slow"></div>
  <div class="t-paddle" style="animation-name:t3pad"></div>
  <div class="t-pivot" style="${at(56, 82)};animation-name:t3rot">
    <div class="t-guide gold" style="animation-name:t3guide"></div>
  </div>
  <div class="t-ball" style="animation-name:t3ball"></div>
  <div class="t-cap" style="animation-name:t3c1">Ralenti : cale-toi dessous</div>
  <div class="t-cap" style="animation-name:t3c2">Oriente le renvoi</div>
  <div class="t-badge"><span style="animation-name:t3x0">Série ×1</span><span class="hot" style="animation-name:t3x1">Série ×1.2</span></div>
</div>
<style>
${kf('t3ball', [[0, at(14, 4)], [24, at(42, 56)], [62, at(56, 79)], [64, at(56, 79)], [86, at(74, 18)], [88, `${at(74, 18)};opacity:0`], [100, `${at(14, 4)};opacity:0`]])}
${kf('t3pad', [[0, 'left:26cqw'], [24, 'left:30cqw'], [30, 'left:56cqw'], [100, 'left:56cqw']])}
${kf('t3slow', show(24, 63))}
${kf('t3rot', [[0, 'transform:rotate(-10deg)'], [32, 'transform:rotate(-10deg)'], [44, 'transform:rotate(-30deg)'], [62, 'transform:rotate(25deg)'], [100, 'transform:rotate(25deg)']])}
${kf('t3guide', show(30, 63))}
${kf('t3c1', show(24, 42))}
${kf('t3c2', show(42, 63))}
${kf('t3x0', show(0, 63))}
${kf('t3x1', [[0, 'opacity:0'], [63.9, 'opacity:0;transform:scale(1)'], [64, 'opacity:1;transform:scale(1.5)'], [70, 'opacity:1;transform:scale(1)'], [97, 'opacity:1'], [100, 'opacity:0']])}
</style>`;

// ───────── 4. Encaisser (ou tout perdre) ─────────
const s4 = `
<div class="tscene">
  <div class="t-goal"><i style="animation-name:t4bar"></i><span>Objectif du Mur</span></div>
  <div class="t-paddle" style="animation-name:t4pad"></div>
  <div class="t-ball" style="animation-name:t4ball"></div>
  <div class="t-pot" style="animation-name:t4pot"><b class="c">48</b> × <b class="m">6</b></div>
  <div class="t-lost" style="animation-name:t4lost">MAIN PERDUE</div>
  ${holdChip('t4hold')}
  <div class="t-cap" style="animation-name:t4c1">Maintiens : encaisse !</div>
  <div class="t-cap" style="animation-name:t4c2">Un rebond de trop…</div>
</div>
<style>
${kf('t4ball', [[0, at(30, 6)], [22, at(50, 79)], [40, at(50, 79)], [41, `${at(50, 79)};opacity:0`], [52, `${at(70, 6)};opacity:0`], [53, `${at(70, 6)};opacity:1`], [76, at(58, 106)], [100, at(58, 106)]])}
${kf('t4pad', [[0, 'left:50cqw'], [52, 'left:50cqw'], [80, 'left:22cqw'], [100, 'left:22cqw']])}
${kf('t4hold', [[0, ''], [8, ''], [9, 'background:rgba(79,215,255,.35);box-shadow:0 0 18px #4fd7ff;color:#fff'], [40, 'background:rgba(79,215,255,.35);box-shadow:0 0 18px #4fd7ff;color:#fff'], [41, ''], [100, '']])}
${kf('t4pot', [[0, `opacity:0;${at(50, 64)};transform:translate(-50%,-50%) scale(.4)`], [22, `opacity:0;${at(50, 64)};transform:translate(-50%,-50%) scale(.4)`], [25, `opacity:1;${at(50, 64)};transform:translate(-50%,-50%) scale(1.2)`], [33, `opacity:1;${at(50, 64)};transform:translate(-50%,-50%) scale(1)`], [41, `opacity:.9;${at(30, 7)};transform:translate(-50%,-50%) scale(.6)`], [42, 'opacity:0'], [100, 'opacity:0']])}
${kf('t4bar', [[0, 'width:18%'], [41, 'width:18%'], [44, 'width:62%'], [97, 'width:62%'], [100, 'width:18%']])}
${kf('t4lost', [[0, 'opacity:0'], [75, 'opacity:0;transform:translate(-50%,-50%) scale(.6)'], [78, 'opacity:1;transform:translate(-50%,-50%) scale(1.15)'], [82, 'opacity:1;transform:translate(-50%,-50%) scale(1)'], [96, 'opacity:1'], [100, 'opacity:0']])}
${kf('t4c1', show(9, 41))}
${kf('t4c2', show(53, 75))}
</style>`;

// ───────── 5. La Secousse ─────────
const s5 = `
<div class="tscene">
  <div class="t-paddle" style="left:40cqw"></div>
  <div class="t-ring" style="animation-name:t5ring"></div>
  <div class="t-ball" style="animation-name:t5ball"></div>
  <div class="t-hold big" style="animation-name:t5key">${k('S', 'SECOUSSE')}</div>
  <div class="t-cap" style="animation-name:t5c1">Trop tard ?</div>
  <div class="t-save" style="animation-name:t5save">SAUVÉE !</div>
</div>
<style>
${kf('t5ball', [[0, at(20, 6)], [30, at(54, 80)], [40, at(57, 88)], [60, at(58, 91)], [61, at(58, 91)], [84, at(36, 10)], [86, `${at(36, 10)};opacity:0`], [100, `${at(20, 6)};opacity:0`]])}
${kf('t5key', [[0, ''], [57, ''], [58, 'background:rgba(255,154,90,.45);box-shadow:0 0 22px #ff9a5a;color:#fff;transform:scale(1.15)'], [70, 'background:rgba(255,154,90,.45);box-shadow:0 0 22px #ff9a5a;color:#fff'], [72, ''], [100, '']])}
${kf('t5ring', [[0, `opacity:0;${at(58, 91)}`], [60, `opacity:0;${at(58, 91)};transform:translate(-50%,-50%) scale(.2)`], [61, 'opacity:1'], [74, `opacity:0;${at(58, 91)};transform:translate(-50%,-50%) scale(3)`], [100, 'opacity:0']])}
${kf('t5c1', show(32, 58))}
${kf('t5save', [[0, 'opacity:0'], [60, 'opacity:0;transform:translate(-50%,-50%) scale(.5)'], [63, 'opacity:1;transform:translate(-50%,-50%) scale(1.2)'], [68, 'opacity:1;transform:translate(-50%,-50%) scale(1)'], [88, 'opacity:1'], [92, 'opacity:0']])}
</style>`;

// ───────── 6. Tout le reste… ─────────
const s6 = `
<div class="tscene">
  <div class="t-cards">
    ${[0, 1, 2].map((i) => `<div class="t-card" style="animation-name:t6c${i}"><b>?</b></div>`).join('<div class="t-link" style="animation-name:t6l"></div>')}
  </div>
  <div class="t-boom">
    <span style="animation-name:t6n0">1 240</span><span style="animation-name:t6n1">4 960</span><span class="gold" style="animation-name:t6n2">39 680</span>
  </div>
</div>
<div class="t-tags">${['Reliques', 'Runes', 'Astres', 'Outils', 'Balles', 'Prouesses', 'Boss'].map((t) => `<span class="tag">${t}</span>`).join('')}</div>
<style>
${[0, 1, 2].map((i) => kf(`t6c${i}`, [[0, 'transform:rotateY(90deg)'], [6 + i * 8, 'transform:rotateY(90deg)'], [12 + i * 8, 'transform:rotateY(0)'], [100, 'transform:rotateY(0)']])).join('')}
${kf('t6l', [[0, 'opacity:0'], [40, 'opacity:0;transform:scaleX(0)'], [46, 'opacity:1;transform:scaleX(1)'], [94, 'opacity:1'], [100, 'opacity:0']])}
${kf('t6n0', show(30, 46))}
${kf('t6n1', show(46, 58))}
${kf('t6n2', [[0, 'opacity:0'], [58, 'opacity:0;transform:scale(.6)'], [62, 'opacity:1;transform:scale(1.35)'], [68, 'opacity:1;transform:scale(1)'], [94, 'opacity:1'], [100, 'opacity:0']])}
</style>`;

export const TUTO_STEPS: TutoStep[] = [
  {
    title: 'Viser et lancer',
    dur: 4.6,
    scene: s1,
    text: `${k(`<b>Maintiens</b> ${kbd('Clic')} ou ${kbd('Espace')} : la raquette se fige et tu vises avec la souris (ou ${kbd('←')} ${kbd('→')}). <b>Relâche</b> pour lancer.`, `<b>Maintiens</b> le bouton ${kbd('LANCER')} et <b>glisse</b> le doigt dessus pour viser. <b>Relâche</b> pour lancer.`)}<br>
      ${k('Le reste du temps, la raquette suit ta souris.', 'Le reste du temps, glisse n\'importe où sur l\'écran pour déplacer la raquette.')}`,
  },
  {
    title: 'Ta Main',
    dur: 8.5,
    scene: s2,
    text: rich(`<b>Chaque fois que la balle revient sur ta raquette</b>, la <b>meilleure brique</b> cassée depuis le rebond précédent rejoint ta <b>Main</b> (5 places). Tant que la balle est en l'air, elle attend en pointillés : une meilleure peut encore la remplacer. Les autres briques cassées sont des <b>Éclats</b> : des {c}Jetons{/} en plus. Comme au poker, valeurs et couleurs forment des <b>Figures</b> : Paire, Brelan, Suite, Couleur…<br>
      La Figure donne des {c}Jetons{/} et du {m}Mult{/} : {c}Jetons{/} × {m}Mult{/} = ton <b>Pot</b>.`),
  },
  {
    title: 'Le renvoi',
    dur: 5.4,
    scene: s3,
    text: `Quand la balle redescend, le temps ralentit : place-toi <b>sous la balle</b>, la raquette se verrouille et tes mouvements orientent finement le renvoi (<b class="t-g">ligne dorée</b>).<br>
      Chaque renvoi fait monter la <b>Série</b>, qui multiplie ton Pot.`,
  },
  {
    title: 'Encaisser',
    dur: 7.2,
    scene: s4,
    text: `${k(`<b>Maintiens</b> ${kbd('Clic')} / ${kbd('Espace')}`, `<b>Maintiens</b> le bouton`)} quand la balle arrive : tu l'<b>attrapes</b> et le Pot s'ajoute au score. Laisse-la rebondir pour faire grossir la Main… mais <b class="t-m">balle perdue = Main perdue</b>.<br>
      Atteins l'<b class="t-g">objectif</b> du Mur avant d'avoir épuisé tes Lancers.`,
  },
  {
    title: 'La Secousse',
    dur: 5,
    scene: s5,
    text: `${k(kbd('S'), `Le bouton ${kbd('SECOUSSE')}`)} pousse la balle vers la raquette. Si elle est déjà passée dessous, elle <b>remonte</b> : la Main est sauvée, mais la Série retombe à zéro.<br>
      Elles sont comptées. Et deux dans le même trajet, c'est le <b class="t-m">TILT</b>.`,
  },
  {
    title: 'Et ensuite ?',
    dur: 6,
    scene: s6,
    text: `Entre deux Murs, une boutique. Certaines Reliques s'ignorent, d'autres <b>se répondent</b> — bien associées, elles font exploser le score. Quelques coups d'adresse rapportent aussi plus qu'ils n'en ont l'air.<br>
      Lesquels ? <b class="t-g">À toi de le découvrir.</b> 8 Antes, un Boss au bout de chacune. Bonne chance.`,
  },
];
