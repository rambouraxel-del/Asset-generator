"use client";

/**
 * Appel de la route /api/generate depuis le navigateur.
 *
 * ---------------------------------------------------------------------------
 * AUCUNE MÉMOIRE ENTRE LES GÉNÉRATIONS
 * ---------------------------------------------------------------------------
 * `GenerationRequest` (voir `lib/generation/payload.ts`) est un instantané
 * complet et autonome. Il ne contient ni résultat précédent, ni historique, ni
 * asset de bibliothèque. Le bouton « Régénérer » réutilise exactement le même
 * instantané : le nouvel appel est donc identique au premier.
 * ---------------------------------------------------------------------------
 */

import { AppError, isErrorCode, userMessageFor } from "@/lib/errors";
import type { GenerationRequest } from "@/lib/generation/payload";
import type { ApiErrorResponse, GenerateSuccessResponse } from "@/types/api";

export async function requestGeneration(
  payload: GenerationRequest,
  signal?: AbortSignal,
): Promise<GenerateSuccessResponse> {
  const formData = new FormData();
  formData.set("context", payload.context);
  formData.set("request", payload.request);
  formData.set("size", payload.settings.size);
  formData.set("quality", payload.settings.quality);
  formData.set("background", payload.settings.background);
  formData.set("outputFormat", payload.settings.outputFormat);
  formData.set("categoryName", payload.categoryName ?? "");
  formData.set("categoryRule", payload.categoryRule);
  formData.set("targetWidth", payload.targetWidth === null ? "" : String(payload.targetWidth));
  formData.set(
    "targetHeight",
    payload.targetHeight === null ? "" : String(payload.targetHeight),
  );

  // Taille finale de l'asset livré : c'est elle qui déclenche le
  // post-traitement local et le calcul automatique de la résolution.
  const finalSize = payload.settings.finalSizeEnabled
    ? { width: payload.settings.finalWidth, height: payload.settings.finalHeight }
    : null;
  formData.set("finalWidth", finalSize === null ? "" : String(finalSize.width));
  formData.set("finalHeight", finalSize === null ? "" : String(finalSize.height));
  formData.set("qualityMode", payload.settings.qualityMode);

  for (const reference of payload.references) {
    formData.append("references", reference.blob, reference.name);
  }

  let response: Response;
  try {
    response = await fetch("/api/generate", { method: "POST", body: formData, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AppError("NETWORK_ERROR", { detail: String(error) });
  }

  if (!response.ok) {
    throw await toAppError(response);
  }

  return (await response.json()) as GenerateSuccessResponse;
}

async function toAppError(response: Response): Promise<AppError> {
  try {
    const body = (await response.json()) as ApiErrorResponse;
    const code = body?.error?.code;
    if (isErrorCode(code)) {
      return new AppError(code, { message: body.error.message || userMessageFor(code) });
    }
  } catch {
    // Corps non JSON (page d'erreur d'un proxy, plafond de taille de la
    // plateforme, etc.) : on retombe sur un message générique.
  }

  if (response.status === 413) return new AppError("PAYLOAD_TOO_LARGE");
  if (response.status === 504) return new AppError("OPENAI_TIMEOUT");
  return new AppError("UNKNOWN", { detail: `HTTP ${response.status}` });
}
