import "server-only";

import OpenAI from "openai";

import { DEFAULT_IMAGE_MODEL, DEFAULT_OPENAI_TIMEOUT_MS } from "@/lib/config";
import { AppError } from "@/lib/errors";

/**
 * Acces au SDK OpenAI - EXCLUSIVEMENT CÔTÉ SERVEUR.
 *
 * `server-only` fait echouer la compilation si ce module est importe depuis un
 * composant client : la clé API ne peut donc pas fuir dans le bundle navigateur.
 */

let cachedClient: OpenAI | null = null;

/** Indique si une clé API est configuree, sans jamais reveler sa valeur. */
export function isApiKeyConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
}

export function getTimeoutMs(): number {
  const raw = Number(process.env.OPENAI_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_OPENAI_TIMEOUT_MS;
}

/** Mode maquette : permet de tester l'interface sans appeler l'API. */
export function isMockMode(): boolean {
  return process.env.MOCK_OPENAI === "1" || process.env.MOCK_OPENAI === "true";
}

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError("MISSING_API_KEY", {
      detail: "Environment variable OPENAI_API_KEY is not set.",
    });
  }

  if (!cachedClient) {
    cachedClient = new OpenAI({
      apiKey,
      organization: process.env.OPENAI_ORG_ID?.trim() || undefined,
      project: process.env.OPENAI_PROJECT_ID?.trim() || undefined,
      timeout: getTimeoutMs(),
      maxRetries: 1,
    });
  }

  return cachedClient;
}
