# Mémoire durable et protections budgétaires

Ce document couvre trois choses : la configuration externe à faire vous-même,
la procédure de sauvegarde, et les limites qu'il faut connaître.

---

## 1. Ce qui marche déjà, sans rien configurer

Rien n'est cassé si vous ne faites rien. L'application continue de fonctionner
exactement comme avant, avec en plus :

- le **mode projet** (charte, palettes, règles par famille) ;
- l'**assemblage déterministe** du prompt et la sélection explicite des références ;
- la **protection anti double-soumission** entre onglets ;
- un **plafond de dépense** indicatif, si vous le configurez.

Ce qui ne marche **pas** encore sans configuration : la mémoire partagée entre
appareils. Tant que Supabase n'est pas branché, tout vit dans votre navigateur.

---

## 2. État exact du stockage

| Où | Quoi | Survit à un autre appareil ? | Survit à un vidage du navigateur ? |
|---|---|---|---|
| `localStorage` | projets, réglages, compteurs | ❌ | ❌ |
| IndexedDB | références, bibliothèque | ❌ | ❌ |
| Supabase (à configurer) | tout | ✅ | ✅ |

**Le stockage du navigateur est un cache, jamais une sauvegarde.** Il est
attaché à l'adresse exacte du site : si l'application change d'adresse, les
anciennes données ne sont plus lisibles depuis la nouvelle. C'est une
protection du navigateur, qu'aucun code ne peut contourner. Dans ce cas :
ouvrez l'**ancienne** adresse, exportez le projet, importez le fichier sur la
nouvelle.

---

## 3. Configurer Supabase — clic par clic

Vous n'aurez **jamais** à coller une clé secrète dans une conversation. Tout se
fait dans deux interfaces web.

### 3.1 Créer le projet

1. Allez sur `supabase.com`, créez un compte, cliquez **New project**.
2. Nom : `asset-generator`. Choisissez une région proche de vous.
3. Notez le mot de passe de base de données dans votre gestionnaire de mots de
   passe. Vous n'en aurez pas besoin ici, mais ne le perdez pas.
4. Attendez ~2 minutes que le projet soit prêt.

### 3.2 Appliquer la migration

1. Dans le menu de gauche : **SQL Editor** → **New query**.
2. Ouvrez le fichier `supabase/migrations/0001_init.sql` de ce dépôt, copiez
   **tout** son contenu, collez-le dans l'éditeur.
3. Cliquez **Run**.
4. Vérifiez : menu **Table Editor**, vous devez voir les tables `projects`,
   `assets`, `asset_variants`, `generations`, `allowed_generators`,
   `spend_ledger`.

Cette migration ne supprime rien et peut être relancée sans dégât.

### 3.3 Récupérer les clés

1. Menu **Project Settings** → **API**.
2. Vous voyez trois valeurs. Vous en aurez besoin de trois :
   - **Project URL**
   - **anon public** (publique, sans danger)
   - **service_role** (⚠️ **secrète** — elle contourne toutes les protections)

### 3.4 Les mettre dans Vercel

1. Tableau de bord Vercel → votre projet → **Settings** → **Environment Variables**.
2. Ajoutez ces trois variables, en cochant **Production ET Preview** :

| Nom | Valeur |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | la Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la clé anon |
| `SUPABASE_SERVICE_ROLE_KEY` | la clé service_role |

3. Ajoutez aussi `GENERATION_ALLOWLIST` avec **votre adresse e-mail**.
   Sans elle, n'importe quel compte créé pourrait dépenser votre crédit.
4. **Redéployez** (Deployments → ⋯ → Redeploy). Les variables ne sont prises en
   compte qu'au déploiement suivant.

### 3.5 Créer votre compte

1. Supabase → **Authentication** → **Users** → **Add user**.
2. Mettez la même adresse que dans `GENERATION_ALLOWLIST`.

---

## 4. Tester sur deux appareils

1. **Ordinateur** : ouvrez le site, connectez-vous, créez le projet
   « Timeless Journey », remplissez au moins la perspective et l'échelle.
2. **Téléphone** : ouvrez la **même adresse**, connectez-vous avec le **même
   compte**. Le projet doit apparaître avec la charte saisie.
3. **Test du conflit** : modifiez la charte sur l'ordinateur, enregistrez. Puis,
   sur le téléphone resté sur l'ancienne version, modifiez et enregistrez : un
   message doit vous dire que le projet a changé ailleurs, **sans écraser**.

Si l'étape 2 ne montre rien, vérifiez dans l'ordre : les trois variables sont
bien cochées pour Production, vous avez redéployé, c'est bien le même compte.

---

## 5. Sauvegarde et restauration

> **La base et les images sont deux choses séparées.** Sauvegarder la base ne
> sauvegarde **pas** les images : elles vivent dans le stockage de fichiers.
> Une restauration qui n'aurait que la base vous rendrait un catalogue vide.

### Ce qu'il faut sauvegarder

| Élément | Où | Comment |
|---|---|---|
| Base de données | Supabase → Database → Backups | Sauvegardes automatiques quotidiennes selon l'offre ; sinon **Database → Backups → Download** |
| **Images** | Supabase → Storage → `asset-images` | **Téléchargement manuel**, ou via la CLI Supabase |
| Secrets | Vercel → Environment Variables | Notez-les dans un gestionnaire de mots de passe |

### Restauration

1. Restaurez la base **d'abord** (elle contient les chemins des fichiers).
2. Restaurez les images dans le bucket `asset-images`, **en conservant les
   chemins exacts** (`<identifiant-du-compte>/...`). Un chemin modifié rend
   l'image introuvable.
3. Vérifiez qu'une image s'affiche dans la bibliothèque.

### Export manuel ≠ sauvegarde automatique

L'**export portable** (un fichier JSON avec les images) est déclenché par vous,
pour déplacer un projet ou en garder une copie. Ce n'est **pas** une sauvegarde :
il ne part pas tout seul, et il ne couvre qu'un projet à la fois. Les deux sont
utiles, ils ne se remplacent pas.

---

## 6. Le plafond de dépense — ce qu'il garantit vraiment

| Situation | Le plafond est-il fiable ? |
|---|---|
| Sans Supabase | ❌ **Non — garde-fou indicatif.** Le compteur vit en mémoire, propre à chaque instance serveur et remis à zéro au redémarrage. |
| Avec Supabase | ✅ Oui, à une génération près. |

Deux imprécisions restent, même dans le meilleur cas :

1. **Le coût réel n'est connu qu'après l'appel.** On réserve donc une
   estimation (`GENERATION_ESTIMATED_COST_USD`) avant de partir. Un dépassement
   d'au plus une génération reste possible.
2. **Un coût inconnu est compté à son estimation, pas à zéro.** Si l'API ne
   remonte aucun usage, le compteur monte quand même — sinon le plafond ne
   bloquerait jamais. L'interface distingue toujours *mesuré* et *estimé*.

**Le seul plafond réellement dur est celui d'OpenAI.** Configurez-le sur votre
compte OpenAI (Settings → Limits → Monthly budget). C'est votre vraie sécurité.

---

## 7. Tarifs

Aucun tarif n'est codé dans l'application, **volontairement** : un tarif figé
devient faux en silence, ce qui est pire que pas de prix du tout.

Pour obtenir des coûts « mesurés » plutôt qu'« inconnus » :

1. Relevez vos tarifs sur votre page de facturation OpenAI.
2. Renseignez `PRICING_TEXT_INPUT_PER_MILLION`,
   `PRICING_IMAGE_INPUT_PER_MILLION`, `PRICING_IMAGE_OUTPUT_PER_MILLION` et
   `PRICING_VERSION` (par exemple `2026-09-releve`).

La version est **obligatoire** : elle est enregistrée avec chaque génération,
pour pouvoir recalculer plus tard en sachant quel barème s'appliquait.

---

## 8. Coûts d'hébergement — distincts des coûts de génération

| Service | Offre gratuite | Quand ça devient payant |
|---|---|---|
| **Vercel** | Hobby : gratuit, usage personnel non commercial | ~20 $/mois (Pro) si usage commercial ou dépassement |
| **Supabase** | Gratuit : 500 Mo de base, 1 Go de fichiers, projet mis en pause après 7 jours d'inactivité | ~25 $/mois (Pro) au-delà, ou pour éviter la mise en pause |
| **OpenAI** | Aucune | À l'usage, **c'est le seul coût lié aux générations** |

Ces montants sont indicatifs et changent : vérifiez sur les pages de
tarification avant de vous engager. Aucun service payant supplémentaire n'a été
ajouté, et aucune dépendance nouvelle n'a été installée.
