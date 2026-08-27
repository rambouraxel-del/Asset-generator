/**
 * Validation des fichiers image.
 *
 * La vérification ne se contente pas du champ `type` déclaré par le
 * navigateur (facilement falsifiable) : les premiers octets du fichier sont
 * inspectés pour confirmer le format réel.
 */

import {
  ACCEPTED_IMAGE_MIME_TYPES,
  LIMITS,
  type AcceptedImageMimeType,
} from "@/lib/config";
import { AppError } from "@/lib/errors";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function isAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/** Déduit le type réel à partir des octets d'en-tête, ou `null` si inconnu. */
export function sniffImageMimeType(bytes: Uint8Array): AcceptedImageMimeType | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
  if (startsWith(bytes, JPEG_SIGNATURE)) return "image/jpeg";
  if (isAscii(bytes, 0, "RIFF") && isAscii(bytes, 8, "WEBP")) return "image/webp";
  return null;
}

export function isAcceptedMimeType(value: string): value is AcceptedImageMimeType {
  return (ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export interface ValidatedReferenceImage {
  name: string;
  mimeType: AcceptedImageMimeType;
  bytes: Uint8Array;
}

/**
 * Valide une référence reçue par le serveur : taille, type déclaré, type réel.
 * Lève une `AppError` porteuse d'un message utilisateur en cas de problème.
 */
export function validateReferenceBytes(
  name: string,
  declaredMimeType: string,
  bytes: Uint8Array,
): ValidatedReferenceImage {
  if (bytes.byteLength === 0) {
    throw new AppError("UNSUPPORTED_IMAGE_FORMAT", {
      detail: `Reference "${name}" is empty.`,
    });
  }

  if (bytes.byteLength > LIMITS.MAX_FILE_BYTES) {
    throw new AppError("FILE_TOO_LARGE", {
      detail: `Reference "${name}" is ${bytes.byteLength} bytes (max ${LIMITS.MAX_FILE_BYTES}).`,
    });
  }

  const actualMimeType = sniffImageMimeType(bytes);
  if (actualMimeType === null) {
    throw new AppError("UNSUPPORTED_IMAGE_FORMAT", {
      detail: `Reference "${name}" has an unrecognised signature (declared: ${declaredMimeType}).`,
    });
  }

  if (declaredMimeType && !isAcceptedMimeType(declaredMimeType)) {
    throw new AppError("UNSUPPORTED_IMAGE_FORMAT", {
      detail: `Reference "${name}" declares unsupported type ${declaredMimeType}.`,
    });
  }

  return { name, mimeType: actualMimeType, bytes };
}

/** Vérifie le nombre et le poids cumulé des références d'une requête. */
export function validateReferenceSet(references: ValidatedReferenceImage[]): void {
  if (references.length > LIMITS.MAX_REFERENCES) {
    throw new AppError("TOO_MANY_REFERENCES", {
      detail: `${references.length} references received (max ${LIMITS.MAX_REFERENCES}).`,
    });
  }

  const totalBytes = references.reduce((sum, ref) => sum + ref.bytes.byteLength, 0);
  if (totalBytes > LIMITS.MAX_TOTAL_BYTES) {
    throw new AppError("PAYLOAD_TOO_LARGE", {
      detail: `Total reference payload is ${totalBytes} bytes (max ${LIMITS.MAX_TOTAL_BYTES}).`,
    });
  }
}
