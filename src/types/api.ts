/**
 * Contrat partagé entre le navigateur et les routes API.
 * Aucun secret ne transite par ces types.
 */

import type { ErrorCode } from "@/lib/errors";

/** Reponse de POST /api/generate en cas de succes. */
export interface GenerateSuccessResponse {
  image: {
    /** Image encodee en base64 (sans préfixe `data:`). */
    base64: string;
    mimeType: string;
  };
  /** Demande ponctuelle telle qu'utilisée pour cette génération. */
  request: string;
  /** Prompt complet réellement envoyé au modèle (utile pour iterer). */
  prompt: string;
  meta: {
    model: string;
    size: string;
    quality: string;
    background: string;
    outputFormat: string;
    referenceCount: number;
    generatedAt: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  };
}

/** Réponse d'erreur, commune à toutes les routes. */
export interface ApiErrorResponse {
  error: { code: ErrorCode; message: string };
}

/** Reponse de GET /api/status : état de configuration du serveur. */
export interface StatusResponse {
  /** `true` si OPENAI_API_KEY est definie côté serveur. La valeur n'est jamais exposee. */
  apiKeyConfigured: boolean;
  /** Mode maquette actif (aucun appel réel à OpenAI). */
  mockMode: boolean;
  model: string;
}
