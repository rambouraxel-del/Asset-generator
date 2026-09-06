import "server-only";

/**
 * Protection serveur contre les doubles soumissions.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CÔTÉ SERVEUR
 * ---------------------------------------------------------------------------
 * Désactiver le bouton dans l'interface ne protège que l'onglet où l'on a
 * cliqué. Deux onglets ouverts, un double-clic rapide, un rechargement pendant
 * l'appel, un renvoi automatique du navigateur : autant de cas où deux
 * requêtes payantes partent pour une seule intention.
 *
 * Le client envoie donc une CLÉ D'IDEMPOTENCE dérivée du contenu de la
 * demande. Le serveur refuse la seconde requête portant la même clé tant que la
 * première n'est pas terminée, et renvoie ensuite son résultat plutôt que d'en
 * payer un second.
 *
 * Limite assumée : comme le registre de dépenses, ce cache est en mémoire tant
 * qu'aucune base n'est configurée. Il protège donc au sein d'une instance, et
 * non entre deux instances serverless simultanées. Avec Supabase configuré, la
 * clé est posée en base sous contrainte d'unicité et la protection devient
 * globale.
 * ---------------------------------------------------------------------------
 */

export type ClaimResult<T> =
  | { status: "claimed" }
  | { status: "in-progress" }
  | { status: "completed"; value: T };

interface Entry<T> {
  state: "in-progress" | "completed";
  value?: T;
  at: number;
}

/** Durée de conservation d'un résultat terminé. */
const RETENTION_MS = 10 * 60 * 1000;

export class IdempotencyStore<T> {
  readonly isStrict = false;
  private readonly entries = new Map<string, Entry<T>>();

  /**
   * Tente de prendre la main sur une clé.
   *
   *   `claimed`     — c'est la première requête, elle peut travailler ;
   *   `in-progress` — une requête identique est déjà en cours, refuser ;
   *   `completed`   — le travail est déjà fait, renvoyer son résultat.
   */
  claim(key: string): ClaimResult<T> {
    this.purge();
    const existing = this.entries.get(key);

    if (existing === undefined) {
      this.entries.set(key, { state: "in-progress", at: Date.now() });
      return { status: "claimed" };
    }

    if (existing.state === "in-progress") return { status: "in-progress" };
    return { status: "completed", value: existing.value as T };
  }

  complete(key: string, value: T): void {
    this.entries.set(key, { state: "completed", value, at: Date.now() });
  }

  /** Échec : la clé est libérée pour qu'un nouvel essai reste possible. */
  abandon(key: string): void {
    this.entries.delete(key);
  }

  private purge(): void {
    const cutoff = Date.now() - RETENTION_MS;
    for (const [key, entry] of this.entries) {
      if (entry.at < cutoff) this.entries.delete(key);
    }
  }

  reset(): void {
    this.entries.clear();
  }
}
