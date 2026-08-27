/**
 * Validation des résolutions de génération.
 *
 * Utilisée côté client (retour immédiat pendant la saisie) ET côté serveur
 * (source de vérité). Les contraintes viennent de `SIZE_CONSTRAINTS`, seul
 * endroit à corriger si le modèle évolue.
 *
 * À ne pas confondre avec les dimensions cibles d'une catégorie d'asset :
 * celles-ci sont une contrainte de prompt et ne passent pas par ici.
 */

import { IMAGE_SIZE_PRESETS, SIZE_CONSTRAINTS } from "@/lib/config";

export interface ParsedImageSize {
  width: number;
  height: number;
  totalPixels: number;
  /** Résolution acceptée mais signalée comme expérimentale par OpenAI. */
  experimental: boolean;
}

export type ImageSizeValidation =
  | { ok: true; kind: "auto" }
  | { ok: true; kind: "explicit"; value: ParsedImageSize }
  | { ok: false; message: string };

const SIZE_PATTERN = /^(\d{1,5})\s*[x×]\s*(\d{1,5})$/i;

/** `true` si la valeur est l'un des presets proposés dans l'interface. */
export function isPreset(size: string): boolean {
  return (IMAGE_SIZE_PRESETS as readonly string[]).includes(size);
}

/**
 * Valide une résolution et explique précisément ce qui ne va pas.
 * Les messages sont destinés à l'utilisateur : concrets et actionnables.
 */
export function validateImageSize(raw: string): ImageSizeValidation {
  const value = raw.trim();

  if (value === "") {
    return { ok: false, message: "Indiquez une résolution." };
  }
  if (value.toLowerCase() === "auto") {
    return { ok: true, kind: "auto" };
  }

  const match = SIZE_PATTERN.exec(value);
  if (!match) {
    return {
      ok: false,
      message: "Format attendu : largeur × hauteur, par exemple 1536x864.",
    };
  }

  const width = Number(match[1]);
  const height = Number(match[2]);

  if (width <= 0 || height <= 0) {
    return { ok: false, message: "La largeur et la hauteur doivent être supérieures à 0." };
  }

  const { MULTIPLE_OF, MAX_EDGE, MAX_ASPECT_RATIO, MIN_TOTAL_PIXELS, MAX_TOTAL_PIXELS } =
    SIZE_CONSTRAINTS;

  if (width % MULTIPLE_OF !== 0 || height % MULTIPLE_OF !== 0) {
    return {
      ok: false,
      message: `La largeur et la hauteur doivent être des multiples de ${MULTIPLE_OF}. Proposition la plus proche : ${nearestValid(width, height)}.`,
    };
  }

  if (width > MAX_EDGE || height > MAX_EDGE) {
    return {
      ok: false,
      message: `Aucun côté ne peut dépasser ${MAX_EDGE} px.`,
    };
  }

  const ratio = Math.max(width / height, height / width);
  if (ratio > MAX_ASPECT_RATIO) {
    return {
      ok: false,
      message: `Le rapport entre les deux côtés doit rester entre 1:${MAX_ASPECT_RATIO} et ${MAX_ASPECT_RATIO}:1 (ici ${ratio.toFixed(1)}:1).`,
    };
  }

  const totalPixels = width * height;

  if (totalPixels < MIN_TOTAL_PIXELS) {
    return {
      ok: false,
      message: `Résolution trop petite : ${formatPixels(totalPixels)} pixels au total, minimum ${formatPixels(MIN_TOTAL_PIXELS)}. Le modèle ne génère pas de très petites images ; produisez plus grand puis réduisez, ou utilisez les dimensions cibles d'une catégorie.`,
    };
  }

  if (totalPixels > MAX_TOTAL_PIXELS) {
    return {
      ok: false,
      message: `Résolution trop grande : ${formatPixels(totalPixels)} pixels au total, maximum ${formatPixels(MAX_TOTAL_PIXELS)}.`,
    };
  }

  return {
    ok: true,
    kind: "explicit",
    value: {
      width,
      height,
      totalPixels,
      experimental: totalPixels > SIZE_CONSTRAINTS.EXPERIMENTAL_ABOVE_TOTAL_PIXELS,
    },
  };
}

/** Forme canonique envoyée à l'API (`1536x864`), ou `auto`. */
export function normalizeImageSize(raw: string): string {
  const validation = validateImageSize(raw);
  if (!validation.ok) return raw.trim();
  if (validation.kind === "auto") return "auto";
  return `${validation.value.width}x${validation.value.height}`;
}

/** Suggestion de résolution valide la plus proche, pour aider à la saisie. */
function nearestValid(width: number, height: number): string {
  const round = (value: number) =>
    Math.max(
      SIZE_CONSTRAINTS.MULTIPLE_OF,
      Math.round(value / SIZE_CONSTRAINTS.MULTIPLE_OF) * SIZE_CONSTRAINTS.MULTIPLE_OF,
    );
  return `${round(width)}x${round(height)}`;
}

function formatPixels(count: number): string {
  return count.toLocaleString("fr-FR");
}
