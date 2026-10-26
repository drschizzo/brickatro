# Banc de simulation Brickatro

Des bots jouent des runs complets avec **le vrai moteur du jeu** (`src/engine/engine.ts` + `src/sim/world.ts`, sans rendu).
Toute modification des règles, Reliques, Boss ou motifs est donc testée telle quelle.

## Lancer

```bash
npm run bench -- --runs 300 --skill moyen --shop greedy
```

| Option | Valeurs | Défaut |
|---|---|---|
| `--runs` | nombre de runs | 120 |
| `--skill` | `debutant`, `moyen`, `expert`, `parfait` | `moyen` |
| `--shop` | `none` (n'achète rien), `random`, `greedy` (évalue chaque article sur ses mains jouées) | `greedy` |
| `--deck` / `--stake` | id de deck (`rouge`, `bleu`…) / Mise 0-4 | `rouge` / 0 |
| `--risk` | marge exigée pour continuer plutôt qu'encaisser | 0.15 |
| `--assist` | visée assistée en degrés | valeur du jeu (4,5°) |
| `--seed` / `--workers` | graine de départ / nombre de threads | 1 / CPU−1 |
| `--wall` / `--order` / `--lookahead` | pose des briques : `random`, `sorted`, `veins` (rangées), `blocks` (blocs 2×3 / 2×2), `mixed` (blocs puis rangées) · part de Filons 0-1 · cartes examinées pour remplir un Filon | valeur du jeu (`veins`, 0,6, 20) |
| `--sweep-wall` | compare random / veins / blocks / mixed à 0,6 et 1 (`--deep` : profondeur de pioche 12 / 20 / 30) | |
| `--relic` / `--gift` | Reliques données au départ (`pinceau,monomane`) · Rune offerte au début de chaque Mur (`r-mult`) | |
| `--tool` / `--no-tools` | Outils donnés au départ (`echange,trait`) · le bot n'achète aucun Outil | |
| `--greedy` / `--plan-discount` | bot glouton (1 tir d'avance, l'ancien bot) · décote par brique planifiée | planifié, 0,8 |
| `--classic` | règles d'origine (Main = 5 meilleures briques, Filons, économie d'origine) au lieu des règles **v3** | v3 |
| `--head` / `--no-head` / `--head-mode` | une carte par trajet ; valeur = Jetons d'un Éclat en part de la valeur de la brique · `first` (1re brique touchée) ou `best` (meilleure du trajet) | v3 : best, 0,5 |
| `--short` / `--jokers N` / `--orders` / `--tight` (et `--no-…`) | Suite et Couleur à 4 · Jokers sur le front du mur · Commandes · économie resserrée | v3 : tout actif, 1 Joker |
| `--target-mul` | échelle supplémentaire des objectifs | 1 |
| `--no-atelier` / `--atelier-reserve N` / `--atelier-free` | le bot n'utilise pas l'Atelier · argent gardé avant d'y dépenser · services remboursés (plafond de ce qu'il apporte) | réserve 15 |
| `--naive` | le bot vise une brique atteignable au hasard (joueur « casse-briques » qui ignore la Main) : l'écart avec le bot normal mesure ce que vaut le jeu de la Main | |
| `--compare` | tableau skill × boutique | |
| `--sweep-assist` | compare 0 / 4 / 8 / 12° d'assistance | |

Les données brutes de chaque run sont écrites dans `bench/out/*.json`.

## Modèle du joueur (`bench/bot.ts`)

- **Adresse** : à l'entrée du ralenti, le bot est sous la balle sauf avec une probabilité `late` (qui croît avec la vitesse²).
  - S'il est à portée, la raquette se verrouille et il vise l'angle voulu avec une erreur `angleSigma` (en degrés).
  - S'il est en retard, il perd la balle avec la probabilité `lose`, sinon il renvoie avec une erreur de placement `aimSigma`.
- **Choix du tir** : il teste tous les angles (pas de 1°) avec le guide de visée. Pour chaque brique atteignable, il calcule le score de la Main si elle est touchée.
- **Planification** (par défaut) : pour les 3 briques les plus prometteuses, il prolonge une chaîne de briques jusqu'à remplir la Main (voisines de rangée à 2 cases, brique dégagée au-dessus, autres briques atteignables ; faisceau de 2). Chaque brique en plus est décotée de ×0,8. Il vise la meilleure valeur planifiée, et la compare à la Main actuelle pour décider d'encaisser. Coût : environ +15 % de temps par rapport au bot glouton (`--greedy`).
- **Série** : en décidant avant un renvoi, il compte le cran de Série en plus (×Mult) dans la valeur de continuer.
- **Encaisser** : il continue si le meilleur tir rapporte plus de `(1 + risk)` fois la Main actuelle, sinon il attrape.
- **Boutique (greedy)** : il rejoue ses 40 dernières mains avec chaque Relique candidate, à chaque position, et achète le meilleur gain par $. Il remplace la Relique la plus faible quand il n'a plus de place, puis cherche le meilleur ordre de ses Reliques.

## Règles v3 (défaut)

`RULESETS.v3` (`src/rules/ruleset.ts`) : à chaque renvoi (ou à l'encaissement), la meilleure brique cassée par la balle pendant le trajet entre dans la Main, les autres sont des Éclats (+Jetons) ; Suite et Couleur à 4 briques ; 1 Joker par pose de mur ; 2 Commandes par Mur ; Atelier en boutique (retirer une brique $2 +$1 toutes les 2, minimum 28 briques ; retailler ±1 $1 ; un de chaque par visite) ; économie resserrée (récompenses 2/3/4, pas de Démolition, 1 consommable et 1 pack en boutique, Lancer de secours) ; objectifs `ANTE_BASE_V3`. En jeu, `?classic` rejoue les règles d'origine.

## Lire le rapport

- **Progression** : à quelle Ante les runs meurent, et sur quel mur.
- **Score / objectif** : la marge par Ante. Proche de 1 = tendu, au-dessus de 1,5 = facile.
- **Boss / Motifs** : taux d'échec par rencontre, pour repérer ceux qui sont trop durs ou trop faciles.
- **Mains / Prouesses** : fréquence de chaque main et de chaque Prouesse dans les encaissements.
- **Précision** : part des renvois visés qui touchent vraiment la brique voulue.
- **Atteignabilité** : à chaque renvoi avec une Main entamée, y a-t-il sur le mur, et parmi les briques atteignables, une brique qui fait monter la Figure.
- **`--naive`** : l'écart de victoires entre le bot normal et le bot naïf mesure ce que rapporte le jeu de la Main (objectif : grand).
- **Reliques** : *impact* = progression moyenne des runs qui la possèdent en fin de partie, moins la moyenne générale. L'indicateur est bruité : il faut ≥ 300 runs et le lire comme une tendance.
- **Synergies** : paires dont la progression dépasse celle de la meilleure des deux Reliques seule (*lift*).

## Limites connues

- Chaque trajet casse environ 3 briques, dont une seule visée (les autres sont des ricochets). Même un tireur parfait ne tire que ~10 % de ses Mains d'au moins 3 briques d'un même Filon : le banc mesure donc mal l'intérêt des Filons horizontaux. La ligne « Mains tirées d'un même Filon » du rapport suit ce point.
- Le bot n'achète pas de Packs de Briques et n'oriente pas son deck vers les enchantements. Midas, Démolisseur et Artificier sont donc sous-évalués.
- Secousses : il ne s'en sert que pour sauver une balle passée sous la raquette (réussite `save` selon l'adresse : 40 / 70 / 90 / 100 %), jamais pour pousser la balle vers une brique. Sismographe est donc sous-évalué.
- Il ne passe jamais de mur (bouton « Passer le mur » de la boutique).
- Atelier : politique simple (retire la valeur la moins fournie, retaille vers un groupe de 4), sans viser ses Figures, couleurs ni Commandes. Même gratuit il n'apporte que +5 pts ; payé, il coûte au bot plus en intérêts et Reliques qu'il ne rapporte, d'où une réserve de $15 par défaut. Sa valeur pour un humain se juge à la main.
- L'impact des Reliques est confondu avec le moment de l'achat : une Relique achetée tard dans un bon run paraît forte.
