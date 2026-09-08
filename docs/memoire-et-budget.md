# Mémoire durable et protections budgétaires

Ce document couvre trois choses : la configuration externe à faire vous-même,
la procédure de sauvegarde, et les limites qu'il faut connaître.

---

## 0. ⚠️ Changement important : la génération réelle est désormais fermée par défaut

Depuis cette étape, **une génération réelle est refusée tant que la
configuration de sécurité n'est pas complète**. C'est délibéré : sans elle,
n'importe qui atteignant votre URL pouvait dépenser votre crédit.

Trois éléments sont exigés en mode réel :

| Élément | Variable | Pourquoi |
| --- | --- | --- |
| Authentification | `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | savoir qui appelle |
| Autorisation | `GENERATION_ALLOWLIST` | s'inscrire ne suffit pas à dépenser |
| Budget persistant | `SUPABASE_SERVICE_ROLE_KEY` | un plafond qui tient réellement |

Si l'un manque, l'application vous dit **lequel**, précisément, et bloque.
Le **mode maquette** (`MOCK_OPENAI=1`) reste entièrement ouvert : il n'appelle
aucun fournisseur et ne coûte rien.

> Pourquoi bloquer plutôt que retomber sur un compteur local ? Parce qu'un
> compteur en mémoire disparaît à chaque redémarrage et n'est pas partagé entre
> les serveurs : afficher un plafond dans ces conditions serait un mensonge.

## 1. Ce qui marche déjà, sans rien configurer

L'application continue de fonctionner, avec en plus :

- le **mode projet** (charte, palettes, règles par famille) ;
- l'**assemblage déterministe** du prompt et la sélection explicite des références ;
- la **protection anti double-soumission** entre onglets ;
- l'import de l'ancienne bibliothèque, l'export et l'import portables ;
- le mode maquette, entièrement utilisable pour tout essayer sans dépenser.

Ce qui ne marche **pas** sans configuration : la mémoire partagée entre
appareils, **et la génération réelle** (voir §0). Tant que Supabase n'est pas
branché, tout vit dans votre navigateur.

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
4. Recommencez avec `supabase/migrations/0002_spend_functions.sql` — il ajoute
   les opérations atomiques de budget, sans lesquelles le plafond ne tiendrait
   pas entre plusieurs serveurs.
5. Vérifiez : menu **Table Editor**, vous devez voir les tables `projects`,
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

## 3 bis. ✅ Procédure de validation cloud — les seules actions à faire vous-même

Cette étape ne peut pas être menée depuis l'environnement de développement :
Supabase y est bloqué par la politique réseau. Voici **exactement** ce qui reste
à faire, dans l'ordre. Comptez vingt minutes.

### A. Appliquer les migrations (2 min)

Supabase → **SQL Editor** → **New query** → coller `0001_init.sql` → **Run**.
Recommencer avec `0002_spend_functions.sql`.

**Résultat attendu :** « Success. No rows returned », deux fois.
Si une erreur apparaît, arrêtez-vous et envoyez-la moi.

### B. Vérifier le socle (1 min)

Toujours dans le SQL Editor, coller et exécuter :

```sql
select count(*) as tables   from pg_tables  where schemaname = 'public';
select count(*) as policies from pg_policies where schemaname = 'public';
select count(*) as storage  from pg_policies where schemaname = 'storage';
select id, public from storage.buckets where id = 'asset-images';
```

**Attendu :** 9 tables, 9 politiques, 4 politiques de stockage, bucket
`public = false`. Tout autre chiffre est un problème.

### C. Variables dans Vercel (5 min)

Voir §3.4. Cochez **Production ET Preview**, puis **redéployez**.

### D. Créer deux comptes (2 min)

Supabase → **Authentication** → **Users** → **Add user** :
- votre adresse (celle de `GENERATION_ALLOWLIST`) ;
- une seconde adresse de test, **absente** de la liste.

### E. Les six vérifications (10 min)

| # | Ce que vous faites | Attendu |
|---|---|---|
| 1 | Connexion, créer « Timeless Journey », remplir perspective + échelle, enregistrer | Badge **Synchronisé** |
| 2 | Autre navigateur (ou téléphone), même compte | Le projet et la charte sont là |
| 3 | Modifier la charte sur l'appareil A, enregistrer. Puis modifier sur B **resté sur l'ancienne version** | B refuse, message de conflit, **rien n'est écrasé** |
| 4 | Se connecter avec le **second** compte | **Aucun** projet visible |
| 5 | Avec le second compte, tenter une génération | Refus : compte non autorisé |
| 6 | Redémarrer le déploiement Vercel, recharger | Projet toujours présent |

Envoyez-moi le résultat de B et de E : je saurai si la V0.3.1 peut passer en
production.

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

## 6. Le plafond de dépense — garanties et limites, honnêtement

### Ce qui est démontré

- **La concurrence est traitée.** La décision et la réservation se font en une
  seule opération indivisible : en mémoire, sans `await` intermédiaire ; en base,
  dans une transaction avec verrou de ligne. Un test vérifie que trois demandes
  simultanées sous un plafond de 0,25 $ à 0,10 $ pièce n'en laissent passer que
  **deux**. Une version antérieure du code en laissait passer trois — c'est ce
  test qui l'a révélé.
- **La double soumission est bloquée**, et un renvoi identique après succès
  **rejoue le résultat déjà payé** au lieu d'en facturer un second.
- **Un coût inconnu consomme son estimation**, jamais zéro : sinon un
  fournisseur ne remontant aucun usage rendrait le plafond inopérant.

### Ce qui n'est PAS garanti

> **L'affirmation « dépassement maximal d'une génération » n'est pas tenable
> telle quelle, et je ne la maintiens pas.**

Le dépassement réel est borné par l'**écart entre l'estimation réservée et le
coût réel**, pas par « une génération » :

- si `GENERATION_ESTIMATED_COST_USD` **sous-estime** le coût réel, chaque appel
  creuse l'écart, et **plusieurs** appels peuvent passer avant que le compteur
  ne rattrape la dépense ;
- l'écart maximal est d'environ *N × (coût réel − estimation)*, où *N* est le
  nombre d'appels autorisés avant que le plafond ne morde ;
- si l'estimation **sur-estime**, le plafond bloque trop tôt : plus sûr, mais
  frustrant.

**Conséquence pratique :** réglez `GENERATION_ESTIMATED_COST_USD` au-dessus de
votre coût réel par génération. Un test peut prouver l'absence de course ; aucun
test ne peut borner un dépassement dont la cause est une estimation fausse.

| Situation | Fiabilité |
|---|---|
| Sans Supabase | ❌ Génération réelle **bloquée** (voir §0) |
| Avec Supabase | ✅ Plafond appliqué entre instances, à l'écart d'estimation près |

**Le seul plafond réellement dur reste celui d'OpenAI.** Configurez-le sur votre
compte (Settings → Limits → Monthly budget). C'est votre vraie sécurité.

## 6 bis. Répétition accidentelle et nouvelle variante

Deux boutons, deux intentions :

| Bouton | Effet | Facturé ? |
| --- | --- | --- |
| **Réessayer** | Rejoue la demande. Si elle a déjà abouti, rend le résultat conservé. | Non |
| **Générer une nouvelle variante** | Nouvel appel, même prompt, autre tirage. | **Oui** |

L'identité d'une demande combine *empreinte du contenu + compte + projet +
numéro d'essai*. Une empreinte seule ne suffirait pas : elle confondrait un
double-clic avec une envie de variante. Le compte et le projet en font partie,
ce qui rend structurellement impossible qu'un résultat payé par un compte soit
rejoué vers un autre.

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
