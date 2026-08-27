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
  LIMITS,
  NAME_LIMITS,
  OUTPUT_FORMATS,
} from "@/lib/config";
import { AppError } from "@/lib/errors";
import { validateImageSize } from "@/lib/validation/imageSize";

/** Champ résolution : validé par les contraintes réelles du modèle. */
const sizeSchema = z.string().superRefine((value, ctx) => {
  const result = validateImageSize(value);
  if (!result.ok) {
    ctx.addIssue({ code: "custom", message: result.message, params: { kind: "size" } });
  }
});

export const generationInputSchema = z.object({
  context: z.string().max(LIMITS.CONTEXT_MAX_CHARS),
  request: z.string().trim().min(1).max(LIMITS.REQUEST_MAX_CHARS),
  size: sizeSchema,
  quality: z.enum(IMAGE_QUALITIES),
  background: z.enum(BACKGROUND_MODES),
  outputFormat: z.enum(OUTPUT_FORMATS),
  /* Contexte de catégorie : purement descriptif, injecté dans le prompt. */
  categoryName: z.string().max(NAME_LIMITS.CATEGORY_NAME_MAX_CHARS).nullable(),
  categoryRule: z.string().max(NAME_LIMITS.CATEGORY_RULE_MAX_CHARS),
  targetWidth: z.number().int().positive().max(100_000).nullable(),
  targetHeight: z.number().int().positive().max(100_000).nullable(),
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
  if (path === "size") {
    // Le message de `validateImageSize` est déjà rédigé pour l'utilisateur.
    throw new AppError("INVALID_SIZE", { detail, message: issue?.message });
  }
  if (issue?.code === "too_big") {
    throw new AppError("TEXT_TOO_LONG", { detail });
  }
  throw new AppError("INVALID_REQUEST", { detail });
}
