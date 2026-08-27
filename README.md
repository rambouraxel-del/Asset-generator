# Asset Generator — V0.1

Web-app de génération d'**assets graphiques cohérents pour jeu vidéo**, à partir
de l'API OpenAI GPT Image.

Le principe est volontairement simple : vous définissez un **contexte permanent**
(vos règles graphiques et techniques) et un jeu d'**images de référence**, puis
vous décrivez l'asset voulu. L'application envoie à OpenAI exactement :

```
contexte permanent + références activées + demande actuelle
```

…et rien d'autre.

## Aucune mémoire entre les générations

C'est la contrainte centrale du projet, garantie par construction :

- la route `/api/generate` est **totalement sans état** — aucune session, aucun
  cache, aucun historique, aucun fichier écrit entre deux appels ;
- l'endpoint `/v1/images` d'OpenAI est « one-shot » : contrairement à l'API
  Responses, il n'expose ni `conversation` ni `previous_response_id` ;
- une image générée **n'est jamais ajoutée aux références** et n'est jamais
  renvoyée à l'API ;
- « Régénérer » relance la requête d'origine à l'identique (même contexte,
  mêmes références, même demande), sans transmettre le résultat précédent.

Le prompt est assemblé par une fonction pure qui ne reçoit que ces trois
entrées : [`src/lib/prompt/assetPrompt.ts`](src/lib/prompt/assetPrompt.ts).

## Stack

| Choix | Raison |
| --- | --- |
| **Next.js 16 (App Router) + TypeScript** | Front et back dans un seul projet : la clé API vit dans une route serveur, jamais dans le bundle navigateur. Un seul déploiement, aucun serveur séparé à gérer. |
| **Tailwind CSS 4** | Interface mobile-first sans feuille de style à maintenir à part. |
| **SDK officiel `openai`** | Endpoints Images à jour, typage complet, gestion des erreurs et des timeouts. |
| **localStorage + IndexedDB** | Persistance locale sans base de données : le texte dans `localStorage`, les images dans IndexedDB (blobs binaires, quota large). |
| **Zod** | Validation des entrées côté serveur, source de vérité unique. |
| **Vitest** | Tests unitaires sur la construction du prompt et la validation. |

## Prérequis

- Node.js ≥ 20.9
- Une clé API OpenAI dont l'organisation est **vérifiée** pour les modèles GPT
  Image (vérification à faire une fois sur la console OpenAI).

## Installation

```bash
npm install
cp .env.example .env.local
```

Puis ouvrez `.env.local` et renseignez votre clé :

```bash
OPENAI_API_KEY=sk-proj-votre-vraie-cle
```

Lancez le serveur de développement :

```bash
npm run dev
```

L'application est disponible sur <http://localhost:3000>.

### Développer sans consommer de crédits

```bash
MOCK_OPENAI=1 npm run dev
```

Le serveur renvoie alors une image de test : toute la chaîne (import de
références, construction du prompt, affichage, téléchargement) est utilisable
sans appeler OpenAI.

## Configuration

| Variable | Obligatoire | Défaut | Rôle |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | oui | — | Clé API, lue **uniquement côté serveur**. |
| `OPENAI_IMAGE_MODEL` | non | `gpt-image-2` | Modèle de génération d'image. |
| `OPENAI_TIMEOUT_MS` | non | `240000` | Timeout de l'appel OpenAI. |
| `OPENAI_ORG_ID` | non | — | Organisation à facturer. |
| `OPENAI_PROJECT_ID` | non | — | Projet à facturer. |
| `MOCK_OPENAI` | non | désactivé | `1` pour renvoyer une image de test sans appeler l'API. |

### Où la clé est-elle utilisée ?

Uniquement dans [`src/lib/openai/client.ts`](src/lib/openai/client.ts), qui
importe `server-only` : toute tentative d'importer ce module depuis un composant
client **fait échouer la compilation**. La clé n'apparaît donc ni dans le
JavaScript envoyé au navigateur, ni dans `localStorage`, ni dans les réponses de
l'API. `.env.local` est ignoré par Git.

Pour vérifier vous-même après un `npm run build` :

```bash
grep -r "sk-" .next/static/   # ne doit rien renvoyer
```

## Utilisation

1. **Contexte** — saisissez vos règles permanentes (style, proportions, échelle,
   fond). Enregistrées automatiquement dans le navigateur.
2. **Références** — importez vos images (PNG, JPEG, WebP). Chacune peut être
   activée, désactivée ou supprimée ; seules les références activées sont
   envoyées.
3. **Génération** — décrivez l'asset, ajustez taille / qualité / fond / format,
   puis cliquez sur **Générer**.
4. **Résultat** — visualisez l'image sur fond damier (la transparence est
   visible), téléchargez-la ou régénérez à l'identique.

## Appel OpenAI

L'unique point de contact est `POST /api/generate`
([`src/app/api/generate/route.ts`](src/app/api/generate/route.ts)) :

1. vérification de la présence de la clé API ;
2. lecture du `multipart/form-data` (texte + fichiers) ;
3. validation des champs texte et des réglages (Zod) ;
4. validation de chaque référence : taille, type déclaré **et signature réelle**
   des premiers octets — un fichier non-image renommé en `.png` est rejeté ;
5. assemblage du prompt (fonction pure, centralisée) ;
6. appel du SDK :
   - `images.edit` avec les références activées (jusqu'à 16 images), lorsqu'au
     moins une référence est activée ;
   - `images.generate` sinon ;
7. renvoi de l'image en base64, du prompt utilisé et de quelques métadonnées.

`input_fidelity` n'est volontairement pas transmis : `gpt-image-2` traite déjà
les images d'entrée en haute fidélité et rejette ce paramètre.

## Limites appliquées

Définies dans [`src/lib/config.ts`](src/lib/config.ts) et appliquées côté client
(retour immédiat) **et** côté serveur (source de vérité) :

| Limite | Valeur |
| --- | --- |
| Contexte | 8 000 caractères |
| Demande | 2 000 caractères |
| Références par génération | 16 (limite OpenAI) |
| Poids d'une référence envoyée | 4 Mo |
| Poids cumulé des références | 4 Mo |
| Fichier à l'import | 20 Mo (réduit automatiquement à 1536 px de côté) |

## Déploiement

Le projet est un Next.js standard, déployable tel quel sur Vercel, Netlify,
Render, Railway ou tout hôte Node.

### Vercel (le plus direct)

1. Poussez le dépôt sur GitHub, puis importez-le dans Vercel.
2. Ajoutez la variable d'environnement `OPENAI_API_KEY` (Project Settings →
   Environment Variables). Ne la committez jamais.
3. Déployez. Aucune configuration supplémentaire n'est requise.

Deux points à connaître sur les plateformes serverless :

- **Taille du corps de requête** — souvent plafonnée autour de 4,5 Mo. Les
  limites ci-dessus (4 Mo cumulés) restent volontairement en deçà.
- **Durée d'exécution** — la route déclare `maxDuration = 300`. Selon l'offre,
  la plateforme peut appliquer un plafond inférieur ; en cas de coupure,
  baissez la qualité de génération.

### Hôte Node classique

```bash
npm run build
OPENAI_API_KEY=... npm run start
```

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
│   ├── api/generate/route.ts   Unique point de contact avec OpenAI
│   ├── api/status/route.ts     Indique si la clé est configurée (jamais sa valeur)
│   ├── layout.tsx  page.tsx  globals.css
├── components/                 Sections A/B/C/D + primitives d'interface
├── hooks/                      État du contexte, des références, de la génération
├── lib/
│   ├── config.ts               Modèle, limites, valeurs par défaut
│   ├── errors.ts               Codes d'erreur + messages utilisateur
│   ├── prompt/assetPrompt.ts   Construction du prompt (point d'extension)
│   ├── openai/                 Client (server-only) + appel Images
│   ├── validation/             Champs texte (Zod) + fichiers image (signature)
│   ├── storage/                localStorage (texte) + IndexedDB (références)
│   └── client/                 Préparation d'image, appel API, téléchargement
├── types/api.ts                Contrat navigateur ↔ serveur
tests/                          Tests unitaires
```

## Sécurité

- Clé API exclusivement côté serveur, protégée par `server-only`.
- `.env*` ignoré par Git.
- Validation des fichiers par **signature binaire**, pas seulement par le type
  déclaré par le navigateur.
- Limites de taille et de nombre appliquées côté serveur.
- Validation de toutes les entrées utilisateur côté serveur.
- Les messages d'erreur affichés restent lisibles ; les détails techniques ne
  vont que dans la console serveur (jamais le prompt, jamais la clé).

## Volontairement absent de la V0.1

Comptes utilisateurs, authentification, base de données distante, bibliothèque
cloud, spritesheets, validation graphique par IA, notation, variantes
automatiques, historique de conversation, apprentissage sur les générations
passées.

L'architecture prépare néanmoins ces évolutions : voir les points d'extension
signalés dans `src/lib/config.ts`, `src/lib/prompt/assetPrompt.ts` et
`src/lib/storage/`.
