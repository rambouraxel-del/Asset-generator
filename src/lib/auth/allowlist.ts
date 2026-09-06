import "server-only";

/**
 * Autorisation explicite des comptes pouvant consommer le crédit API.
 *
 * ---------------------------------------------------------------------------
 * S'INSCRIRE NE SUFFIT PAS
 * ---------------------------------------------------------------------------
 * L'authentification prouve QUI vous êtes ; elle n'autorise pas à dépenser.
 * Sans cette barrière, activer une inscription publique reviendrait à ouvrir
 * son portefeuille : n'importe qui pourrait créer un compte et lancer des
 * générations payantes.
 *
 * Deux sources d'autorisation, cumulables :
 *
 *   1. `GENERATION_ALLOWLIST` — adresses e-mail ou identifiants séparés par des
 *      virgules, lus côté serveur uniquement.
 *   2. la table `allowed_generators` en base, quand Supabase est configuré,
 *      pour gérer les autorisations sans redéployer.
 *
 * Par défaut, si AUCUNE liste n'est configurée, l'application reste utilisable
 * en solo (mode « propriétaire unique ») : c'est le comportement actuel, et le
 * préserver évite de casser l'usage existant. Dès qu'une liste est renseignée,
 * elle fait foi.
 * ---------------------------------------------------------------------------
 */

export type AuthorizationVerdict =
  | { allowed: true; mode: "propriétaire-unique" | "liste" }
  | { allowed: false; reason: string };

/** Lit la liste d'autorisation. Ne renvoie jamais de secret. */
export function readAllowlist(): string[] {
  return parseAllowlist(process.env.GENERATION_ALLOWLIST ?? "");
}

export function parseAllowlist(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Décide si un compte peut lancer une génération payante.
 *
 * @param identity  e-mail ou identifiant du compte, ou `null` si non connecté.
 * @param extra     autorisations venues de la base.
 */
export function authorizeGeneration(
  identity: string | null,
  extra: string[] = [],
): AuthorizationVerdict {
  const allowlist = [
    ...readAllowlist(),
    ...extra.map((entry) => entry.trim().toLowerCase()).filter((e) => e.length > 0),
  ];

  // Aucune liste configurée : usage solo, comportement historique préservé.
  if (allowlist.length === 0) {
    return { allowed: true, mode: "propriétaire-unique" };
  }

  if (identity === null) {
    return {
      allowed: false,
      reason:
        "Cette application demande une connexion avant toute génération. Connectez-vous avec un compte autorisé.",
    };
  }

  if (allowlist.includes(identity.trim().toLowerCase())) {
    return { allowed: true, mode: "liste" };
  }

  return {
    allowed: false,
    reason:
      "Ce compte n'est pas autorisé à lancer des générations. Le propriétaire doit l'ajouter à la liste d'autorisation.",
  };
}
