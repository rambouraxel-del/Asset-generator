"use client";

/**
 * Lecture d'un sprite maître côté navigateur.
 *
 * ---------------------------------------------------------------------------
 * LE MAÎTRE N'EST JAMAIS RÉENCODÉ ICI
 * ---------------------------------------------------------------------------
 * Contrairement aux références de style (voir `prepareImage.ts`, qui redimensionne
 * les images trop grandes), le maître est transmis EXACTEMENT tel que
 * l'utilisateur l'a fourni. Ce module se contente de le mesurer et de refuser
 * tôt ce qui ne conviendrait pas : c'est ce qui garantit qu'il ressortira
 * identique au pixel près.
 * ---------------------------------------------------------------------------
 */

import { CHARACTER_SHEET, LIMITS } from "@/lib/config";
import { AppError } from "@/lib/errors";

export interface MasterSprite {
  /** Octets d'origine, non retouchés. */
  blob: Blob;
  name: string;
  width: number;
  height: number;
  /** Origine du maître, affichée à l'utilisateur. */
  source: "import" | "bibliothèque";
}

/**
 * Vérifie et mesure un maître.
 *
 * @throws {AppError} si le fichier n'est pas un PNG, s'il est trop lourd, ou
 *         s'il n'a pas exactement les dimensions d'une cellule.
 */
export async function readMasterSprite(
  blob: Blob,
  name: string,
  source: MasterSprite["source"],
  cellSize: number = CHARACTER_SHEET.CELL_SIZE,
): Promise<MasterSprite> {
  if (blob.type !== "image/png") {
    throw new AppError("UNSUPPORTED_IMAGE_FORMAT", {
      message:
        "Le sprite maître doit être un PNG : c'est le seul format qui garantit une transparence exacte.",
      detail: `Master type is ${blob.type || "(unknown)"}.`,
    });
  }

  if (blob.size > LIMITS.MAX_FILE_BYTES) {
    throw new AppError("FILE_TOO_LARGE", { detail: `Master is ${blob.size} bytes.` });
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (error) {
    throw new AppError("UNSUPPORTED_IMAGE_FORMAT", {
      message: "Ce PNG n'a pas pu être lu.",
      detail: `Could not decode master "${name}": ${String(error)}`,
    });
  }

  const { width, height } = bitmap;
  bitmap.close();

  if (width !== cellSize || height !== cellSize) {
    throw new AppError("INVALID_REQUEST", {
      message: `Le sprite maître fait ${width} × ${height} px. Une cellule de planche fait ${cellSize} × ${cellSize} px : redimensionnez-le avant de l'importer.`,
      detail: `Master is ${width}x${height}, expected ${cellSize}x${cellSize}.`,
    });
  }

  return { blob, name, width, height, source };
}
