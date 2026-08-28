/**
 * Contrat partagé entre le navigateur et les routes API.
 * Aucun secret ne transite par ces types.
 */

import type { ErrorCode } from "@/lib/errors";
import type { PostProcessReport } from "@/lib/image/postProcessing";
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
    /** Dimensions du PNG réellement livré. `null` si le rendu brut est livré. */
    finalWidth: number | null;
    finalHeight: number | null;
    /** Mode qualité demandé, et son libellé une fois « Auto » résolu. */
    qualityMode: string;
    qualityModeLabel: string | null;
    /** Résolution réellement demandée au modèle. */
    generationSize: string;
    /** `true` si c'était la plus petite résolution compatible. */
    minimalResolution: boolean;
    /** Mode pixel art demandé (V0.2.3). */
    pixelPipeline: string;
    /** `true` si la résolution retenue permet une vraie grille logique. */
    logicalGridReady: boolean;
    /** Compte rendu du post-traitement local, `null` s'il n'a pas eu lieu. */
    postProcessing: PostProcessReport | null;
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
