/**
 * Détection des modifications concurrentes.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE N'EST PAS UN LUXE
 * ---------------------------------------------------------------------------
 * Dès que les données vivent sur un serveur, le même projet peut être ouvert
 * sur le téléphone et sur l'ordinateur. Sans contrôle, la dernière écriture
 * gagne et efface silencieusement l'autre — exactement le genre de perte qu'on
 * ne remarque que bien plus tard.
 *
 * Chaque enregistrement porte donc un numéro de `version`. Toute écriture
 * annonce la version qu'elle croit à jour ; si elle a changé entre-temps,
 * l'écriture est REFUSÉE et l'appelant reçoit la version courante pour
 * arbitrer. Rien n'est jamais écrasé en silence.
 * ---------------------------------------------------------------------------
 */

export interface Versioned {
  id: string;
  version: number;
  updatedAt: number;
}

export type ConcurrencyOutcome<T extends Versioned> =
  | { ok: true; next: T }
  | {
      ok: false;
      reason: "version-obsolete" | "introuvable";
      message: string;
      /** État réellement en base, pour permettre à l'utilisateur de comparer. */
      current: T | null;
    };

export class ConcurrentModificationError extends Error {
  constructor(
    message: string,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(message);
    this.name = "ConcurrentModificationError";
  }
}

/**
 * Applique une modification si et seulement si la version attendue est encore
 * la version courante.
 *
 * La version est incrémentée par cette fonction : l'appelant n'a pas à y
 * penser, et ne peut donc pas oublier de le faire.
 */
export function applyVersioned<T extends Versioned>(
  current: T | null,
  expectedVersion: number,
  change: (value: T) => T,
): ConcurrencyOutcome<T> {
  if (current === null) {
    return {
      ok: false,
      reason: "introuvable",
      message: "Cet élément n'existe plus. Il a peut-être été supprimé sur un autre appareil.",
      current: null,
    };
  }

  if (current.version !== expectedVersion) {
    return {
      ok: false,
      reason: "version-obsolete",
      message: `Cet élément a été modifié ailleurs entre-temps (version ${current.version}, vous partiez de la version ${expectedVersion}). Rechargez pour voir les changements avant d'enregistrer.`,
      current,
    };
  }

  const changed = change(current);
  return {
    ok: true,
    next: { ...changed, version: current.version + 1, updatedAt: Date.now() },
  };
}
