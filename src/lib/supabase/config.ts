import "server-only";

/**
 * Détection de la configuration Supabase.
 *
 * ---------------------------------------------------------------------------
 * AUCUNE DÉPENDANCE AJOUTÉE
 * ---------------------------------------------------------------------------
 * Les API Supabase (Auth, PostgREST, Storage) sont du HTTP standard. `fetch`
 * suffit, donc le SDK n'est pas installé : une dépendance de moins à maintenir,
 * à auditer et à charger, pour un gain nul dans notre cas.
 *
 * ---------------------------------------------------------------------------
 * OÙ VIVENT LES SECRETS
 * ---------------------------------------------------------------------------
 * `SUPABASE_SERVICE_ROLE_KEY` ne doit JAMAIS quitter le serveur : elle
 * contourne toutes les politiques RLS. Ce module est marqué `server-only`, ce
 * qui fait échouer la compilation si un composant client l'importe.
 *
 * `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` sont publiques
 * par conception : la clé « anon » ne donne accès qu'à ce que les politiques
 * RLS autorisent pour le compte connecté.
 * ---------------------------------------------------------------------------
 */

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string | null;
}

/** `true` si la synchronisation distante est réellement utilisable. */
export function isSupabaseConfigured(): boolean {
  return readConfig() !== null;
}

/**
 * Lit la configuration. Renvoie `null` si elle est incomplète — l'application
 * retombe alors sur le stockage navigateur, en le disant clairement.
 */
export function readConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;

  return {
    url: url.replace(/\/+$/, ""),
    anonKey,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null,
  };
}

/**
 * État de configuration, sûr à exposer au navigateur.
 * Ne contient aucune clé — seulement des booléens.
 */
export interface SupabaseStatus {
  configured: boolean;
  /** `true` si le serveur peut écrire au nom du système (registre de dépense). */
  serviceRole: boolean;
}

export function readStatus(): SupabaseStatus {
  const config = readConfig();
  return {
    configured: config !== null,
    serviceRole: config?.serviceRoleKey !== null && config?.serviceRoleKey !== undefined,
  };
}
