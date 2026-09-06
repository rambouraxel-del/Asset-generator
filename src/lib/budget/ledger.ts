import "server-only";

/**
 * Registre serveur des dépenses et des appels en vol.
 *
 * ---------------------------------------------------------------------------
 * DEUX IMPLÉMENTATIONS, UNE SEULE INTERFACE
 * ---------------------------------------------------------------------------
 * `MemoryLedger` est le défaut : il fonctionne sans aucune configuration
 * externe, mais il est PROPRE À CHAQUE INSTANCE et disparaît au redémarrage.
 * Il rend donc le plafond indicatif, et `isStrict` vaut `false` pour que
 * l'interface puisse le dire honnêtement.
 *
 * L'implémentation Supabase (`lib/supabase/spendLedger.ts`) partage un compteur
 * unique et rend le plafond réellement contraignant ; `isStrict` vaut alors
 * `true`. Le basculement est automatique dès que la base est configurée.
 * ---------------------------------------------------------------------------
 */

export interface LedgerSnapshot {
  /**
   * Dépense retenue pour le plafond : coûts mesurés PLUS estimations des
   * générations au coût inconnu.
   *
   * Sans ce cumul, une API qui ne remonte aucun usage rendrait le plafond
   * inopérant : le compteur resterait à zéro pendant qu'on dépense réellement.
   * On préfère retenir l'estimation réservée — approximative mais du bon côté.
   */
  recordedUsd: number;
  /** Part réellement mesurée (usage remonté × tarif connu). */
  measuredUsd: number;
  /** Part estimée, faute de coût mesurable. À afficher comme telle. */
  estimatedUsd: number;
  inFlightUsd: number;
  /** Générations dont le coût n'a pas pu être calculé. Jamais compté comme 0. */
  unknownCostCount: number;
  generations: number;
}

export interface SpendLedger {
  /** `true` seulement si le registre est partagé et durable. */
  readonly isStrict: boolean;
  read(ownerId: string): Promise<LedgerSnapshot>;
  /** Réserve un montant pour un appel en cours. Renvoie l'identifiant à libérer. */
  reserve(ownerId: string, amountUsd: number, requestId: string): Promise<void>;
  /** Libère la réservation et enregistre le coût réel (ou son absence). */
  settle(
    ownerId: string,
    requestId: string,
    outcome: { costUsd: number | null; counted: boolean },
  ): Promise<void>;
  /** Libère une réservation sans rien enregistrer (échec avant facturation). */
  release(ownerId: string, requestId: string): Promise<void>;
}

interface OwnerState {
  measuredUsd: number;
  estimatedUsd: number;
  unknownCostCount: number;
  generations: number;
  reservations: Map<string, number>;
}

/**
 * Registre en mémoire. Volontairement simple : il ne prétend rien garantir
 * au-delà d'une instance.
 */
export class MemoryLedger implements SpendLedger {
  readonly isStrict = false;
  private readonly owners = new Map<string, OwnerState>();

  private stateOf(ownerId: string): OwnerState {
    let state = this.owners.get(ownerId);
    if (state === undefined) {
      state = {
        measuredUsd: 0,
        estimatedUsd: 0,
        unknownCostCount: 0,
        generations: 0,
        reservations: new Map(),
      };
      this.owners.set(ownerId, state);
    }
    return state;
  }

  async read(ownerId: string): Promise<LedgerSnapshot> {
    const state = this.stateOf(ownerId);
    let inFlightUsd = 0;
    for (const amount of state.reservations.values()) inFlightUsd += amount;
    return {
      recordedUsd: state.measuredUsd + state.estimatedUsd,
      measuredUsd: state.measuredUsd,
      estimatedUsd: state.estimatedUsd,
      inFlightUsd,
      unknownCostCount: state.unknownCostCount,
      generations: state.generations,
    };
  }

  async reserve(ownerId: string, amountUsd: number, requestId: string): Promise<void> {
    this.stateOf(ownerId).reservations.set(requestId, Math.max(0, amountUsd));
  }

  async settle(
    ownerId: string,
    requestId: string,
    outcome: { costUsd: number | null; counted: boolean },
  ): Promise<void> {
    const state = this.stateOf(ownerId);
    // Le montant réservé sert de repli quand le coût réel reste inconnu.
    const reserved = state.reservations.get(requestId) ?? 0;
    state.reservations.delete(requestId);
    if (!outcome.counted) return;

    state.generations += 1;
    if (outcome.costUsd === null) {
      /*
       * Coût inconnu. On ne le compte SURTOUT PAS comme zéro : l'appel a bien
       * eu lieu et a bien coûté quelque chose. On retient donc l'estimation
       * réservée, et on la comptabilise à part pour que l'interface puisse
       * dire « estimé » et non « mesuré ».
       */
      state.unknownCostCount += 1;
      state.estimatedUsd += reserved;
    } else {
      state.measuredUsd += outcome.costUsd;
    }
  }

  async release(ownerId: string, requestId: string): Promise<void> {
    this.stateOf(ownerId).reservations.delete(requestId);
  }

  /** Réservé aux tests : repart d'un registre vierge. */
  reset(): void {
    this.owners.clear();
  }
}

/** Instance partagée du processus courant. */
export const memoryLedger = new MemoryLedger();
