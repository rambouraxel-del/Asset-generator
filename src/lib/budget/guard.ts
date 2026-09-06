import "server-only";

/**
 * Garde commun aux routes de génération.
 *
 * ---------------------------------------------------------------------------
 * QUATRE BARRIÈRES, DANS CET ORDRE
 * ---------------------------------------------------------------------------
 *   1. IDENTITÉ    — qui appelle ? (vérifiée auprès du fournisseur)
 *   2. AUTORISATION — ce compte a-t-il le droit de dépenser ? S'inscrire ne
 *                     suffit pas.
 *   3. IDEMPOTENCE — cette demande est-elle déjà partie depuis un autre onglet ?
 *   4. BUDGET      — reste-t-il de la place sous le plafond, appels en vol
 *                    compris ?
 *
 * L'ordre compte : on refuse au plus tôt et au moins cher. Aucune de ces
 * vérifications n'a lieu dans le navigateur seul — toutes sont refaites ici,
 * car le client peut mentir.
 *
 * Rien dans ce module ne relance un appel ni ne monte en qualité tout seul :
 * une génération refusée est refusée, elle n'est pas retentée à un tarif
 * supérieur.
 * ---------------------------------------------------------------------------
 */

import { AppError } from "@/lib/errors";
import { authorizeGeneration } from "@/lib/auth/allowlist";
import { resolveIdentity, type Identity } from "@/lib/auth/session";
import { IdempotencyStore } from "@/lib/budget/idempotency";
import { memoryLedger, type SpendLedger } from "@/lib/budget/ledger";
import { decideSpend } from "@/lib/budget/spendLimit";

/** Cache d'idempotence partagé par les deux routes de génération. */
export const generationIdempotency = new IdempotencyStore<unknown>();

/** Plafond serveur, en dollars. Absent = aucun plafond. */
export function readSpendLimit(): number | null {
  const raw = Number(process.env.GENERATION_SPEND_LIMIT_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * Coût réservé avant un appel, faute de mieux.
 *
 * Le coût réel n'est connu qu'APRÈS l'appel. On réserve donc une valeur haute
 * configurable, remplacée ensuite par le coût mesuré. Sans elle, deux appels
 * simultanés pourraient franchir le plafond ensemble.
 */
export function readReservationEstimate(): number {
  const raw = Number(process.env.GENERATION_ESTIMATED_COST_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.1;
}

export interface GuardContext {
  identity: Identity;
  requestId: string;
  ledger: SpendLedger;
  /** `true` si le plafond est réellement contraignant (registre partagé). */
  strictLimit: boolean;
}

export interface GuardOptions {
  /** Clé d'idempotence fournie par le client. */
  idempotencyKey: string | null;
  ledger?: SpendLedger;
}

/**
 * Résultat du garde.
 *
 * `replay` signale que cette demande a DÉJÀ été payée et aboutie : on rend le
 * résultat conservé au lieu d'en facturer un second. C'est le cas du second
 * onglet, du double-clic ou du rechargement pendant l'appel.
 */
export type GuardOutcome =
  | { kind: "proceed"; context: GuardContext }
  | { kind: "replay"; result: unknown };

/**
 * Applique les quatre barrières.
 *
 * @throws {AppError} avec un message utilisateur clair à la première barrière
 *         qui refuse.
 */
export async function guardGeneration(
  request: Request,
  options: GuardOptions,
): Promise<GuardOutcome> {
  const ledger = options.ledger ?? memoryLedger;

  // 1. Identité.
  const identity = await resolveIdentity(request);
  if (identity === null) {
    throw new AppError("INVALID_REQUEST", {
      message: "Connectez-vous avant de lancer une génération.",
      detail: "No verified identity on the request.",
    });
  }

  // 2. Autorisation de dépense.
  const verdict = authorizeGeneration(identity.email ?? identity.ownerId);
  if (!verdict.allowed) {
    throw new AppError("INVALID_REQUEST", {
      message: verdict.reason,
      detail: `Generation refused for ${identity.ownerId}.`,
    });
  }

  // 3. Idempotence : une même demande ne part pas deux fois.
  const requestId = options.idempotencyKey?.trim() || `${identity.ownerId}:${Date.now()}`;
  if (options.idempotencyKey) {
    const claim = generationIdempotency.claim(requestId);
    if (claim.status === "in-progress") {
      throw new AppError("INVALID_REQUEST", {
        message:
          "Cette même génération est déjà en cours dans un autre onglet. Attendez son résultat plutôt que de la relancer — un second envoi serait facturé.",
        detail: `Duplicate submission for key ${requestId}.`,
      });
    }
    // Déjà payée et aboutie : on rend le résultat, on ne refacture pas.
    if (claim.status === "completed") {
      return { kind: "replay", result: claim.value };
    }
  }

  // 4. Budget, appels en vol compris.
  const snapshot = await ledger.read(identity.ownerId);
  const reserve = readReservationEstimate();
  const decision = decideSpend(
    {
      limitUsd: readSpendLimit(),
      recordedUsd: snapshot.recordedUsd,
      inFlightUsd: snapshot.inFlightUsd,
    },
    reserve,
  );

  if (!decision.allowed) {
    generationIdempotency.abandon(requestId);
    throw new AppError("INVALID_REQUEST", {
      message: decision.message,
      detail: `Spend limit refusal: ${decision.reason}.`,
    });
  }

  await ledger.reserve(identity.ownerId, decision.reservedUsd, requestId);

  return {
    kind: "proceed",
    context: { identity, requestId, ledger, strictLimit: ledger.isStrict },
  };
}

/**
 * Clôt une génération : libère la réservation et enregistre le coût réel.
 *
 * `costUsd === null` signifie COÛT INCONNU, jamais zéro : le registre le
 * comptabilise à part pour que l'interface puisse l'afficher honnêtement.
 */
export async function settleGeneration(
  context: GuardContext,
  outcome: { costUsd: number | null; counted: boolean; result?: unknown },
): Promise<void> {
  await context.ledger.settle(context.identity.ownerId, context.requestId, {
    costUsd: outcome.costUsd,
    counted: outcome.counted,
  });
  if (outcome.result !== undefined) {
    generationIdempotency.complete(context.requestId, outcome.result);
  }
}

/** Abandonne une génération qui n'a rien coûté (échec avant facturation). */
export async function abandonGeneration(context: GuardContext): Promise<void> {
  await context.ledger.release(context.identity.ownerId, context.requestId);
  generationIdempotency.abandon(context.requestId);
}
