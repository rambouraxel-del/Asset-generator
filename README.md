# Asset Generator — V0.2.3

Web-app de génération d'**assets graphiques cohérents pour jeu vidéo**, à partir
de l'API OpenAI GPT Image.

Vous définissez un ou plusieurs **Style Packs** (contexte graphique, images de
référence, catégories d'assets), puis vous décrivez l'asset voulu. L'application
envoie à OpenAI exactement :

```
Style Pack actif + règles de catégorie/dimensions + références actives + demande actuelle
```

…et rien d'autre.

## Aucune mémoire entre les générations

C'est la contrainte centrale du projet, garantie par construction :

- la route `/api/generate` est **totalement sans état** — aucune session, aucun
  cache, aucun historique, aucun fichier écrit entre deux appels ;
- l'endpoint `/v1/images` d'OpenAI est « one-shot » : contrairement à l'API
  Responses, il n'expose ni `conversation` ni `previous_response_id` ;
- tout ce qui part vers l'API passe par une seule fonction pure,
  [`buildGenerationRequest`](src/lib/generation/payload.ts), qui ne reçoit que
  les entrées autorisées ;
- « Régénérer » rejoue l'instantané d'origine à l'identique, sans transmettre le
  résultat précédent ;
- un asset **généré ou enregistré dans la bibliothèque ne devient jamais une
  référence**.

## Séparation stricte entrées / sorties

Les deux familles d'images ne peuvent pas être confondues, à trois niveaux :

| | `StyleReference` — ENTRÉE | `GeneratedAsset` — SORTIE |
| --- | --- | --- |
| Rôle | envoyée à OpenAI comme référentiel | résultat rangé dans la bibliothèque |
| Type | `kind: "style-reference"` | `kind: "generated-asset"` |
| Store IndexedDB | `styleReferences` | `generatedAssets` |
| Module d'accès | `storage/styleReferences.ts` | `storage/generatedAssets.ts` |

1. **Compilation** — le discriminant `kind` rend les deux types incompatibles.
2. **Stockage** — deux object stores, deux modules, aucun code ne lit les deux.
3. **Exécution** — `assertStyleReference` refuse tout objet qui n'est pas une
   référence de style, y compris relu depuis IndexedDB.

Les tests [`isolation.test.ts`](tests/isolation.test.ts) et
[`library.test.ts`](tests/library.test.ts) verrouillent ces trois barrières.

## Nouveautés de la V0.2.3

**Objectif : que le modèle compose sur la grille du sprite, au lieu qu'on
rattrape le tir après coup.**

La V0.2.2 nettoyait très bien une illustration réduite — mais elle restait un
filet de sécurité. La V0.2.3 change de philosophie : le prompt demande au modèle
un sprite de N × M pixels dont **chaque pixel est un bloc uniforme** dans
l'image générée, et la réduction devient une lecture bloc par bloc.

```
sprite logique 64 × 64
   ↓  le modèle agrandit chaque pixel en bloc de 13 × 13
image générée 832 × 832
   ↓  lecture bloc par bloc
sprite final 64 × 64
```

- **Résolutions alignées** — la sélection privilégie un facteur entier et
  identique sur les deux axes, sous plafond de coût.
- **Lecture bloc par bloc** — un bloc source donne un pixel final, sans mélange.
- **Score de fidélité** — mesure si le modèle a *réellement* respecté la grille.
- **Palette adaptative** — 12 couleurs à 16 px, 48 à 128 px.
- **Repli automatique** — la chaîne V0.2.2 reprend la main dès que la grille
  n'est pas applicable.

### Comparatif mesuré (sprite 64 × 64, source 832 × 832)

| Source | Pipeline | Silhouette | Couleurs | Alphas | Fidélité |
| --- | --- | --- | --- | --- | --- |
| grille respectée | classique | 73,8 % | 32 | 2 | — |
| grille respectée | **grille** | **100 %** | 29 | 2 | 100 % |
| grille texturée | classique | 73,8 % | 32 | 2 | — |
| grille texturée | **grille** | **100 %** | 32 | 2 | 54 % |
| illustration lisse | classique | 59,9 % | 32 | 2 | — |
| illustration lisse | **grille** | **100 %** | 32 | 2 | 40 % |

La « silhouette » mesure la concordance entre le sprite livré et ce que le
modèle a réellement dessiné, bloc par bloc. La chaîne classique détoure puis
remet à l'échelle pour remplir l'emprise : elle déplace donc l'asset et perd la
composition voulue. La grille la reproduit exactement. Les deux pipelines
gardent la même propreté de palette et d'alpha — le nettoyage V0.2.2 s'applique
dans les deux cas.

Ce comparatif est un test :
[`benchmarkPipelines.test.ts`](tests/benchmarkPipelines.test.ts).

## Nouveautés de la V0.2.2

**Objectif : que la sortie soit un vrai sprite, pas une illustration réduite.**

La V0.2.1 livrait un PNG à la bonne dimension — mais qui gardait les centaines
de teintes et les bords anti-aliasés du rendu d'origine. Mesuré sur un rendu
type ramené en 64 × 64 : **1325 couleurs pour 3220 pixels visibles**, 8 niveaux
d'alpha, 44 pixels semi-transparents. L'œil y lisait une miniature floue.

La chaîne **Pixel Cleanup** ramène cela à **32 couleurs, 2 niveaux d'alpha,
0 pixel semi-transparent** — sans un jeton supplémentaire.

| | V0.2.1 | V0.2.2 |
| --- | --- | --- |
| Couleurs (64 × 64) | 1325 | **32** |
| Niveaux d'alpha | 8 | **2** |
| Pixels semi-transparents | 44 | **0** |
| Densité de couleurs | 0,41 | **0,01** |
| Verdict | à surveiller | **propre** |

- **Nettoyage alpha** — poussière invisible effacée, halos supprimés, contours francs.
- **Réduction de palette** — découpage médian, palette adaptée à l'image.
- **Suppression des pixels isolés** — les éclats de dégradé rescapés.
- **Métriques de qualité** — couleurs, alphas, boîte utile, verdict.
- **Aperçus ×1 et ×8** — en rendu pixelisé, pour juger la netteté réelle.

## Nouveautés de la V0.2.1

**Objectif : livrer un PNG directement exploitable dans le jeu.**

Vous choisissez la taille finale de l'asset — 16 × 16, 32 × 32, 64 × 96… —
et vous recevez un PNG exactement à cette dimension. GPT-Image-2 ne sachant pas
générer d'aussi petites images, l'application choisit la plus petite résolution
compatible, puis ramène le rendu à la taille voulue **en local, sans consommer
un seul jeton supplémentaire**.

- **Taille finale de l'asset** — presets et saisie libre.
- **Résolution de génération automatique** — la plus petite qui convienne.
- **Modes qualité** — Auto, Éco, Standard, Haute qualité.
- **Post-traitement local** — détourage, réduction sans lissage, recadrage exact.
- **Récapitulatif clair** — taille livrée, résolution réellement demandée au
  modèle, mode qualité, et étiquettes d'optimisation.

## Nouveautés de la V0.2

- **Style Packs** — créer, sélectionner, renommer, dupliquer, supprimer. Chaque
  pack porte son contexte, ses références et ses catégories.
- **Catégories d'assets** — dimensions cibles et règle textuelle, injectées dans
  le prompt ; entièrement modifiables.
- **Résolution personnalisée** — saisie libre, validée contre les contraintes
  réelles de `gpt-image-2`.
- **Bibliothèque** — enregistrer, parcourir, prévisualiser, renommer,
  télécharger, supprimer les assets générés.
- **Consommation API** — jetons réellement renvoyés par l'API, par génération et
  en cumulé.
- **Navigation par onglets** — Style / Générer / Bibliothèque / Réglages.
- **Migration V0.1** — contexte et références repris automatiquement.

## Stack

| Choix | Raison |
| --- | --- |
| **Next.js 16 (App Router) + TypeScript** | Front et back dans un seul projet : la clé API vit dans une route serveur, jamais dans le bundle navigateur. Un seul déploiement. |
| **Tailwind CSS 4** | Interface mobile-first sans feuille de style séparée. |
| **SDK officiel `openai`** | Endpoints Images à jour, typage complet, gestion des erreurs et des timeouts. |
| **localStorage + IndexedDB** | Textes et métadonnées dans `localStorage`, images dans IndexedDB (blobs binaires, quota large). Aucune base distante. |
| **`pngjs`** | Codec PNG **pur JavaScript, sans dépendance ni binaire natif** : aucune surprise en environnement serverless, et 712 Ko seulement. Absent du bundle client. |
| **Aucune dépendance d'image** | Opérations pixel, quantification (découpage médian) et métriques écrites à la main : la promesse « aucun lissage » reste vérifiable ligne à ligne, et aucune mise à jour ne peut réactiver une interpolation par mégarde. |
| **Zod** | Validation des entrées côté serveur, source de vérité unique. |
| **Vitest + fake-indexeddb** | 236 tests, dont la vraie migration IndexedDB v1 → v2, la chaîne de nettoyage sur de vrais PNG et le comparatif des deux pipelines. |

## Prérequis

- Node.js ≥ 20.9
- Une clé API OpenAI dont l'organisation est **vérifiée** pour les modèles GPT
  Image (vérification à faire une fois sur la console OpenAI).

## Installation

```bash
npm ci
cp .env.example .env.local
```

Renseignez votre clé dans `.env.local` :

```bash
OPENAI_API_KEY=sk-proj-votre-vraie-cle
```

Puis :

```bash
npm run dev
```

L'application est disponible sur <http://localhost:3000>.

### Développer sans consommer de crédits

```bash
MOCK_OPENAI=1 npm run dev
```

Le serveur renvoie une image de test : toute la chaîne est utilisable sans
appeler OpenAI.

## Configuration

| Variable | Obligatoire | Défaut | Rôle |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | oui | — | Clé API, lue **uniquement côté serveur**. |
| `OPENAI_IMAGE_MODEL` | non | `gpt-image-2` | Modèle de génération d'image. |
| `OPENAI_TIMEOUT_MS` | non | `240000` | Timeout de l'appel OpenAI. |
| `OPENAI_ORG_ID` | non | — | Organisation à facturer. |
| `OPENAI_PROJECT_ID` | non | — | Projet à facturer. |
| `MOCK_OPENAI` | non | désactivé | `1` pour renvoyer une image de test. |

### Où la clé est-elle utilisée ?

Uniquement dans [`src/lib/openai/client.ts`](src/lib/openai/client.ts), qui
importe `server-only` : toute tentative d'importer ce module depuis un composant
client **fait échouer la compilation**. La clé n'apparaît ni dans le JavaScript
envoyé au navigateur, ni dans `localStorage`, ni dans les réponses de l'API.

Vérification possible après un `npm run build` :

```bash
grep -r "sk-proj" .next/static/   # ne doit rien renvoyer
```

## Trois notions de taille

C'est la distinction structurante du projet. Elles ne se confondent jamais.

| | Emprise cible (catégorie) | **Taille finale** | Résolution de génération |
| --- | --- | --- | --- |
| Ce que c'est | l'emprise voulue dans le jeu | les dimensions du PNG livré | ce qui est demandé au modèle |
| Où elle agit | **dans le prompt** | **dans le post-traitement** | dans le paramètre `size` |
| Qui la choisit | l'utilisateur, par catégorie | l'utilisateur | **l'application, automatiquement** |
| Exemple | « Petit objet : 32 × 32 px » | `16 × 16` | `816 × 816` |

`gpt-image-2` **ne sait pas produire une image de 16 × 16 px** : il impose un
minimum d'environ 655 360 pixels au total. C'est précisément pour cela que la
taille finale et la résolution de génération sont deux réglages distincts —
l'une est un besoin de jeu, l'autre une contrainte technique.

Le prompt ne parle jamais de la résolution de génération : il annonce la
**dimension finale cible**, ce qui amène le modèle à composer un objet lisible à
cette échelle plutôt qu'une scène détaillée qui deviendrait illisible une fois
réduite. Il précise aussi que cette dimension est une contrainte de conception,
**pas** une autorisation d'étirer l'objet pour remplir le cadre.

### Choix automatique de la résolution

[`chooseGenerationSize`](src/lib/generation/generationSizing.ts) retient la plus
petite résolution qui satisfasse toutes les contraintes du modèle, à rapport
constant. Objectif : sobriété.

| Taille finale | Résolution retenue | Réduction |
| --- | --- | --- |
| 16 × 16 | 816 × 816 | ÷ 51 |
| 32 × 32 | 816 × 816 | ÷ 25,5 |
| 64 × 96 | 672 × 1008 | ÷ 10,5 |
| 128 × 128 | 816 × 816 | ÷ 6,4 |

816 × 816 = 665 856 pixels : le premier carré multiple de 16 au-dessus du
plancher du modèle. Aucune résolution valide plus petite n'existe — le mode
qualité ne peut donc pas gonfler la facture d'un petit asset. Il n'agit que sur
les assets déjà grands, via un facteur de suréchantillonnage (× 1 en éco, × 2 en
standard, × 3 en haute qualité).

### Modes qualité

| Mode | Effet |
| --- | --- |
| **Auto** (défaut) | ≤ 32 px → éco · ≤ 96 px → standard · au-delà → haute |
| Éco / Standard / Haute | force le mode, quelle que soit la taille |

Un asset de 16 × 16 n'a aucun intérêt à être rendu en qualité haute : le détail
serait perdu à la réduction. Le mode Auto applique cette règle simple.

### Post-traitement local

Sans second appel IA, donc **sans jeton supplémentaire** :

1. décodage du PNG renvoyé par l'API ;
2. détection des marges transparentes ;
3. recadrage sur l'asset seul ;
4. **réduction par moyenne de zone** ;
5. **nettoyage pixel** — alpha, palette, pixels isolés ;
6. dépôt centré sur un canvas transparent aux dimensions exactes ;
7. mesure de la qualité obtenue ;
8. ré-encodage PNG.

L'ancrage `bottom-center`, utile aux objets posés au sol, existe et est testé
dans le moteur ; l'interface n'expose que le centrage.

### Pourquoi une moyenne de zone plutôt que le plus proche voisin

C'est le point technique central de la V0.2.2, et il va à rebours de
l'intuition.

Le plus proche voisin retient **un** pixel source sur 51 × 51 lors d'une
réduction ÷ 51. Sur une illustration lisse — ce que produit GPT-Image-2 — ce
tirage est arbitraire : il attrape au hasard un pixel de dégradé ou un pixel de
bord anti-aliasé. Le sprite obtenu est bruité, riche en couleurs et parsemé de
semi-transparences. **Le plus proche voisin est donc lui-même une cause du
« faux pixel art »**, pas un remède.

La moyenne de zone intègre toute l'information du bloc source : la silhouette
est fidèle et stable. Elle produit des valeurs intermédiaires — mais celles-ci
sont immédiatement supprimées par le nettoyage qui suit. **L'image finale ne
contient donc ni dégradé mou ni bord flou**, ce que les tests vérifient
directement sur les pixels livrés.

Le mode `nearest` strict reste disponible et testé
([`PIXEL_CLEANUP.DOWNSCALE_METHOD`](src/lib/config.ts)). Le dépôt sur le canvas
final et les aperçus zoomés restent, eux, de pures recopies de pixels : aucune
interpolation ne peut s'y glisser.

### Grille logique

`chooseGenerationSize` note chaque résolution candidate
([`scoreGenerationSize`](src/lib/generation/generationSizing.ts)) : la qualité
de grille domine, le coût et l'écart de rapport départagent, et un plafond de
surcoût écarte les candidats déraisonnables.

| Taille finale | Résolution retenue | Grille | Surcoût |
| --- | --- | --- | --- |
| 16 × 16 | 816 × 816 | ×51 | +0 % |
| 32 × 32 | 832 × 832 | ×26 | +4 % |
| 48 × 48 | 816 × 816 | ×17 | +0 % |
| 64 × 64 | 832 × 832 | ×13 | +4 % |
| 64 × 96 | 704 × 1056 | ×11 | +10 % |
| 128 × 128 | 896 × 896 | ×7 | +21 % |
| 100 × 75 | — | aucune | +189 % → repli |

Le plafond dépend du mode qualité (éco 1,25× · standard 1,6× · haute 2×) :
« éco » doit rester éco. Il couvre toutes les tailles visées tout en refusant
de payer +57 % pour aligner un 512 × 512 en mode éco.

**Alignement.** Aucun recadrage n'a lieu avant la grille : il décalerait toutes
les bornes de bloc. Comme la résolution vaut exactement `finalWidth × k`, la
lecture bloc par bloc produit directement les dimensions finales — ni crop, ni
mise à l'échelle, ni centrage. Le recentrage éventuel intervient **après**, sur
le sprite final, par translation entière de pixels déjà calculés.

**Fidélité de grille.** Un critère absolu ne suffirait pas : à ×13, une
illustration lisse a elle aussi des blocs presque plats. Mesuré :

| | écart interne | contraste entre blocs |
| --- | --- | --- |
| grille respectée | 0,00 | 68,6 |
| illustration lisse | 2,25 | 7,0 |

C'est le **rapport** qui les sépare : un vrai pixel logique est plat devant le
saut qui le sépare de ses voisins. La fidélité mesure la part de blocs
satisfaisant ce critère — 100 % sur une grille respectée, 40 % sur une
illustration lisse, 100 % sur un aplat uni.

**Repli.** La chaîne V0.2.2 reprend la main dans quatre cas : mode classique
choisi, aucun facteur entier possible, dimensions inattendues, ou sprite vide
en grille — ce dernier cas couvre un asset plus petit qu'un bloc, qui se
diluerait dans la moyenne d'alpha et disparaîtrait.

### Chaîne Pixel Cleanup

Trois traitements, dans cet ordre précis
([`pixelCleanup.ts`](src/lib/image/pixelCleanup.ts)) :

| Étape | Rôle | Réglages par défaut |
| --- | --- | --- |
| **Alpha** | efface la poussière invisible, supprime les halos quasi opaques, ramène les contours sur des paliers francs | efface < 24, opacifie > 200, 2 paliers |
| **Palette** | réduit aux teintes structurantes par découpage médian | plafond adaptatif : 12 couleurs à 16 px, 48 à 128 px |
| **Pixels isolés** | retire les éclats sans aucun voisin visible | actif |

L'ordre compte : nettoyer l'alpha d'abord évite de faire entrer dans la palette
la couleur de pixels voués à disparaître ; retirer les pixels isolés en dernier
permet de juger l'isolement sur l'image déjà assainie.

Le découpage médian construit une palette **adaptée à l'image** plutôt que de
l'écraser sur une grille fixe. Aucun tramage n'est appliqué : le tramage sert à
simuler des teintes absentes, ce qui produirait exactement le bruit que l'on
cherche à supprimer.

Tout est réglable depuis [`PIXEL_CLEANUP`](src/lib/config.ts), d'un seul endroit.

### Métriques et verdict

Chaque sprite livré est mesuré : couleurs, niveaux d'alpha, pixels
semi-transparents, boîte utile, couverture, et **densité de couleurs** —
le rapport entre couleurs distinctes et pixels visibles. Proche de 1, chaque
pixel a sa propre teinte : c'est la signature d'une illustration réduite.

Le verdict — *propre*, *acceptable*, *à surveiller*, *trop lissé* — retient le
pire des deux critères (couleurs et alpha). Les seuils sont regroupés et
documentés dans [`VERDICT_THRESHOLDS`](src/lib/image/pixelMetrics.ts), pas
dispersés dans le code.

### Aperçus ×1 et ×8

L'aperçu 1:1 montre ce que le jeu affichera. Le zoom ×8 est le seul moyen de
juger la qualité pixel-art : si le sprite est propre, on y voit des carrés nets.
`image-rendering: pixelated` est appliqué aux deux — sans lui le navigateur
interpolerait, et l'aperçu mentirait sur ce qui a été produit.

### Contraintes de résolution de `gpt-image-2`

Relevées le 2026-08-27 dans le SDK `openai@7.7.0` (`ImageEditParamsBase.size`)
et centralisées dans [`SIZE_CONSTRAINTS`](src/lib/config.ts) :

| Contrainte | Valeur |
| --- | --- |
| Largeur et hauteur | multiples de 16 |
| Côté maximal | 3840 px |
| Rapport largeur/hauteur | entre 1:3 et 3:1 |
| Total de pixels | 655 360 à 8 294 400 |
| Expérimental au-delà de | 2560 × 1440 |

## Appel OpenAI

L'unique point de contact est `POST /api/generate`
([`route.ts`](src/app/api/generate/route.ts)) :

1. vérification de la présence de la clé API ;
2. lecture du `multipart/form-data` ;
3. validation Zod des champs texte, des réglages et de la résolution ;
4. validation de chaque référence : taille, type déclaré **et signature réelle**
   des premiers octets — un fichier non-image renommé en `.png` est rejeté ;
5. assemblage du prompt ([`assetPrompt.ts`](src/lib/prompt/assetPrompt.ts)) ;
6. appel du SDK :
   - `images.edit` avec les références actives (jusqu'à 16 images),
   - `images.generate` si aucune référence n'est active ;
7. renvoi de l'image en base64, du prompt utilisé, des métadonnées et de la
   consommation réelle.

`input_fidelity` n'est volontairement pas transmis : `gpt-image-2` traite déjà
les images d'entrée en haute fidélité et **rejette** ce paramètre. Le test
[`openaiRequest.test.ts`](tests/openaiRequest.test.ts) verrouille la liste exacte
des paramètres envoyés.

## Consommation et coût

L'interface affiche les jetons **réellement renvoyés** par l'API : entrée texte,
entrée image, sortie image, total. Un poste que l'API ne fournit pas s'affiche
« Donnée non disponible » — rien n'est jamais estimé à la place. Un compteur
cumulatif local, purement indicatif, est disponible dans Réglages.

**Aucun tarif n'est livré avec l'application.** Les prix OpenAI changent, et une
valeur figée dans le code deviendrait fausse en silence. L'estimation de coût
reste désactivée jusqu'à ce que vous saisissiez vos propres tarifs dans
Réglages. Toute la logique est isolée dans [`src/lib/pricing.ts`](src/lib/pricing.ts).

## Migration depuis la V0.1

Automatique et sans perte, au premier chargement :

- la base IndexedDB passe de v1 à v2 ; les références de l'ancien store
  `references` sont recopiées dans `styleReferences` et rattachées au pack de
  migration, puis l'ancien store est supprimé ;
- le contexte enregistré en `localStorage` devient le contexte du pack ;
- un Style Pack **« Style Pack V0.1 »** est créé et sélectionné ;
- un bandeau signale la reprise.

L'opération est idempotente : recharger la page ne duplique rien.

## Limites appliquées

Définies dans [`src/lib/config.ts`](src/lib/config.ts), appliquées côté client
(retour immédiat) **et** côté serveur (source de vérité) :

| Limite | Valeur |
| --- | --- |
| Contexte | 8 000 caractères |
| Demande | 2 000 caractères |
| Références par génération | 16 (limite OpenAI) |
| Poids d'une référence envoyée | 4 Mo |
| Poids cumulé des références | 4 Mo |
| Fichier à l'import | 20 Mo (réduit à 1536 px de côté) |
| Assets en bibliothèque | 500 |
| Taille finale d'un asset | 1 à 2048 px par côté, rapport ≤ 3:1 |

Le poids cumulé des références actives est affiché en permanence dans l'onglet
Style, avec une jauge : la limite d'envoi reste ainsi lisible avant de lancer une
génération. Elle est volontairement en deçà du plafond de corps de requête des
plateformes serverless (~4,5 Mo sur Vercel).

## Déploiement

Projet Next.js standard, déployable sur Vercel, Netlify, Render, Railway ou tout
hôte Node.

### Vercel

1. Importez le dépôt.
2. Ajoutez la variable d'environnement `OPENAI_API_KEY` (Project Settings →
   Environment Variables). Ne la committez jamais.
3. Déployez. Aucune configuration supplémentaire.

Deux points à connaître sur les plateformes serverless :

- **Taille du corps de requête** — souvent plafonnée autour de 4,5 Mo ; les
  limites ci-dessus restent en deçà.
- **Durée d'exécution** — la route déclare `maxDuration = 300`. Selon l'offre, la
  plateforme peut appliquer un plafond inférieur ; en cas de coupure, baissez la
  qualité de génération.

## Scripts

| Commande | Effet |
| --- | --- |
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production |
| `npm run start` | Serveur de production |
| `npm run typecheck` | Vérification TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Tests unitaires (Vitest) |
| `npm run check` | Les trois précédents d'affilée |

## Structure

```
src/
├── app/
│   ├── api/generate/route.ts       Unique point de contact avec OpenAI
│   ├── api/status/route.ts         Présence de la clé (jamais sa valeur)
│   └── layout.tsx  page.tsx  globals.css
├── components/
│   ├── tabs/                       Style · Générer · Bibliothèque · Réglages
│   ├── style/                      Pack, contexte, références, catégories
│   └── ui/                         Primitives d'interface
├── hooks/
│   ├── useAppState.tsx             ENTRÉES : packs, contexte, références
│   ├── useLibrary.ts               SORTIES : assets générés
│   └── useGeneration.ts            Cycle d'une génération
├── lib/
│   ├── config.ts                   Modèle, limites, contraintes de résolution
│   ├── errors.ts                   Codes d'erreur + messages utilisateur
│   ├── pricing.ts                  Estimation de coût (isolée, sans tarif figé)
│   ├── generation/
│   │   ├── payload.ts              Point de passage obligé vers l'API
│   │   ├── generationSizing.ts     Résolution GPT + score de grille
│   │   └── qualityMode.ts          Modes qualité et politique de coût
│   ├── image/
│   │   ├── pixels.ts               Opérations pixel (nearest, moyenne de zone)
│   │   ├── logicalGrid.ts          Lecture bloc par bloc + fidélité
│   │   ├── alphaCleanup.ts         Seuils d'alpha, pixels isolés
│   │   ├── paletteQuantization.ts  Découpage médian + palette adaptative
│   │   ├── pixelCleanup.ts         Orchestration de la chaîne
│   │   ├── pixelMetrics.ts         Mesures et verdict
│   │   └── postProcessing.ts       Pipeline grille + repli classique
│   ├── prompt/assetPrompt.ts       Construction du prompt (point d'extension)
│   ├── openai/                     Client (server-only) + appel Images
│   ├── validation/                 Texte (Zod), résolution, signature d'image
│   ├── storage/                    localStorage + deux stores IndexedDB séparés
│   └── client/                     Préparation d'image, appel API, téléchargement
├── types/
│   ├── domain.ts                   StyleReference ≠ GeneratedAsset
│   └── api.ts                      Contrat navigateur ↔ serveur
tests/                              236 tests
```

## Sécurité

- Clé API exclusivement côté serveur, protégée par `server-only`.
- `.env*` ignoré par Git (sauf `.env.example`, qui ne contient aucune vraie clé).
- Validation des fichiers par **signature binaire**, pas seulement par le type
  déclaré par le navigateur.
- Limites de taille, de nombre et de résolution appliquées côté serveur.
- Messages d'erreur lisibles côté client ; détails techniques uniquement dans la
  console serveur — jamais la clé, jamais le prompt, jamais le base64 complet.

## Volontairement absent de la V0.2.3

Comptes utilisateurs, authentification, synchronisation cloud, base distante,
sélection automatique des références par IA, RAG, mémoire, apprentissage,
fine-tuning, validation visuelle par IA, palette globale par Style Pack,
spritesheets, animations, génération par lots, export/import, éditeur
d'ancrage, contour automatique, correction par un second appel GPT.
