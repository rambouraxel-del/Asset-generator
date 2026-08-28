import { NextResponse } from "next/server";

import { LIMITS } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { isApiKeyConfigured } from "@/lib/openai/client";
import { generateAssetImage } from "@/lib/openai/imageGeneration";
import { buildAssetPrompt } from "@/lib/prompt/assetPrompt";
import {
  parseGenerationInput,
  type GenerationInput,
} from "@/lib/validation/generationInput";
import {
  validateReferenceBytes,
  validateReferenceSet,
  type ValidatedReferenceImage,
} from "@/lib/validation/imageFile";
import { chooseGenerationSize } from "@/lib/generation/generationSizing";
import {
  apiQualityFor,
  describeQualityMode,
  resolveQualityMode,
  type QualityMode,
} from "@/lib/generation/qualityMode";
import {
  postProcessToFinalSize,
  type PostProcessReport,
} from "@/lib/image/postProcessing";
import { normalizeImageSize } from "@/lib/validation/imageSize";
import type { GenerateSuccessResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * La génération d'image peut prendre plus d'une minute en qualite haute.
 * Selon l'offre d'hébergement, la plateforme peut appliquer un plafond
 * inferieur (voir README).
 */
export const maxDuration = 300;

/**
 * POST /api/generate
 *
 * ---------------------------------------------------------------------------
 * SEUL POINT DE CONTACT AVEC OPENAI
 * ---------------------------------------------------------------------------
 * La clé API n'est lue que dans ce chemin d'exécution, côté serveur. Elle
 * n'apparait jamais dans le bundle navigateur ni dans les reponses.
 *
 * ---------------------------------------------------------------------------
 * AUCUNE MÉMOIRE ENTRE LES GÉNÉRATIONS
 * ---------------------------------------------------------------------------
 * Cette route est totalement sans état : rien n'est stocke entre deux appels
 * (pas de session, pas de cache, pas d'historique, pas de fichier écrit).
 * Le corps envoyé à OpenAI se limite strictement à :
 *     contexte permanent + références activées + demande actuelle.
 * Une image générée n'est jamais reinjectee dans un appel suivant.
 * ---------------------------------------------------------------------------
 *
 * Corps attendu : multipart/form-data
 *   - context        : string (contexte du Style Pack, peut être vide)
 *   - request        : string (demande ponctuelle, obligatoire)
 *   - categoryName   : string (nom de la catégorie, ou vide)
 *   - categoryRule   : string (règle textuelle de la catégorie, ou vide)
 *   - targetWidth    : string (dimension cible de l'asset, ou vide)
 *   - targetHeight   : string (dimension cible de l'asset, ou vide)
 *   - size/quality/background/outputFormat : réglages de génération
 *   - references     : 0 à 16 fichiers image (PNG / JPEG / WebP)
 *
 * Noter la distinction : `targetWidth`/`targetHeight` décrivent l'emprise de
 * l'asset et ne servent qu'au prompt, tandis que `size` est la résolution
 * réellement demandée à l'API.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!isApiKeyConfigured() && process.env.MOCK_OPENAI !== "1") {
      throw new AppError("MISSING_API_KEY", {
        detail: "Rejected before calling OpenAI: OPENAI_API_KEY is not set.",
      });
    }

    const formData = await readFormData(request);

    const input = parseGenerationInput({
      context: readString(formData, "context"),
      request: readString(formData, "request"),
      size: readString(formData, "size"),
      quality: readString(formData, "quality"),
      background: readString(formData, "background"),
      outputFormat: readString(formData, "outputFormat"),
      categoryName: readOptionalString(formData, "categoryName"),
      categoryRule: readString(formData, "categoryRule"),
      targetWidth: readOptionalInteger(formData, "targetWidth"),
      targetHeight: readOptionalInteger(formData, "targetHeight"),
      finalWidth: readOptionalInteger(formData, "finalWidth"),
      finalHeight: readOptionalInteger(formData, "finalHeight"),
      qualityMode: readString(formData, "qualityMode") || "auto",
    });

    const plan = planGeneration(input);

    const references = await readReferences(formData);
    validateReferenceSet(references);

    // Le prompt est assemble ici et nulle part ailleurs (cf. lib/prompt).
    const prompt = buildAssetPrompt({
      context: input.context,
      categoryName: input.categoryName,
      targetWidth: input.targetWidth,
      targetHeight: input.targetHeight,
      categoryRule: input.categoryRule,
      finalWidth: input.finalWidth,
      finalHeight: input.finalHeight,
      request: input.request,
      referenceCount: references.length,
      background: input.background,
    });

    const image = await generateAssetImage({
      prompt,
      references,
      size: plan.size,
      quality: plan.apiQuality,
      background: input.background,
      // Le post-traitement travaille sur du PNG : quand une taille finale est
      // demandée, on impose ce format à l'API (il est de toute façon le bon
      // choix pour un asset de jeu : sans perte et avec transparence).
      outputFormat: plan.postProcess ? "png" : input.outputFormat,
    });

    // Post-traitement local : aucun appel réseau, aucun jeton consommé.
    const delivered = plan.postProcess
      ? applyPostProcessing(image.base64, plan.finalWidth, plan.finalHeight)
      : { base64: image.base64, mimeType: image.mimeType, report: null };

    // Journal serveur volontairement minimal : ni prompt, ni image, ni clé.
    // Journal serveur volontairement minimal : ni prompt, ni image, ni clé.
    console.info(
      `[generate] ok model=${image.model} references=${references.length} size=${plan.size} quality=${plan.apiQuality}` +
        (plan.postProcess ? ` final=${plan.finalWidth}x${plan.finalHeight}` : "") +
        (delivered.report
          ? ` colours=${delivered.report.metrics.colourCount} alphas=${delivered.report.metrics.alphaLevelCount} verdict=${delivered.report.metrics.verdict}`
          : "") +
        (image.usage?.totalTokens != null ? ` tokens=${image.usage.totalTokens}` : ""),
    );

    const body: GenerateSuccessResponse = {
      image: { base64: delivered.base64, mimeType: delivered.mimeType },
      request: input.request,
      prompt,
      meta: {
        model: image.model,
        size: plan.size,
        quality: plan.apiQuality,
        background: input.background,
        outputFormat: plan.postProcess ? "png" : input.outputFormat,
        referenceCount: references.length,
        generatedAt: new Date().toISOString(),
        categoryName: input.categoryName,
        targetWidth: input.targetWidth,
        targetHeight: input.targetHeight,
        finalWidth: plan.postProcess ? plan.finalWidth : null,
        finalHeight: plan.postProcess ? plan.finalHeight : null,
        qualityMode: input.qualityMode,
        qualityModeLabel: plan.qualityLabel,
        generationSize: plan.size,
        minimalResolution: plan.minimalResolution,
        postProcessing: delivered.report,
        usage: image.usage,
      },
    };

    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const appError =
      error instanceof AppError ? error : new AppError("UNKNOWN", { detail: String(error) });

    // Les détails techniques restent côté serveur.
    console.error(`[generate] ${appError.code}: ${appError.detail ?? appError.message}`);

    return NextResponse.json(appError.toResponseBody(), {
      status: appError.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

/**
 * Plan d'exécution d'une génération : quelle résolution demander à l'API,
 * quelle qualité, et faut-il post-traiter.
 *
 * Toute la décision est prise ici, à partir des seules entrées de la requête.
 * Aucun état, aucun historique, aucune génération précédente n'y intervient.
 */
function planGeneration(input: GenerationInput) {
  const wantsFinalSize = input.finalWidth !== null && input.finalHeight !== null;

  if (!wantsFinalSize) {
    // Régime hérité de la V0.2 : réglages manuels, rendu brut livré tel quel.
    return {
      postProcess: false as const,
      size: normalizeImageSize(input.size),
      apiQuality: input.quality,
      qualityLabel: null,
      minimalResolution: false,
      finalWidth: 0,
      finalHeight: 0,
    };
  }

  const finalWidth = input.finalWidth as number;
  const finalHeight = input.finalHeight as number;

  const resolvedMode = resolveQualityMode(
    input.qualityMode as QualityMode,
    finalWidth,
    finalHeight,
  );
  const choice = chooseGenerationSize(finalWidth, finalHeight, resolvedMode);

  if (choice === null) {
    throw new AppError("INVALID_SIZE", {
      detail: `No valid generation size for final ${finalWidth}x${finalHeight}.`,
      message:
        "Aucune résolution de génération ne correspond à cette taille finale. Rapprochez les deux côtés l'un de l'autre.",
    });
  }

  return {
    postProcess: true as const,
    size: choice.size,
    apiQuality: apiQualityFor(resolvedMode),
    qualityLabel: describeQualityMode(input.qualityMode as QualityMode, resolvedMode),
    minimalResolution: choice.minimal,
    finalWidth,
    finalHeight,
  };
}

/**
 * Ramène le rendu de l'API à la taille finale exacte.
 *
 * Le post-traitement ne doit jamais faire échouer une génération déjà payée :
 * en cas d'imprévu, on livre le rendu brut et on le signale dans le journal
 * serveur plutôt que de perdre le résultat.
 */
function applyPostProcessing(
  base64: string,
  finalWidth: number,
  finalHeight: number,
): { base64: string; mimeType: string; report: PostProcessReport | null } {
  try {
    const result = postProcessToFinalSize(Buffer.from(base64, "base64"), {
      finalWidth,
      finalHeight,
    });
    return {
      base64: result.buffer.toString("base64"),
      mimeType: "image/png",
      report: result.report,
    };
  } catch (error) {
    console.error(`[generate] post-processing failed, raw image kept: ${String(error)}`);
    return { base64, mimeType: "image/png", report: null };
  }
}

async function readFormData(request: Request): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw new AppError("INVALID_REQUEST", {
      detail: `Unexpected content-type: ${contentType || "(none)"}`,
    });
  }

  try {
    return await request.formData();
  } catch (error) {
    // Un corps tronqué par un plafond de plateforme atterrit typiquement ici.
    throw new AppError("PAYLOAD_TOO_LARGE", {
      detail: `Could not parse multipart body: ${String(error)}`,
    });
  }
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Chaîne vide et champ absent valent tous deux « non renseigné ». */
function readOptionalString(formData: FormData, key: string): string | null {
  const value = readString(formData, key).trim();
  return value === "" ? null : value;
}

function readOptionalInteger(formData: FormData, key: string): number | null {
  const raw = readOptionalString(formData, key);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function readReferences(formData: FormData): Promise<ValidatedReferenceImage[]> {
  const entries = formData.getAll("references");

  if (entries.length > LIMITS.MAX_REFERENCES) {
    throw new AppError("TOO_MANY_REFERENCES", {
      detail: `${entries.length} reference entries received.`,
    });
  }

  const references: ValidatedReferenceImage[] = [];

  for (const [index, entry] of entries.entries()) {
    if (typeof entry === "string") {
      throw new AppError("INVALID_REQUEST", {
        detail: `Reference #${index} is not a file.`,
      });
    }

    if (entry.size > LIMITS.MAX_FILE_BYTES) {
      throw new AppError("FILE_TOO_LARGE", {
        detail: `Reference "${entry.name}" is ${entry.size} bytes.`,
      });
    }

    const bytes = new Uint8Array(await entry.arrayBuffer());
    references.push(
      validateReferenceBytes(entry.name || `reference-${index + 1}`, entry.type, bytes),
    );
  }

  return references;
}
