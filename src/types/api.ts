/**
 * Contrat partagé entre le navigateur et les routes API.
 * Aucun secret ne transite par ces types.
 */

import type { ErrorCode } from "@/lib/errors";
import type { TokenUsage } from "@/types/domain";

/** Réponse de POST /api/generate en cas de succès. */
export interface GenerateSuccessResponse {
  image: {
    /** Image encodée en base64 (sans préfixe `data:`). */
    base64: string;
    mimeType: string;
  };
  /** Demande ponctuelle telle qu'utilisée pour cette génération. */
  request: string;
  /** Prompt complet réellement envoyé au modèle (utile pour itérer). */
  prompt: string;
  meta: {
    model: string;
    /** Résolution réellement demandée à l'API, sous forme canonique. */
    size: string;
    quality: string;
    background: string;
    outputFormat: string;
    referenceCount: number;
    generatedAt: string;
    /** Catégorie utilisée, telle qu'injectée dans le prompt. */
    categoryName: string | null;
    /** Dimensions cibles de l'asset (contrainte de prompt, pas la résolution). */
    targetWidth: number | null;
    targetHeight: number | null;
    /** `null` si l'API n'a remonté aucune donnée de consommation. */
    usage: TokenUsage | null;
  };
}

/** Réponse d'erreur, commune à toutes les routes. */
export interface ApiErrorResponse {
  error: { code: ErrorCode; message: string };
}

/** Réponse de GET /api/status : état de configuration du serveur. */
export interface StatusResponse {
  /** `true` si OPENAI_API_KEY est définie côté serveur. La valeur n'est jamais exposée. */
  apiKeyConfigured: boolean;
  /** Mode maquette actif (aucun appel réel à OpenAI). */
  mockMode: boolean;
  model: string;
}
