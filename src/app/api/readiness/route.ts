import { NextResponse } from "next/server";

import { checkReadiness, readSpendLimit } from "@/lib/budget/guard";
import { resolveIdentity } from "@/lib/auth/session";
import { memoryLedger } from "@/lib/budget/ledger";
import { getImageModel } from "@/lib/openai/client";
import { SupabaseLedger } from "@/lib/supabase/spendLedger";
import type { ReadinessResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/readiness
 *
 * Dit à l'interface ce que le serveur peut RÉELLEMENT faire, et pourquoi il ne
 * le peut pas le cas échéant.
 *
 * ---------------------------------------------------------------------------
 * AUCUN SECRET NE SORT D'ICI
 * ---------------------------------------------------------------------------
 * La réponse ne contient que des booléens, des compteurs et des messages. La
 * clé API, la clé de service et le contenu de la liste d'autorisation ne sont
 * jamais exposés : seule leur PRÉSENCE l'est.
 * ---------------------------------------------------------------------------
 */
export async function GET(request: Request): Promise<NextResponse> {
  const readiness = checkReadiness();
  const limit = readSpendLimit();

  // Les compteurs sont ceux du compte connecté, et de lui seul.
  let spend: ReadinessResponse["spend"] = null;
  let strictLimit = false;

  try {
    const identity = await resolveIdentity(request);
    if (identity !== null) {
      const ledger = readiness.persistentBudget
        ? new SupabaseLedger(limit)
        : memoryLedger;
      strictLimit = ledger.isStrict;
      const snapshot = await ledger.read(identity.ownerId);
      spend = {
        recordedUsd: snapshot.recordedUsd,
        measuredUsd: snapshot.measuredUsd,
        estimatedUsd: snapshot.estimatedUsd,
        inFlightUsd: snapshot.inFlightUsd,
        unknownCostCount: snapshot.unknownCostCount,
        generations: snapshot.generations,
      };
    }
  } catch {
    // Compteur indisponible : on renvoie `null` plutôt que des zéros, qui
    // feraient croire à une dépense nulle. La génération, elle, sera bloquée
    // par le garde — ce n'est pas à cet écran de décider.
    spend = null;
  }

  const body: ReadinessResponse = {
    mockMode: readiness.mockMode,
    model: getImageModel(),
    authConfigured: readiness.authConfigured,
    allowlistConfigured: readiness.allowlistConfigured,
    persistentBudget: readiness.persistentBudget,
    canGenerate: readiness.canGenerate,
    blockers: readiness.blockers,
    spendLimitUsd: limit,
    strictLimit,
    spend,
  };

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
