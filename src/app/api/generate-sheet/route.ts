import { NextResponse } from "next/server";

import { CHARACTER_SHEET, LIMITS } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { isApiKeyConfigured } from "@/lib/openai/client";
import { generateAssetImage } from "@/lib/openai/imageGeneration";
import { buildAssetPrompt } from "@/lib/prompt/assetPrompt";
import { chooseGenerationSize } from "@/lib/generation/generationSizing";
import {
  apiQualityFor,
  describeQualityMode,
  resolveQualityMode,
  QUALITY_MODES,
  type QualityMode,
} from "@/lib/generation/qualityMode";
import {
  CharacterCellError,
  deriveGeometryFromMaster,
} from "@/lib/character/cellAlignment";
import {
  DIRECTIONS,
  DIRECTION_LABELS,
  sheetSize,
  type Direction,
} from "@/lib/character/sheetLayout";
import {
  decodeMaster,
  runSheetPipeline,
  toBase64Png,
  upscaleMasterForModel,
} from "@/lib/character/sheetPipeline";
import { overallStatus } from "@/lib/character/sheetValidation";
import {
  readBoolean,
  readFormData,
  readOptionalString,
  readString,
} from "@/lib/validation/formData";
import {
  validateReferenceBytes,
  validateReferenceSet,
  type ValidatedReferenceImage,
} from "@/lib/validation/imageFile";
import type { GenerateSheetSuccessResponse, SheetCellResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Facteur d'agrandissement du maître avant envoi au modèle.
 *
 * Un sprite de 48 × 48 px transmis tel quel est illisible pour le modèle. ×9
 * le porte à 432 × 432 px, soit exactement l'échelle à laquelle chaque cellule
 * apparaîtra dans le rendu de 864 × 864 px : le modèle voit le maître à la
 * taille où il doit le redessiner.
 */
const MASTER_UPSCALE = 9;

/**
 * POST /api/generate-sheet
 *
 * ---------------------------------------------------------------------------
 * MÊMES GARANTIES QUE /api/generate
 * ---------------------------------------------------------------------------
 * Clé API lue côté serveur uniquement. Route sans état : rien n'est conservé
 * entre deux appels. Le corps envoyé à OpenAI se limite au contexte permanent,
 * aux références explicitement activées, au sprite maître explicitement choisi
 * par l'utilisateur et à la demande courante.
 *
 * Le SPRITE MAÎTRE arrive par un champ dédié `master`, jamais par le canal des
 * références de style. C'est un choix délibéré : l'utilisateur peut désigner un
 * asset de sa bibliothèque comme maître, et cet asset ne doit pour autant
 * jamais devenir une référence de style ni transiter par `assertStyleReference`.
 * Le contenu de la bibliothèque n'est JAMAIS transmis automatiquement : seul le
 * fichier unique que l'utilisateur a explicitement désigné part avec la requête.
 * ---------------------------------------------------------------------------
 *
 * Corps attendu : multipart/form-data
 *   - master                 : 1 fichier PNG, exactement 48 × 48 px
 *   - masterDirection        : down | up | left | right
 *   - context / request / categoryName / categoryRule
 *   - qualityMode            : auto | eco | standard | high
 *   - generateRightSeparately: « 1 » pour générer le profil droit
 *   - matchMasterPalette     : « 1 » (défaut) pour rapprocher les palettes
 *   - references             : 0 à 15 références de style activées
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!isApiKeyConfigured() && process.env.MOCK_OPENAI !== "1") {
      throw new AppError("MISSING_API_KEY", {
        detail: "Rejected before calling OpenAI: OPENAI_API_KEY is not set.",
      });
    }

    const formData = await readFormData(request);

    const cellSize = CHARACTER_SHEET.CELL_SIZE;
    const sheet = sheetSize(cellSize);

    const userRequest = readString(formData, "request").trim();
    if (userRequest.length === 0) {
      throw new AppError("INVALID_REQUEST", { detail: "Empty request." });
    }
    if (userRequest.length > LIMITS.REQUEST_MAX_CHARS) {
      throw new AppError("INVALID_REQUEST", {
        detail: `Request is ${userRequest.length} characters.`,
      });
    }

    const masterDirection = parseDirection(readString(formData, "masterDirection"));
    const masterPng = await readMaster(formData);
    const generateRightSeparately = readBoolean(formData, "generateRightSeparately");
    const matchMasterPalette = readBoolean(
      formData,
      "matchMasterPalette",
      CHARACTER_SHEET.MATCH_MASTER_PALETTE,
    );

    /*
     * Le maître est décodé ET sa géométrie dérivée AVANT tout appel réseau.
     * Un maître aux mauvaises dimensions ou sans pixel visible est rejeté ici,
     * donc gratuitement : ces deux erreurs ne doivent jamais coûter une
     * génération à l'utilisateur.
     */
    const master = decodeMaster(masterPng, cellSize);
    deriveGeometryFromMaster(master.image, cellSize);

    const qualityMode = parseQualityMode(readString(formData, "qualityMode"));
    const resolvedMode = resolveQualityMode(qualityMode, sheet.width, sheet.height);
    const choice = chooseGenerationSize(sheet.width, sheet.height, resolvedMode);
    if (choice === null) {
      throw new AppError("INVALID_SIZE", {
        detail: `No valid generation size for a ${sheet.width}x${sheet.height} sheet.`,
      });
    }

    const references = await readReferences(formData);

    /*
     * Le maître part en TÊTE des images d'entrée : c'est la référence
     * principale, celle dont le modèle doit reproduire l'identité. Les
     * références de style du pack complètent le cadrage graphique.
     */
    const masterImage: ValidatedReferenceImage = {
      name: "master.png",
      mimeType: "image/png",
      bytes: new Uint8Array(upscaleMasterForModel(master.image, MASTER_UPSCALE)),
    };
    const inputImages = [masterImage, ...references];
    validateReferenceSet(inputImages);

    const prompt = buildAssetPrompt({
      context: readString(formData, "context"),
      categoryName: readOptionalString(formData, "categoryName"),
      categoryRule: readString(formData, "categoryRule"),
      finalWidth: sheet.width,
      finalHeight: sheet.height,
      logicalGridScale: choice.logicalGridReady ? choice.scaleX : null,
      request: userRequest,
      referenceCount: inputImages.length,
      background: "transparent",
      characterSheet: true,
    });

    const image = await generateAssetImage({
      prompt,
      references: inputImages,
      size: choice.size,
      quality: apiQualityFor(resolvedMode),
      background: "transparent",
      outputFormat: "png",
    });

    const result = runSheetPipeline({
      masterPng,
      masterDirection,
      generatedPng: Buffer.from(image.base64, "base64"),
      generateRightSeparately,
      matchMasterPalette,
      cellSize,
    });

    const cells: SheetCellResponse[] = DIRECTIONS.map((direction) => {
      const cell = result.cells[direction];
      return {
        direction,
        label: DIRECTION_LABELS[direction],
        base64: toBase64Png(cell.image),
        origin: cell.origin,
        alignment: cell.alignment,
        validation: {
          status: cell.validation.status,
          issues: cell.validation.issues,
          metrics: {
            canvasWidth: cell.validation.metrics.canvasWidth,
            canvasHeight: cell.validation.metrics.canvasHeight,
            bounds: cell.validation.metrics.bounds,
            centreX: cell.validation.metrics.centreX,
            feetY: cell.validation.metrics.feetY,
            visualHeight: cell.validation.metrics.visualHeight,
            colourCount: cell.validation.metrics.colourCount,
            alphaLevelCount: cell.validation.metrics.alphaLevelCount,
            visiblePixels: cell.validation.metrics.visiblePixels,
            semiTransparentPixels: cell.validation.metrics.semiTransparentPixels,
            binaryAlpha: cell.validation.metrics.binaryAlpha,
          },
        },
      };
    });

    const status = overallStatus(
      DIRECTIONS.map((direction) => result.cells[direction].validation),
    );

    // Journal serveur volontairement minimal : ni prompt, ni image, ni clé.
    console.info(
      `[generate-sheet] ok model=${image.model} size=${choice.size} master=${masterDirection}` +
        ` grid=x${result.report.scaleX} fidelity=${Math.round(result.report.gridStats.fidelity * 100)}%` +
        ` status=${status}` +
        (image.usage?.totalTokens != null ? ` tokens=${image.usage.totalTokens}` : ""),
    );

    const body: GenerateSheetSuccessResponse = {
      cells,
      sheet: {
        base64: toBase64Png(result.sheet),
        width: result.sheet.width,
        height: result.sheet.height,
      },
      prompt,
      request: userRequest,
      notices: result.notices,
      meta: {
        model: image.model,
        generatedAt: new Date().toISOString(),
        cellSize,
        masterDirection,
        generatedDirections: result.generatedDirections,
        mirroredRight: !generateRightSeparately,
        matchMasterPalette,
        geometry: {
          cellSize: result.geometry.cellSize,
          centreX: result.geometry.centreX,
          feetY: result.geometry.feetY,
          visualHeight: result.geometry.visualHeight,
          matchesStandardFeetLine: result.geometry.matchesStandardFeetLine,
        },
        generationSize: choice.size,
        quality: apiQualityFor(resolvedMode),
        qualityMode,
        qualityModeLabel: describeQualityMode(qualityMode, resolvedMode),
        referenceCount: references.length,
        grid: {
          scaleX: result.report.scaleX,
          scaleY: result.report.scaleY,
          clean: result.report.logicalGridClean,
          method: result.report.blockMethod,
          fidelity: result.report.gridStats.fidelity,
        },
        overallStatus: status,
        usage: image.usage,
      },
    };

    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Une planche inexploitable est une erreur utilisateur, pas une panne :
    // elle mérite un message clair plutôt qu'un « erreur inconnue ».
    const appError =
      error instanceof CharacterCellError
        ? new AppError("INVALID_REQUEST", { message: error.message, detail: error.message })
        : error instanceof AppError
          ? error
          : new AppError("UNKNOWN", { detail: String(error) });

    console.error(
      `[generate-sheet] ${appError.code}: ${appError.detail ?? appError.message}`,
    );

    return NextResponse.json(appError.toResponseBody(), {
      status: appError.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

function parseDirection(value: string): Direction {
  if ((DIRECTIONS as readonly string[]).includes(value)) return value as Direction;
  throw new AppError("INVALID_REQUEST", {
    detail: `Unknown master direction: ${value || "(none)"}`,
    message: "Indiquez l'orientation que représente le sprite maître.",
  });
}

/** Mode qualité inconnu ou absent : « auto » plutôt qu'une erreur bloquante. */
function parseQualityMode(value: string): QualityMode {
  return (QUALITY_MODES as readonly string[]).includes(value)
    ? (value as QualityMode)
    : "auto";
}

/** Lit le sprite maître : un fichier, obligatoire, et rien d'autre. */
async function readMaster(formData: FormData): Promise<Buffer> {
  const entries = formData.getAll("master");

  if (entries.length === 0) {
    throw new AppError("INVALID_REQUEST", {
      message: "Aucun sprite maître : importez un PNG ou choisissez un asset de la bibliothèque.",
      detail: "No master file in the request.",
    });
  }
  if (entries.length > 1) {
    throw new AppError("INVALID_REQUEST", {
      message: "Un seul sprite maître est attendu.",
      detail: `${entries.length} master entries received.`,
    });
  }

  const entry = entries[0];
  if (typeof entry === "string") {
    throw new AppError("INVALID_REQUEST", { detail: "Master field is not a file." });
  }
  if (entry.size > LIMITS.MAX_FILE_BYTES) {
    throw new AppError("FILE_TOO_LARGE", { detail: `Master is ${entry.size} bytes.` });
  }

  const bytes = new Uint8Array(await entry.arrayBuffer());
  // Passe par la validation commune : type déclaré ET signature réelle.
  const validated = validateReferenceBytes(entry.name || "master.png", entry.type, bytes);
  if (validated.mimeType !== "image/png") {
    throw new AppError("UNSUPPORTED_IMAGE_FORMAT", {
      message: "Le sprite maître doit être un PNG (seul format garantissant une transparence exacte).",
      detail: `Master mime type is ${validated.mimeType}.`,
    });
  }

  return Buffer.from(bytes);
}

async function readReferences(formData: FormData): Promise<ValidatedReferenceImage[]> {
  const entries = formData.getAll("references");

  // Une place est réservée au maître dans le lot envoyé au modèle.
  if (entries.length > LIMITS.MAX_REFERENCES - 1) {
    throw new AppError("TOO_MANY_REFERENCES", {
      detail: `${entries.length} reference entries received (max ${LIMITS.MAX_REFERENCES - 1} with a master).`,
    });
  }

  const references: ValidatedReferenceImage[] = [];

  for (const [index, entry] of entries.entries()) {
    if (typeof entry === "string") {
      throw new AppError("INVALID_REQUEST", { detail: `Reference #${index} is not a file.` });
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
