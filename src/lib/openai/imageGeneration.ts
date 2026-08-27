import "server-only";

import OpenAI, { toFile } from "openai";

import type {
  BackgroundMode,
  ImageQuality,
  ImageSize,
  OutputFormat,
} from "@/lib/config";
import { AppError } from "@/lib/errors";
import { getImageModel, getOpenAIClient, isMockMode } from "@/lib/openai/client";
import type { ValidatedReferenceImage } from "@/lib/validation/imageFile";

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
  size: ImageSize;
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
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
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
    return buildMockImage(model);
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
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  } catch (error) {
    throw translateOpenAIError(error);
  }
}

/** `Uint8Array` -> `ArrayBuffer` sans copie superflue, accepte par `toFile`. */
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
 * Image de test (damier 512x512) renvoyée quand MOCK_OPENAI est actif.
 * Permet de valider toute la chaîne sans consommer de crédits API.
 */
function buildMockImage(model: string): GeneratedImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#1f2937"/><circle cx="256" cy="256" r="150" fill="#38bdf8"/><rect x="156" y="356" width="200" height="24" rx="12" fill="#f8fafc"/></svg>`;
  return {
    base64: Buffer.from(svg, "utf8").toString("base64"),
    mimeType: "image/svg+xml",
    model: `${model} (mock)`,
    usage: undefined,
  };
}
