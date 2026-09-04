"use client";

/**
 * Appel de la route /api/generate-sheet depuis le navigateur.
 *
 * Comme pour un asset unique, la requête est un instantané complet et autonome :
 * ni résultat précédent, ni historique, ni contenu de bibliothèque autre que le
 * seul sprite maître explicitement désigné par l'utilisateur.
 */

import { AppError, isErrorCode, userMessageFor } from "@/lib/errors";
import type { CharacterSheetRequest } from "@/lib/generation/sheetPayload";
import type { ApiErrorResponse, GenerateSheetSuccessResponse } from "@/types/api";

export async function requestCharacterSheet(
  payload: CharacterSheetRequest,
  signal?: AbortSignal,
): Promise<GenerateSheetSuccessResponse> {
  const formData = new FormData();
  formData.set("context", payload.context);
  formData.set("request", payload.request);
  formData.set("categoryName", payload.categoryName ?? "");
  formData.set("categoryRule", payload.categoryRule);
  formData.set("qualityMode", payload.qualityMode);
  formData.set("masterDirection", payload.masterDirection);
  formData.set("generateRightSeparately", payload.generateRightSeparately ? "1" : "0");
  formData.set("matchMasterPalette", payload.matchMasterPalette ? "1" : "0");
  formData.set("master", payload.master, payload.masterName);

  for (const reference of payload.references) {
    formData.append("references", reference.blob, reference.name);
  }

  let response: Response;
  try {
    response = await fetch("/api/generate-sheet", { method: "POST", body: formData, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AppError("NETWORK_ERROR", { detail: String(error) });
  }

  if (!response.ok) throw await toAppError(response);

  return (await response.json()) as GenerateSheetSuccessResponse;
}

async function toAppError(response: Response): Promise<AppError> {
  try {
    const body = (await response.json()) as ApiErrorResponse;
    const code = body?.error?.code;
    if (isErrorCode(code)) {
      return new AppError(code, { message: body.error.message || userMessageFor(code) });
    }
  } catch {
    // Corps non JSON : message générique plutôt qu'une exception opaque.
  }

  if (response.status === 413) return new AppError("PAYLOAD_TOO_LARGE");
  if (response.status === 504) return new AppError("OPENAI_TIMEOUT");
  return new AppError("UNKNOWN", { detail: `HTTP ${response.status}` });
}
