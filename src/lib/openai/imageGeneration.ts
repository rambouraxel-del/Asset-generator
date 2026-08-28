import "server-only";

import OpenAI, { toFile } from "openai";

import type { BackgroundMode, ImageQuality, OutputFormat } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { createTransparentImage } from "@/lib/image/pixels";
import { encodePng } from "@/lib/image/postProcessing";
import { getImageModel, getOpenAIClient, isMockMode } from "@/lib/openai/client";
import type { ValidatedReferenceImage } from "@/lib/validation/imageFile";
import type { TokenUsage } from "@/types/domain";

/**
 * Appel à l'API Images d'OpenAI.
 *
 * ---------------------------------------------------------------------------
 * AUCUNE MÉMOIRE ENTRE LES GÉNÉRATIONS
 * ---------------------------------------------------------------------------
 * Ce module est volontairement sans état : aucune variable de module ne
 * conserve de prompt, de réponse ou d'image. Chaque appel envoie exactement
 * le prompt fourni + les références fournies, et rien d'autre.
 * L'endpoint /v1/images est par nature "one-shot" : contrairement à l'API
 * Responses, il n'existe ni `conversation`, ni `previous_response_id`.
 * ---------------------------------------------------------------------------
 *
 * Deux endpoints sont utilisés selon le cas :
 *   - `images.edit`     lorsqu'au moins une référence est activée ;
 *     le modèle reçoit les références comme référentiel graphique
 *     (jusqu'à 16 images PNG / JPEG / WebP).
 *   - `images.generate` lorsqu'aucune référence n'est activée.
 *
 * Note : `input_fidelity` n'est volontairement pas transmis. `gpt-image-2`
 * traite déjà les images d'entrée en haute fidélité et rejette ce paramètre.
 */

export interface GenerateAssetImageParams {
  prompt: string;
  references: ValidatedReferenceImage[];
  /** « auto » ou « LARGEURxHAUTEUR », déjà validé par `validateImageSize`. */
  size: string;
  quality: ImageQuality;
  background: BackgroundMode;
  outputFormat: OutputFormat;
}

export interface GeneratedImage {
  /** Image encodee en base64 (les modèles GPT Image renvoient toujours du b64). */
  base64: string;
  mimeType: string;
  model: string;
  /** Consommation de jetons remontee par l'API, si disponible. */
  /**
   * Consommation de jetons remontée par l'API.
   * Chaque champ vaut `null` si l'API ne fournit pas la donnée : rien n'est
   * jamais estimé ni inventé à la place.
   */
  usage: TokenUsage | null;
}

const MIME_BY_FORMAT: Record<OutputFormat, string> = {
  png: "image/png",
  webp: "image/webp",
  jpeg: "image/jpeg",
};

export async function generateAssetImage(
  params: GenerateAssetImageParams,
): Promise<GeneratedImage> {
  const model = getImageModel();

  if (isMockMode()) {
    return buildMockImage(model, params.size);
  }

  const client = getOpenAIClient();

  // Options communes aux deux endpoints.
  const shared = {
    model,
    prompt: params.prompt,
    size: params.size,
    quality: params.quality,
    background: params.background,
    output_format: params.outputFormat,
    n: 1,
  } as const;

  try {
    const response =
      params.references.length > 0
        ? await client.images.edit({
            ...shared,
            image: await Promise.all(
              params.references.map((reference) =>
                toFile(toArrayBuffer(reference.bytes), reference.name, {
                  type: reference.mimeType,
                }),
              ),
            ),
          })
        : await client.images.generate(shared);

    const base64 = response.data?.[0]?.b64_json;
    if (!base64) {
      throw new AppError("NO_IMAGE_RETURNED", {
        detail: "OpenAI response contained no b64_json payload.",
      });
    }

    return {
      base64,
      mimeType: MIME_BY_FORMAT[params.outputFormat],
      model,
      usage: extractUsage(response.usage),
    };
  } catch (error) {
    throw translateOpenAIError(error);
  }
}

/**
 * Traduit le bloc `usage` de l'API en `TokenUsage`.
 *
 * Chaque champ absent devient `null` plutôt que 0 : l'interface doit pouvoir
 * distinguer « zéro jeton » de « donnée non fournie par l'API ».
 */
function extractUsage(usage: unknown): TokenUsage | null {
  if (typeof usage !== "object" || usage === null) return null;

  const record = usage as {
    output_tokens?: unknown;
    total_tokens?: unknown;
    input_tokens_details?: { text_tokens?: unknown; image_tokens?: unknown };
  };

  const details = record.input_tokens_details;

  return {
    textInputTokens: numberOrNull(details?.text_tokens),
    imageInputTokens: numberOrNull(details?.image_tokens),
    imageOutputTokens: numberOrNull(record.output_tokens),
    totalTokens: numberOrNull(record.total_tokens),
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `Uint8Array` -> `ArrayBuffer` sans copie superflue, accepté par `toFile`. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/**
 * Traduit une erreur du SDK en `AppError` (message utilisateur + code stable).
 * Le détail technique est conservé pour la console serveur uniquement.
 */
export function translateOpenAIError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new AppError("OPENAI_TIMEOUT", { detail: error.message });
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new AppError("NETWORK_ERROR", { detail: error.message });
  }
  if (error instanceof OpenAI.APIError) {
    const detail = `status=${String(error.status)} type=${String(error.type)} code=${String(error.code)} message=${error.message}`;

    if (error.status === 401 || error.status === 403) {
      return new AppError("OPENAI_AUTH", { detail });
    }
    if (error.status === 429) {
      return new AppError("OPENAI_RATE_LIMIT", { detail });
    }
    if (
      error.code === "moderation_blocked" ||
      error.code === "content_policy_violation"
    ) {
      return new AppError("OPENAI_CONTENT_FILTER", { detail });
    }
    if (error.status === 400 || error.status === 422) {
      // Une entrée refusée par l'API est le plus souvent une image invalide
      // ou un réglage non supporté par le modèle.
      return new AppError("OPENAI_ERROR", { detail });
    }
    return new AppError("OPENAI_ERROR", { detail });
  }

  return new AppError("UNKNOWN", {
    detail: error instanceof Error ? error.stack ?? error.message : String(error),
  });
}

/**
 * Image de test renvoyée quand MOCK_OPENAI est actif.
 *
 * C'est un VRAI PNG, aux dimensions réellement demandées, avec de larges
 * marges transparentes autour du motif. Le mode maquette exerce donc toute la
 * chaîne de post-traitement — détourage, réduction, recadrage — et pas
 * seulement l'interface.
 */
function buildMockImage(model: string, size: string): GeneratedImage {
  const { width, height } = parseMockSize(size);
  const image = createTransparentImage(width, height);

  // Disque centré occupant environ la moitié du cadre : le reste est
  // transparent, ce qui donne au détourage quelque chose à retirer.
  const centreX = width / 2;
  const centreY = height / 2;
  const radius = Math.min(width, height) * 0.25;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x + 0.5 - centreX;
      const dy = y + 0.5 - centreY;
      if (dx * dx + dy * dy > radius * radius) continue;

      const offset = (y * width + x) * 4;
      image.data[offset] = 56;
      image.data[offset + 1] = 189;
      image.data[offset + 2] = 248;
      image.data[offset + 3] = 255;
    }
  }

  return {
    base64: encodePng(image).toString("base64"),
    mimeType: "image/png",
    model: `${model} (mock)`,
    // Le mode maquette n'invente pas de consommation : il n'y en a pas eu.
    usage: null,
  };
}

/** Dimensions du PNG de test. « auto » retombe sur un carré standard. */
function parseMockSize(size: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) return { width: 1024, height: 1024 };
  return { width: Number(match[1]), height: Number(match[2]) };
}
