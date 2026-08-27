import { NextResponse } from "next/server";

import { LIMITS } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { isApiKeyConfigured } from "@/lib/openai/client";
import { generateAssetImage } from "@/lib/openai/imageGeneration";
import { buildAssetPrompt } from "@/lib/prompt/assetPrompt";
import { parseGenerationInput } from "@/lib/validation/generationInput";
import {
  validateReferenceBytes,
  validateReferenceSet,
  type ValidatedReferenceImage,
} from "@/lib/validation/imageFile";
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
 *   - context      : string (règles permanentes, peut être vide)
 *   - request      : string (demande ponctuelle, obligatoire)
 *   - size/quality/background/outputFormat : réglages de génération
 *   - références   : 0 à 16 fichiers image (PNG / JPEG / WebP)
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
    });

    const references = await readReferences(formData);
    validateReferenceSet(references);

    // Le prompt est assemble ici et nulle part ailleurs (cf. lib/prompt).
    const prompt = buildAssetPrompt({
      context: input.context,
      request: input.request,
      referenceCount: references.length,
      background: input.background,
    });

    const image = await generateAssetImage({
      prompt,
      references,
      size: input.size,
      quality: input.quality,
      background: input.background,
      outputFormat: input.outputFormat,
    });

    // Journal serveur volontairement minimal : ni prompt, ni image, ni clé.
    console.info(
      `[generate] ok model=${image.model} references=${references.length} size=${input.size} quality=${input.quality}` +
        (image.usage ? ` tokens=${image.usage.totalTokens}` : ""),
    );

    const body: GenerateSuccessResponse = {
      image: { base64: image.base64, mimeType: image.mimeType },
      request: input.request,
      prompt,
      meta: {
        model: image.model,
        size: input.size,
        quality: input.quality,
        background: input.background,
        outputFormat: input.outputFormat,
        referenceCount: references.length,
        generatedAt: new Date().toISOString(),
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
