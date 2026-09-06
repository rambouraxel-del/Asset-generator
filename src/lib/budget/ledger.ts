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

/** Verdict d'une réservation. */
export type ReserveOutcome =
  | { allowed: true; remainingUsd: number | null }
  | { allowed: false; remainingUsd: number };

export interface SpendLedger {
  /** `true` seulement si le registre est partagé et durable. */
  readonly isStrict: boolean;
  read(ownerId: string): Promise<LedgerSnapshot>;
  /**
   * Décide ET réserve en une seule opération indivisible.
   *
   * C'est le point crucial : séparer « lire le compteur » de « poser la
   * réservation » laisse une fenêtre pendant laquelle plusieurs appels
   * simultanés lisent tous « il reste de la place » et passent ensemble. La
   * décision doit donc appartenir au registre, jamais à l'appelant.
   */
  reserve(
    ownerId: string,
    amountUsd: number,
    requestId: string,
    limitUsd: number | null,
  ): Promise<ReserveOutcome>;
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

  /**
   * Décision et réservation sans `await` intermédiaire.
   *
   * JavaScript n'interrompt pas une fonction entre deux instructions
   * synchrones : lire les compteurs puis poser la réservation d'un seul tenant
   * est donc réellement indivisible ici, et trois appels concurrents ne peuvent
   * plus franchir ensemble le plafond.
   */
  async reserve(
    ownerId: string,
    amountUsd: number,
    requestId: string,
    limitUsd: number | null,
  ): Promise<ReserveOutcome> {
    const state = this.stateOf(ownerId);
    const amount = Math.max(0, amountUsd);

    // Une réservation déjà posée sous cette clé n'est pas doublée.
    if (state.reservations.has(requestId)) {
      return { allowed: true, remainingUsd: limitUsd };
    }

    if (limitUsd !== null) {
      let inFlight = 0;
      for (const value of state.reservations.values()) inFlight += value;
      const engaged = state.measuredUsd + state.estimatedUsd + inFlight;
      const remaining = limitUsd - engaged;

      if (remaining <= 0 || amount > remaining) {
        return { allowed: false, remainingUsd: Math.max(0, remaining) };
      }
    }

    state.reservations.set(requestId, amount);
    return {
      allowed: true,
      remainingUsd: limitUsd === null ? null : limitUsd - amount,
    };
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
