"use client";

/**
 * Authentification côté navigateur.
 *
 * ---------------------------------------------------------------------------
 * CE QUI TRANSITE, ET CE QUI NE TRANSITE PAS
 * ---------------------------------------------------------------------------
 * Seules l'URL du projet et la clé « anon » sont employées ici. Elles sont
 * publiques par conception : la clé anon n'ouvre que ce que les politiques RLS
 * autorisent pour le compte connecté. La clé de service, elle, ne quitte jamais
 * le serveur.
 *
 * Le jeton d'accès est conservé dans `localStorage` — c'est le fonctionnement
 * habituel d'une application web. Il est envoyé au serveur à chaque appel, qui
 * le fait VÉRIFIER par Supabase : le navigateur ne peut donc pas se déclarer
 * propriétaire de quoi que ce soit.
 * ---------------------------------------------------------------------------
 */

const SESSION_KEY = "asset-generator:session";

export interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string | null;
  /** Horodatage d'expiration, en millisecondes. */
  expiresAt: number;
}

export interface SupabasePublicConfig {
  url: string;
  anonKey: string;
}

/** Configuration publique, injectée au build. `null` si non configurée. */
export function publicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/+$/, ""), anonKey };
}

export function isAuthAvailable(): boolean {
  return publicConfig() !== null;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export async function signIn(email: string, password: string): Promise<Session> {
  const config = publicConfig();
  if (config === null) {
    throw new AuthError("La connexion n'est pas configurée sur ce serveur.");
  }

  let response: Response;
  try {
    response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: config.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (error) {
    throw new AuthError(`Serveur d'authentification injoignable : ${String(error)}`);
  }

  if (!response.ok) {
    // Message volontairement générique : ne pas révéler si l'adresse existe.
    throw new AuthError("Adresse e-mail ou mot de passe incorrect.");
  }

  const body = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user?: { id: string; email?: string | null };
  };

  if (!body.access_token || !body.user?.id) {
    throw new AuthError("Réponse d'authentification inattendue.");
  }

  const session: Session = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    userId: body.user.id,
    email: body.user.email ?? null,
    expiresAt: Date.now() + body.expires_in * 1000,
  };

  saveSession(session);
  return session;
}

export async function signOut(): Promise<void> {
  const config = publicConfig();
  const session = loadSession();

  // On efface localement d'abord : même si l'appel réseau échoue, l'appareil
  // ne doit plus porter de session.
  clearSession();

  if (config !== null && session !== null) {
    await fetch(`${config.url}/auth/v1/logout`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${session.accessToken}`,
      },
    }).catch(() => undefined);
  }
}

/** Rafraîchit le jeton s'il approche de l'expiration. */
export async function ensureFreshSession(): Promise<Session | null> {
  const config = publicConfig();
  const session = loadSession();
  if (config === null || session === null) return session;

  // Marge d'une minute : mieux vaut rafraîchir un peu tôt qu'échouer en plein
  // envoi d'une génération.
  if (session.expiresAt - Date.now() > 60_000) return session;

  try {
    const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: config.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    if (!response.ok) {
      clearSession();
      return null;
    }
    const body = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      user?: { id: string; email?: string | null };
    };
    const refreshed: Session = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      userId: body.user?.id ?? session.userId,
      email: body.user?.email ?? session.email,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    saveSession(refreshed);
    return refreshed;
  } catch {
    // Réseau indisponible : on garde la session existante plutôt que de
    // déconnecter l'utilisateur pour une coupure passagère.
    return session;
  }
}

export function loadSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.accessToken !== "string" || typeof parsed.userId !== "string") {
      return null;
    }
    return parsed as Session;
  } catch {
    return null;
  }
}

function saveSession(session: Session): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Navigation privée : la session ne survivra pas au rechargement, sans plus.
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // idem
  }
}
