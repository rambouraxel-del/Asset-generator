/**
 * Validation des champs texte et des réglages d'une demande de génération.
 *
 * Le même schéma est utilisable côté client (retour immédiat) et côté serveur
 * (source de vérité : on ne fait jamais confiance au navigateur).
 */

import { z } from "zod";

import {
  BACKGROUND_MODES,
  IMAGE_QUALITIES,
  IMAGE_SIZES,
  LIMITS,
  OUTPUT_FORMATS,
} from "@/lib/config";
import { AppError } from "@/lib/errors";

export const generationInputSchema = z.object({
  context: z.string().max(LIMITS.CONTEXT_MAX_CHARS),
  request: z.string().trim().min(1).max(LIMITS.REQUEST_MAX_CHARS),
  size: z.enum(IMAGE_SIZES),
  quality: z.enum(IMAGE_QUALITIES),
  background: z.enum(BACKGROUND_MODES),
  outputFormat: z.enum(OUTPUT_FORMATS),
});

export type GenerationInput = z.infer<typeof generationInputSchema>;

/**
 * Valide les champs texte/réglages et traduit toute erreur Zod en `AppError`
 * porteuse d'un message utilisateur compréhensible.
 */
export function parseGenerationInput(raw: unknown): GenerationInput {
  const result = generationInputSchema.safeParse(raw);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  const path = issue?.path.join(".") ?? "";
  const detail = `Invalid field "${path}": ${issue?.message ?? "unknown"}`;

  if (path === "request" && issue?.code === "too_small") {
    throw new AppError("EMPTY_REQUEST", { detail });
  }
  if (issue?.code === "too_big") {
    throw new AppError("TEXT_TOO_LONG", { detail });
  }
  throw new AppError("INVALID_REQUEST", { detail });
}
