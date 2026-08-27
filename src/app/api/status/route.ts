import { NextResponse } from "next/server";

import { getImageModel, isApiKeyConfigured, isMockMode } from "@/lib/openai/client";
import type { StatusResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * État de configuration du serveur.
 *
 * Permet à l'interface de prévenir l'utilisateur AVANT une génération si la
 * clé API manque. Ne renvoie jamais la clé, ni aucun fragment de celle-ci.
 */
export function GET() {
  const body: StatusResponse = {
    apiKeyConfigured: isApiKeyConfigured(),
    mockMode: isMockMode(),
    model: getImageModel(),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
