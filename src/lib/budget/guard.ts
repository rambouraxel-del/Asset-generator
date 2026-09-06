import "server-only";

/**
 * Garde commun aux routes de génération.
 *
 * ---------------------------------------------------------------------------
 * FERMÉ PAR DÉFAUT
 * ---------------------------------------------------------------------------
 * En mode réel, une génération n'est autorisée que si TOUT est en place :
 *
 *   1. un compte authentifié et vérifié auprès du fournisseur ;
 *   2. une liste d'autorisation configurée, et ce compte dedans ;
 *   3. un contrôle de budget PERSISTANT disponible ;
 *   4. la demande appartenant bien à ce compte et à son projet ;
 *   5. de la place sous le plafond, appels en vol compris.
 *
 * Si l'une manque, on REFUSE. En particulier, l'indisponibilité du registre
 * persistant bloque la génération : revenir en silence à un compteur en
 * mémoire donnerait l'illusion d'un plafond là où il n'y en a plus.
 *
 * Le mode maquette (`MOCK_OPENAI`) reste ouvert : il n'appelle aucun
 * fournisseur et ne coûte rien, donc il n'y a rien à protéger.
 * ---------------------------------------------------------------------------
 */

import { AppError } from "@/lib/errors";
import { authorizeGeneration, readAllowlist } from "@/lib/auth/allowlist";
import { resolveIdentity, type Identity } from "@/lib/auth/session";
import { IdempotencyStore } from "@/lib/budget/idempotency";
import { memoryLedger, type SpendLedger } from "@/lib/budget/ledger";
import { parseRequestKey } from "@/lib/generation/requestIntent";
import { isMockMode } from "@/lib/openai/client";
import { isSupabaseConfigured, readStatus } from "@/lib/supabase/config";
import {
  SupabaseIdempotency,
  SupabaseLedger,
  SupabaseUnavailableError,
} from "@/lib/supabase/spendLedger";

/**
 * Cache d'idempotence local.
 *
 * Employé UNIQUEMENT en mode maquette. En mode réel, l'idempotence passe par
 * la base : un cache par instance ne protégerait pas entre deux fonctions
 * serverless simultanées.
 */
export const generationIdempotency = new IdempotencyStore<unknown>();

/** Plafond serveur, en dollars. Absent = aucun plafond. */
export function readSpendLimit(): number | null {
  const raw = Number(process.env.GENERATION_SPEND_LIMIT_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * Coût réservé avant un appel, faute de connaître le coût réel à l'avance.
 *
 * Le coût exact n'est connu qu'APRÈS l'appel. On réserve donc une valeur haute
 * configurable, remplacée ensuite par le coût mesuré.
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
  /** Idempotence partagée, `null` en mode maquette. */
  shared: SupabaseIdempotency | null;
  projectId: string;
}

export interface GuardOptions {
  /** Clé d'idempotence fournie par le client. */
  idempotencyKey: string | null;
  /** Projet auquel la génération est rattachée. */
  projectId: string | null;
  /** Injection pour les tests. */
  ledger?: SpendLedger;
}

/**
 * `replay` signale que cette demande a DÉJÀ été payée et aboutie : on rend le
 * résultat conservé au lieu d'en facturer un second.
 */
export type GuardOutcome =
  | { kind: "proceed"; context: GuardContext }
  | { kind: "replay"; result: unknown };

/** Diagnostic de configuration, exposé par /api/status. */
export interface ReadinessReport {
  mockMode: boolean;
  authConfigured: boolean;
  allowlistConfigured: boolean;
  persistentBudget: boolean;
  /** `true` si une génération réelle est possible en l'état. */
  canGenerate: boolean;
  blockers: string[];
}

/**
 * Vérifie que le socle est en place, sans rien exposer de secret.
 * Sert à la fois au garde et à l'écran de statut.
 */
export function checkReadiness(): ReadinessReport {
  const mockMode = isMockMode();
  const authConfigured = isSupabaseConfigured();
  const allowlistConfigured = readAllowlist().length > 0;
  const persistentBudget = readStatus().serviceRole;

  const blockers: string[] = [];
  if (!mockMode) {
    if (!authConfigured) {
      blockers.push(
        "Authentification non configurée : renseignez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
    }
    if (!allowlistConfigured) {
      blockers.push(
        "Aucune liste d'autorisation : renseignez GENERATION_ALLOWLIST avec les comptes autorisés à dépenser.",
      );
    }
    if (!persistentBudget) {
      blockers.push(
        "Contrôle de budget non persistant : renseignez SUPABASE_SERVICE_ROLE_KEY pour que le plafond soit réellement appliqué.",
      );
    }
  }

  return {
    mockMode,
    authConfigured,
    allowlistConfigured,
    persistentBudget,
    canGenerate: blockers.length === 0,
    blockers,
  };
}

/**
 * Applique toutes les barrières.
 *
 * @throws {AppError} avec un message utilisateur clair à la première barrière
 *         qui refuse.
 */
export async function guardGeneration(
  request: Request,
  options: GuardOptions,
): Promise<GuardOutcome> {
  const readiness = checkReadiness();

  // 0. Socle. Fermé par défaut : une configuration incomplète bloque.
  if (!readiness.canGenerate) {
    throw new AppError("INVALID_REQUEST", {
      message: `Génération bloquée par sécurité : ${readiness.blockers[0]}`,
      detail: `Readiness blockers: ${readiness.blockers.join(" | ")}`,
    });
  }

  const mockMode = readiness.mockMode;

  // 1. Identité, vérifiée auprès du fournisseur.
  const identity = await resolveIdentity(request);
  if (identity === null) {
    throw new AppError("INVALID_REQUEST", {
      message: "Connectez-vous avant de lancer une génération.",
      detail: "No verified identity on the request.",
    });
  }
  if (!mockMode && !identity.verified) {
    throw new AppError("INVALID_REQUEST", {
      message: "Votre session n'est pas valide. Reconnectez-vous.",
      detail: "Unverified identity refused in real mode.",
    });
  }

  // 2. Autorisation de dépense. S'inscrire ne suffit pas.
  const verdict = authorizeGeneration(identity.email ?? identity.ownerId);
  if (!verdict.allowed) {
    throw new AppError("INVALID_REQUEST", {
      message: verdict.reason,
      detail: `Generation refused for ${identity.ownerId}.`,
    });
  }

  const projectId = options.projectId?.trim() || "sans-projet";

  // 3. Propriété : la clé doit désigner CE compte et CE projet.
  const requestId = options.idempotencyKey?.trim() || null;
  if (requestId !== null) {
    const parsed = parseRequestKey(requestId);
    if (parsed === null) {
      throw new AppError("INVALID_REQUEST", {
        message: "Demande mal formée. Rechargez la page et réessayez.",
        detail: `Malformed idempotency key: ${requestId.slice(0, 40)}`,
      });
    }
    // Un rejeu croisé vers un autre compte ou un autre projet est refusé ici,
    // avant même de consulter le cache de résultats.
    if (parsed.ownerId !== identity.ownerId || parsed.projectId !== projectId) {
      throw new AppError("INVALID_REQUEST", {
        message: "Cette demande n'appartient pas à votre compte ou à ce projet.",
        detail: `Key owner/project mismatch for ${identity.ownerId}.`,
      });
    }
  }

  const effectiveRequestId = requestId ?? `${identity.ownerId}:${projectId}:${Date.now()}`;

  // 4. Registre. En mode réel, il DOIT être persistant.
  const limit = readSpendLimit();
  let ledger: SpendLedger;
  let shared: SupabaseIdempotency | null = null;

  if (options.ledger !== undefined) {
    ledger = options.ledger;
  } else if (mockMode) {
    ledger = memoryLedger;
  } else {
    ledger = new SupabaseLedger(limit);
    shared = new SupabaseIdempotency();
  }

  // 5. Idempotence, partagée entre instances en mode réel.
  if (requestId !== null) {
    try {
      if (shared !== null) {
        const claim = await shared.claim(effectiveRequestId, identity.ownerId);
        if (claim.status === "forbidden") {
          throw new AppError("INVALID_REQUEST", {
            message: "Cette demande appartient à un autre compte.",
            detail: "Cross-account idempotency replay refused.",
          });
        }
        if (claim.status === "in-progress") throw duplicateError(effectiveRequestId);
        if (claim.status === "completed") {
          return { kind: "replay", result: claim.result };
        }
      } else {
        const claim = generationIdempotency.claim(effectiveRequestId);
        if (claim.status === "in-progress") throw duplicateError(effectiveRequestId);
        if (claim.status === "completed") {
          return { kind: "replay", result: claim.value };
        }
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailableError(error, "le contrôle des doubles soumissions");
    }
  }

  // 6. Budget. La DÉCISION APPARTIENT AU REGISTRE : la lire ici pour décider
  // ensuite rouvrirait la fenêtre entre lecture et réservation.
  const reserve = readReservationEstimate();
  try {
    const outcome = await ledger.reserve(
      identity.ownerId,
      reserve,
      effectiveRequestId,
      limit,
    );

    if (!outcome.allowed) {
      await releaseClaim(shared, effectiveRequestId, identity.ownerId);
      throw new AppError("INVALID_REQUEST", {
        message: `Plafond de dépense atteint : il reste $${outcome.remainingUsd.toFixed(4)} et cette génération réserve $${reserve.toFixed(4)}. Relevez le plafond ou attendez sa réinitialisation.`,
        detail: "Spend limit refusal.",
      });
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    await releaseClaim(shared, effectiveRequestId, identity.ownerId);
    throw unavailableError(error, "le contrôle de budget");
  }

  return {
    kind: "proceed",
    context: {
      identity,
      requestId: effectiveRequestId,
      ledger,
      strictLimit: ledger.isStrict,
      shared,
      projectId,
    },
  };
}

/**
 * Clôt une génération : libère la réservation et enregistre le coût réel.
 *
 * `costUsd === null` signifie COÛT INCONNU, jamais zéro.
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
    if (context.shared !== null) {
      await context.shared.complete(
        context.requestId,
        context.identity.ownerId,
        outcome.result,
      );
    } else {
      generationIdempotency.complete(context.requestId, outcome.result);
    }
  }
}

/** Abandonne une génération qui n'a rien coûté (échec avant facturation). */
export async function abandonGeneration(context: GuardContext): Promise<void> {
  await context.ledger.release(context.identity.ownerId, context.requestId);
  await releaseClaim(context.shared, context.requestId, context.identity.ownerId);
}

async function releaseClaim(
  shared: SupabaseIdempotency | null,
  key: string,
  ownerId: string,
): Promise<void> {
  if (shared !== null) {
    await shared.abandon(key, ownerId).catch(() => undefined);
  } else {
    generationIdempotency.abandon(key);
  }
}

function duplicateError(key: string): AppError {
  return new AppError("INVALID_REQUEST", {
    message:
      "Cette même génération est déjà en cours. Attendez son résultat plutôt que de la relancer — un second envoi serait facturé. Pour obtenir un rendu différent, utilisez « Générer une nouvelle variante ».",
    detail: `Duplicate submission for key ${key}.`,
  });
}

/**
 * Une indisponibilité ne doit jamais dégrader en silence vers un contrôle
 * local : mieux vaut refuser la génération que dépenser sans garde-fou.
 */
function unavailableError(error: unknown, what: string): AppError {
  const detail = error instanceof SupabaseUnavailableError ? error.message : String(error);
  return new AppError("INVALID_REQUEST", {
    message: `Génération bloquée : ${what} est indisponible. Réessayez dans un instant — aucune dépense n'a été engagée.`,
    detail: `Persistent control unavailable: ${detail}`,
  });
}
