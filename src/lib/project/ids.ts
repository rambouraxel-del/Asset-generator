/**
 * Identifiants de projet.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE MODULE EST SÉPARÉ DE `storage/db.ts`
 * ---------------------------------------------------------------------------
 * `createId(prefix)` (dans `storage/db.ts`) produit des identifiants du type
 * `pack-<uuid>`, `asset-<uuid>`, etc. C'est très bien pour des clés purement
 * locales (IndexedDB, `localStorage`) — le préfixe aide à la lecture d'un
 * export ou d'un journal.
 *
 * `public.projects.id` est en revanche un `uuid` NATIF côté Supabase. Un
 * identifiant préfixé (`project-2e07cd23-...`) n'est PAS un UUID valide pour
 * Postgres et fait échouer l'insertion avec l'erreur 22P02
 * (« invalid input syntax for type uuid »). Les projets doivent donc utiliser
 * un identifiant qui est un UUID à la fois localement et une fois synchronisé
 * — pas un préfixe métier suivi d'un UUID.
 * ---------------------------------------------------------------------------
 */

/** Forme exacte d'un UUID (version et variant quelconques, y compris nil). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Crée un identifiant de projet.
 *
 * Toujours un UUID quand `crypto.randomUUID` est disponible — c'est le cas de
 * tous les environnements ciblés (navigateurs évergreens, Node ≥ 14.17). Le
 * repli ci-dessous n'est qu'une sécurité : il NE PRODUIT PAS un UUID valide,
 * et un projet créé ainsi reste utilisable localement mais devra recevoir un
 * UUID au moment de sa première synchronisation (voir
 * `lib/project/repository.ts`, qui détecte ce cas via `isValidUuid` et migre
 * proprement plutôt que d'échouer).
 */
export function createProjectId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
