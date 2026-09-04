/**
 * Lecture d'un corps `multipart/form-data`, partagée par les routes API.
 *
 * Extrait de la route de génération pour être réutilisé par la planche de
 * personnage : les deux routes doivent traiter un champ absent, une chaîne
 * vide et un corps tronqué exactement de la même manière.
 */

import { AppError } from "@/lib/errors";

export async function readFormData(request: Request): Promise<FormData> {
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

export function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Chaîne vide et champ absent valent tous deux « non renseigné ». */
export function readOptionalString(formData: FormData, key: string): string | null {
  const value = readString(formData, key).trim();
  return value === "" ? null : value;
}

export function readOptionalInteger(formData: FormData, key: string): number | null {
  const raw = readOptionalString(formData, key);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Coche à l'ancienne : « 1 » ou « true » valent vrai, tout le reste faux. */
export function readBoolean(formData: FormData, key: string, fallback = false): boolean {
  const raw = readOptionalString(formData, key);
  if (raw === null) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}
