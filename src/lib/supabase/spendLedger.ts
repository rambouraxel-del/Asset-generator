import "server-only";

/**
 * Registre de dépense et idempotence adossés à Supabase.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CETTE IMPLÉMENTATION APPORTE
 * ---------------------------------------------------------------------------
 * Le registre en mémoire (`MemoryLedger`) est propre à chaque instance : deux
 * fonctions serverless traitant deux requêtes au même instant ont chacune leur
 * compteur, et le plafond ne veut rien dire.
 *
 * Ici, la lecture, la décision et l'écriture se font dans UNE transaction
 * Postgres avec verrou de ligne (fonctions `reserve_spend` / `settle_spend`).
 * La réservation est donc correcte entre instances, et l'idempotence repose sur
 * une contrainte de clé primaire — la base arbitre, pas l'application.
 *
 * ---------------------------------------------------------------------------
 * UNE PANNE N'EST PAS UN SUCCÈS
 * ---------------------------------------------------------------------------
 * Toute erreur remonte en `SupabaseUnavailableError`. Aucun repli silencieux
 * vers un compteur local : le garde bloque la génération plutôt que de laisser
 * dépenser sans contrôle.
 * ---------------------------------------------------------------------------
 */

import type { LedgerSnapshot, ReserveOutcome, SpendLedger } from "@/lib/budget/ledger";
import { asService, SupabaseUnavailableError } from "@/lib/supabase/rest";

interface RawSnapshot {
  recorded_usd: number | string;
  measured_usd: number | string;
  estimated_usd: number | string;
  in_flight_usd: number | string;
  unknown_cost_count: number;
  generations: number;
}

function toSnapshot(raw: RawSnapshot): LedgerSnapshot {
  return {
    recordedUsd: Number(raw.recorded_usd),
    measuredUsd: Number(raw.measured_usd),
    estimatedUsd: Number(raw.estimated_usd),
    inFlightUsd: Number(raw.in_flight_usd),
    unknownCostCount: Number(raw.unknown_cost_count),
    generations: Number(raw.generations),
  };
}

export class SupabaseLedger implements SpendLedger {
  /** Compteur partagé et durable : le plafond est réellement contraignant. */
  readonly isStrict = true;

  constructor(private readonly limitUsd: number | null) {}

  async read(ownerId: string): Promise<LedgerSnapshot> {
    const raw = await asService.rpc<RawSnapshot>("read_spend", { p_owner: ownerId });
    return toSnapshot(raw);
  }

  /**
   * Décide et réserve dans une seule transaction Postgres, verrou de ligne
   * compris : deux instances serverless simultanées ne peuvent pas franchir
   * ensemble le plafond.
   */
  async reserve(
    ownerId: string,
    amountUsd: number,
    requestId: string,
    limitUsd: number | null,
  ): Promise<ReserveOutcome> {
    const outcome = await asService.rpc<{
      allowed: boolean;
      duplicate: boolean;
      remaining_usd?: number | string;
    }>("reserve_spend", {
      p_owner: ownerId,
      p_request: requestId,
      p_amount: amountUsd,
      // Le plafond vient de la configuration serveur, jamais du client.
      p_limit: limitUsd ?? this.limitUsd,
    });

    if (!outcome.allowed) {
      return { allowed: false, remainingUsd: Number(outcome.remaining_usd ?? 0) };
    }
    return { allowed: true, remainingUsd: null };
  }

  async settle(
    ownerId: string,
    requestId: string,
    outcome: { costUsd: number | null; counted: boolean },
  ): Promise<void> {
    await asService.rpc("settle_spend", {
      p_owner: ownerId,
      p_request: requestId,
      p_cost: outcome.costUsd,
      p_counted: outcome.counted,
    });
  }

  async release(ownerId: string, requestId: string): Promise<void> {
    await asService.rpc("settle_spend", {
      p_owner: ownerId,
      p_request: requestId,
      p_cost: null,
      p_counted: false,
    });
  }
}

/** Refus du plafond, remonté depuis la base. */
export class SpendLimitReachedError extends Error {
  constructor(
    readonly remainingUsd: number,
    readonly requestedUsd: number,
  ) {
    super(
      `Plafond de dépense atteint : il reste $${remainingUsd.toFixed(4)} et cette génération réserve $${requestedUsd.toFixed(4)}.`,
    );
    this.name = "SpendLimitReachedError";
  }
}

/* -------------------------------------------------------------------------- */
/* Idempotence partagée                                                       */
/* -------------------------------------------------------------------------- */

export type SharedClaim =
  | { status: "claimed" }
  | { status: "in-progress" }
  | { status: "completed"; result: unknown }
  /** La clé appartient à un autre compte : jamais rejouée. */
  | { status: "forbidden" };

export class SupabaseIdempotency {
  readonly isStrict = true;

  async claim(key: string, ownerId: string): Promise<SharedClaim> {
    const raw = await asService.rpc<{ status: string; result?: unknown }>(
      "claim_idempotency",
      { p_key: key, p_owner: ownerId },
    );

    switch (raw.status) {
      case "claimed":
        return { status: "claimed" };
      case "completed":
        return { status: "completed", result: raw.result };
      case "forbidden":
        return { status: "forbidden" };
      default:
        return { status: "in-progress" };
    }
  }

  async complete(key: string, ownerId: string, result: unknown): Promise<void> {
    await asService.rpc("complete_idempotency", {
      p_key: key,
      p_owner: ownerId,
      p_result: result,
    });
  }

  async abandon(key: string, ownerId: string): Promise<void> {
    await asService.rpc("abandon_idempotency", { p_key: key, p_owner: ownerId });
  }
}

export { SupabaseUnavailableError };
