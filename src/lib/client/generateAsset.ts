"use client";

/**
 * Appel de la route /api/generate depuis le navigateur.
 *
 * ---------------------------------------------------------------------------
 * AUCUNE MÉMOIRE ENTRE LES GÉNÉRATIONS
 * ---------------------------------------------------------------------------
 * `GenerationRequest` est un instantané complet et autonome de ce qui doit
 * être envoyé. Il ne contient ni résultat précédent, ni historique. Le bouton
 * "Regenerer" reutilise exactement le même instantané : le nouvel appel est
 * donc identique au premier, et la génération précédente n'est jamais
 * transmise à OpenAI.
 * ---------------------------------------------------------------------------
 */

import type { GenerationSettings } from "@/lib/storage/context";
import { AppError, isErrorCode, userMessageFor } from "@/lib/errors";
import type { ApiErrorResponse, GenerateSuccessResponse } from "@/types/api";

/** Référence prête à être envoyée : nom + contenu binaire, rien d'autre. */
export interface OutgoingReference {
  name: string;
  blob: Blob;
}

/** Instantane immuable d'une demande de génération. */
export interface GenerationRequest {
  context: string;
  request: string;
  settings: GenerationSettings;
  references: OutgoingReference[];
}

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

  for (const reference of payload.references) {
    formData.append("references", reference.blob, reference.name);
  }

  let response: Response;
  try {
    response = await fetch("/api/generate", {
      method: "POST",
      body: formData,
      signal,
    });
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
