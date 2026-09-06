import "server-only";

/**
 * Accès HTTP à Supabase depuis le serveur.
 *
 * ---------------------------------------------------------------------------
 * PAS DE SDK, ET C'EST VOULU
 * ---------------------------------------------------------------------------
 * PostgREST et Storage sont des API HTTP ordinaires. Un client `fetch` d'une
 * centaine de lignes couvre tout ce dont nous avons besoin, sans ajouter une
 * dépendance à auditer, à mettre à jour et à charger.
 *
 * ---------------------------------------------------------------------------
 * DEUX IDENTITÉS D'APPEL, À NE JAMAIS CONFONDRE
 * ---------------------------------------------------------------------------
 *   `asUser(token)`   — agit AU NOM du compte connecté. Les politiques RLS
 *                       s'appliquent : c'est la voie normale, celle qui garantit
 *                       qu'un compte ne peut pas toucher les données d'un autre.
 *
 *   `asService()`     — contourne RLS. Réservé aux écritures système que
 *                       l'utilisateur ne doit pas pouvoir falsifier : registre
 *                       de dépense et clés d'idempotence. Jamais employée pour
 *                       lire ou écrire du contenu utilisateur.
 *
 * La clé de service ne quitte jamais le serveur : ce module est `server-only`,
 * ce qui fait échouer la compilation si un composant client l'importe.
 * ---------------------------------------------------------------------------
 */

import { readConfig } from "@/lib/supabase/config";

export class SupabaseUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseUnavailableError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  /** En-têtes PostgREST supplémentaires (`Prefer`, `Range`…). */
  headers?: Record<string, string>;
  /** Jeton du compte. `null` = appel système avec la clé de service. */
  token: string | null;
}

async function call<T>(options: RequestOptions): Promise<T> {
  const config = readConfig();
  if (config === null) {
    throw new SupabaseUnavailableError("Supabase n'est pas configuré sur ce serveur.");
  }

  const key = options.token === null ? config.serviceRoleKey : config.anonKey;
  if (key === null) {
    throw new SupabaseUnavailableError(
      "La clé de service Supabase est absente : les écritures système sont impossibles.",
    );
  }

  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${options.token ?? key}`,
    "Content-Type": "application/json",
    ...options.headers,
  };

  let response: Response;
  try {
    response = await fetch(`${config.url}${options.path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    });
  } catch (error) {
    // Une panne réseau est une INDISPONIBILITÉ, pas un succès vide : elle doit
    // remonter, jamais être avalée en silence.
    throw new SupabaseUnavailableError(`Supabase injoignable : ${String(error)}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new SupabaseUnavailableError(
      `Supabase a répondu ${response.status} sur ${options.path}. ${detail.slice(0, 300)}`,
    );
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text.length === 0 ? undefined : JSON.parse(text)) as T;
}

/** Requêtes au nom du compte connecté : les politiques RLS s'appliquent. */
export const asUser = {
  select<T>(token: string, path: string): Promise<T> {
    return call<T>({ path: `/rest/v1/${path}`, token });
  },
  insert<T>(token: string, table: string, rows: unknown, prefer = "return=representation"): Promise<T> {
    return call<T>({
      method: "POST",
      path: `/rest/v1/${table}`,
      body: rows,
      headers: { Prefer: prefer },
      token,
    });
  },
  update<T>(token: string, path: string, patch: unknown): Promise<T> {
    return call<T>({
      method: "PATCH",
      path: `/rest/v1/${path}`,
      body: patch,
      headers: { Prefer: "return=representation" },
      token,
    });
  },
  remove<T>(token: string, path: string): Promise<T> {
    return call<T>({ method: "DELETE", path: `/rest/v1/${path}`, token });
  },
};

/**
 * Requêtes système, hors RLS.
 *
 * À n'employer que pour les compteurs que l'utilisateur ne doit pas pouvoir
 * fausser. Le `owner_id` est toujours fourni par le serveur à partir de
 * l'identité vérifiée, jamais repris du corps de la requête.
 */
export const asService = {
  select<T>(path: string): Promise<T> {
    return call<T>({ path: `/rest/v1/${path}`, token: null });
  },
  insert<T>(table: string, rows: unknown, prefer = "return=representation"): Promise<T> {
    return call<T>({
      method: "POST",
      path: `/rest/v1/${table}`,
      body: rows,
      headers: { Prefer: prefer },
      token: null,
    });
  },
  update<T>(path: string, patch: unknown): Promise<T> {
    return call<T>({
      method: "PATCH",
      path: `/rest/v1/${path}`,
      body: patch,
      headers: { Prefer: "return=representation" },
      token: null,
    });
  },
  remove<T>(path: string): Promise<T> {
    return call<T>({ method: "DELETE", path: `/rest/v1/${path}`, token: null });
  },
  rpc<T>(name: string, args: unknown): Promise<T> {
    return call<T>({ method: "POST", path: `/rest/v1/rpc/${name}`, body: args, token: null });
  },
};

/**
 * URL signée d'un fichier privé.
 *
 * Les images ne sont jamais publiques : chaque accès passe par une URL à durée
 * limitée, générée ici, côté serveur.
 */
export async function createSignedUrl(
  token: string,
  path: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const config = readConfig();
  if (config === null) throw new SupabaseUnavailableError("Supabase n'est pas configuré.");

  const result = await call<{ signedURL?: string; signedUrl?: string }>({
    method: "POST",
    path: `/storage/v1/object/sign/asset-images/${path}`,
    body: { expiresIn: expiresInSeconds },
    token,
  });

  const signed = result.signedURL ?? result.signedUrl;
  if (!signed) throw new SupabaseUnavailableError("URL signée absente de la réponse.");
  return `${config.url}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
}
