import "server-only";

/**
 * Identification du compte à l'origine d'une requête.
 *
 * ---------------------------------------------------------------------------
 * LA VÉRIFICATION SE FAIT CÔTÉ SERVEUR, TOUJOURS
 * ---------------------------------------------------------------------------
 * Le navigateur envoie un jeton d'accès Supabase ; le serveur le fait vérifier
 * par Supabase avant d'y croire. Un identifiant envoyé par le client sans
 * jeton n'est jamais pris pour argent comptant : ce serait laisser n'importe
 * qui se déclarer propriétaire d'un projet.
 *
 * Tant que Supabase n'est pas configuré, l'application fonctionne en mode
 * « propriétaire unique » : un seul utilisateur local, pas de compte. C'est le
 * comportement actuel, préservé pour ne rien casser.
 * ---------------------------------------------------------------------------
 */

import { readConfig } from "@/lib/supabase/config";

/** Identifiant conventionnel du mode sans compte. */
export const SOLO_OWNER_ID = "local-owner";

export interface Identity {
  /** Identifiant stable du compte, ou `SOLO_OWNER_ID` sans authentification. */
  ownerId: string;
  /** Adresse e-mail, quand elle est connue. Sert à la liste d'autorisation. */
  email: string | null;
  /** `true` si l'identité a été vérifiée auprès du fournisseur. */
  verified: boolean;
  mode: "solo" | "supabase";
}

/** Identité par défaut, sans compte. */
export function soloIdentity(): Identity {
  return { ownerId: SOLO_OWNER_ID, email: null, verified: false, mode: "solo" };
}

/**
 * Résout l'identité d'une requête.
 *
 * @throws jamais : une erreur réseau ou un jeton invalide donnent `null`,
 *         que l'appelant traite comme « non authentifié ».
 */
export async function resolveIdentity(request: Request): Promise<Identity | null> {
  const config = readConfig();

  // Sans Supabase : mode solo, comme aujourd'hui.
  if (config === null) return soloIdentity();

  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : null;

  if (token === null || token.length === 0) return null;

  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: config.anonKey },
      cache: "no-store",
    });

    if (!response.ok) return null;

    const user = (await response.json()) as { id?: string; email?: string | null };
    if (typeof user.id !== "string" || user.id.length === 0) return null;

    return {
      ownerId: user.id,
      email: typeof user.email === "string" ? user.email : null,
      verified: true,
      mode: "supabase",
    };
  } catch {
    // Réseau indisponible : on refuse plutôt que d'accorder un accès par défaut.
    return null;
  }
}
