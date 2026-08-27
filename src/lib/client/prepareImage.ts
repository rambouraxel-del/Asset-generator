"use client";

/**
 * Preparation d'une image importee avant stockage local.
 *
 * Objectifs :
 *  - refuser tôt les formats et les poids non supportés (message clair) ;
 *  - réduire les images trop grandes côté navigateur, pour rester sous les
 *    plafonds de taille de requête et accelerer l'envoi.
 *
 * La réduction produit toujours du PNG afin de préserver la transparence,
 * essentielle pour des assets de jeu.
 */

import { ACCEPTED_IMAGE_MIME_TYPES, LIMITS, type AcceptedImageMimeType } from "@/lib/config";
import { AppError } from "@/lib/errors";

export interface PreparedImage {
  blob: Blob;
  mimeType: AcceptedImageMimeType;
  width: number;
  height: number;
}

function assertAccepted(type: string): asserts type is AcceptedImageMimeType {
  if (!(ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(type)) {
    throw new AppError("UNSUPPORTED_IMAGE_FORMAT", {
      detail: `Rejected client-side: ${type || "(unknown type)"}`,
    });
  }
}

export async function prepareReferenceImage(file: File): Promise<PreparedImage> {
  assertAccepted(file.type);

  if (file.size > LIMITS.MAX_IMPORT_BYTES) {
    throw new AppError("FILE_TOO_LARGE", {
      detail: `Rejected client-side: ${file.size} bytes.`,
    });
  }

  const bitmap = await decode(file);
  const maxEdge = Math.max(bitmap.width, bitmap.height);

  try {
    const needsResize =
      maxEdge > LIMITS.MAX_REFERENCE_EDGE || file.size > LIMITS.MAX_FILE_BYTES;

    if (!needsResize) {
      return {
        blob: file,
        mimeType: file.type,
        width: bitmap.width,
        height: bitmap.height,
      };
    }

    const scale = Math.min(1, LIMITS.MAX_REFERENCE_EDGE / maxEdge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new AppError("UNSUPPORTED_IMAGE_FORMAT", {
        detail: "Canvas 2D context unavailable.",
      });
    }
    // `imageSmoothingEnabled = false` préserve la netteté du pixel art.
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvasToBlob(canvas);

    if (blob.size > LIMITS.MAX_FILE_BYTES) {
      throw new AppError("FILE_TOO_LARGE", {
        detail: `Still ${blob.size} bytes after resizing.`,
      });
    }

    return { blob, mimeType: "image/png", width, height };
  } finally {
    bitmap.close();
  }
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch (error) {
    throw new AppError("UNSUPPORTED_IMAGE_FORMAT", {
      detail: `Could not decode "${file.name}": ${String(error)}`,
    });
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new AppError("UNSUPPORTED_IMAGE_FORMAT", { detail: "toBlob returned null." }));
    }, "image/png");
  });
}
