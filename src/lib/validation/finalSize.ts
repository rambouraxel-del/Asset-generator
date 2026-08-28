/**
 * Validation de la taille finale de l'asset.
 *
 * À ne pas confondre avec `validation/imageSize.ts`, qui valide la résolution
 * envoyée à l'API. Ici il s'agit des dimensions du PNG livré, obtenues par
 * post-traitement local : elles ne sont donc PAS soumises aux contraintes du
 * modèle (multiples de 16, minimum de pixels…).
 *
 * Les presets suivent la convention pixel-art des multiples de 16, mais la
 * saisie libre accepte n'importe quel entier : un asset de 24 × 24 px est un
 * besoin parfaitement courant, et rien côté technique ne l'interdit.
 */

import { FINAL_SIZE_LIMITS } from "@/lib/config";

export type FinalSizeValidation =
  | { ok: true; width: number; height: number }
  | { ok: false; message: string };

const SIZE_PATTERN = /^(\d{1,5})\s*[x×]\s*(\d{1,5})$/i;

export function validateFinalSize(raw: string): FinalSizeValidation {
  const value = raw.trim();

  if (value === "") {
    return { ok: false, message: "Indiquez une taille finale." };
  }

  const match = SIZE_PATTERN.exec(value);
  if (!match) {
    return {
      ok: false,
      message: "Format attendu : largeur × hauteur, par exemple 32x32.",
    };
  }

  const width = Number(match[1]);
  const height = Number(match[2]);

  return validateFinalDimensions(width, height);
}

export function validateFinalDimensions(
  width: number,
  height: number,
): FinalSizeValidation {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return { ok: false, message: "Les dimensions doivent être des nombres entiers." };
  }

  if (width < FINAL_SIZE_LIMITS.MIN || height < FINAL_SIZE_LIMITS.MIN) {
    return { ok: false, message: "Les dimensions doivent être d'au moins 1 pixel." };
  }

  if (width > FINAL_SIZE_LIMITS.MAX || height > FINAL_SIZE_LIMITS.MAX) {
    return {
      ok: false,
      message: `Taille finale trop grande : maximum ${FINAL_SIZE_LIMITS.MAX} px par côté.`,
    };
  }

  // Le modèle ne descend pas sous un rapport de 1:3 ; au-delà, aucune
  // résolution de génération ne peut respecter la forme demandée.
  const ratio = Math.max(width / height, height / width);
  if (ratio > 3) {
    return {
      ok: false,
      message: `Le rapport entre les deux côtés doit rester entre 1:3 et 3:1 (ici ${ratio.toFixed(1)}:1).`,
    };
  }

  return { ok: true, width, height };
}

export function formatFinalSize(width: number, height: number): string {
  return `${width} × ${height}`;
}
