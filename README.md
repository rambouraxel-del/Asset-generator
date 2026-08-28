# Asset Generator — V0.2.1

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
| **`pngjs`** | Codec PNG **pur JavaScript, sans dépendance ni binaire natif** : aucune surprise en environnement serverless, et 712 Ko seulement. Les opérations pixel sont écrites à la main pour garantir l'absence de lissage. |
| **Zod** | Validation des entrées côté serveur, source de vérité unique. |
| **Vitest + fake-indexeddb** | 152 tests, dont la vraie migration IndexedDB v1 → v2 et toute la chaîne de post-traitement sur de vrais PNG. |

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
4. réduction au plus proche voisin — **jamais de lissage** ;
5. dépôt centré sur un canvas transparent aux dimensions exactes ;
6. ré-encodage PNG.

Le rééchantillonnage est écrit à la main
([`pixels.ts`](src/lib/image/pixels.ts)) précisément pour que la promesse
« aucun anti-aliasing » soit vérifiable : chaque pixel de sortie est la copie
exacte d'un pixel d'entrée, jamais une moyenne. Les tests interdisent
l'apparition de toute couleur absente de l'original.

L'ancrage `bottom-center`, utile aux objets posés au sol, existe et est testé
dans le moteur ; la V0.2.1 n'expose que le centrage dans l'interface.

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
│   │   ├── generationSizing.ts     Choix automatique de la résolution GPT
│   │   └── qualityMode.ts          Modes qualité et politique de coût
│   ├── image/
│   │   ├── pixels.ts               Opérations pixel, sans lissage possible
│   │   └── postProcessing.ts       Chaîne complète vers la taille finale
│   ├── prompt/assetPrompt.ts       Construction du prompt (point d'extension)
│   ├── openai/                     Client (server-only) + appel Images
│   ├── validation/                 Texte (Zod), résolution, signature d'image
│   ├── storage/                    localStorage + deux stores IndexedDB séparés
│   └── client/                     Préparation d'image, appel API, téléchargement
├── types/
│   ├── domain.ts                   StyleReference ≠ GeneratedAsset
│   └── api.ts                      Contrat navigateur ↔ serveur
tests/                              152 tests
```

## Sécurité

- Clé API exclusivement côté serveur, protégée par `server-only`.
- `.env*` ignoré par Git (sauf `.env.example`, qui ne contient aucune vraie clé).
- Validation des fichiers par **signature binaire**, pas seulement par le type
  déclaré par le navigateur.
- Limites de taille, de nombre et de résolution appliquées côté serveur.
- Messages d'erreur lisibles côté client ; détails techniques uniquement dans la
  console serveur — jamais la clé, jamais le prompt, jamais le base64 complet.

## Volontairement absent de la V0.2.1

Comptes utilisateurs, authentification, synchronisation cloud, base distante,
sélection automatique des références par IA, RAG, mémoire, apprentissage,
fine-tuning, validation visuelle automatique, réduction de palette, spritesheets,
animations, génération par lots, export/import, éditeur d'ancrage, suppression
d'arrière-plan par un second modèle.
