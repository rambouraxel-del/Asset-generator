/**
 * Chaîne « Pixel Cleanup » — cœur de la V0.2.2.
 *
 * ---------------------------------------------------------------------------
 * DE L'ILLUSTRATION RÉDUITE AU SPRITE
 * ---------------------------------------------------------------------------
 * Obtenir un PNG de 64 × 64 ne suffit pas : encore faut-il qu'il ait l'air
 * DESSINÉ sur une grille de 64 × 64. Un rendu GPT simplement redimensionné
 * garde ses centaines de teintes et ses bords anti-aliasés — l'œil y lit une
 * miniature floue, pas un sprite.
 *
 * Cette chaîne enchaîne trois traitements, dans cet ordre précis :
 *
 *   1. NETTOYAGE ALPHA — efface la poussière invisible, supprime les halos
 *      quasi opaques, ramène les contours sur des paliers francs.
 *   2. QUANTIFICATION — réduit la palette aux teintes réellement structurantes,
 *      ce qui supprime l'effet « photo miniature ».
 *   3. PIXELS ISOLÉS — retire les éclats de dégradé rescapés du
 *      redimensionnement, qui ne touchent aucun autre pixel visible.
 *
 * L'ordre compte : nettoyer l'alpha d'abord évite de faire entrer dans la
 * palette la couleur de pixels voués à disparaître ; retirer les pixels isolés
 * en dernier permet de juger l'isolement sur l'image déjà assainie.
 *
 * Tout est local et déterministe : aucun appel réseau, aucun jeton consommé.
 * ---------------------------------------------------------------------------
 */

import { PIXEL_CLEANUP } from "@/lib/config";
import {
  cleanupAlpha,
  removeIsolatedPixels,
  type AlphaCleanupReport,
} from "@/lib/image/alphaCleanup";
import {
  maxColoursForFinalSize,
  quantizePalette,
  type QuantizationReport,
} from "@/lib/image/paletteQuantization";
import type { RgbaImage } from "@/lib/image/pixels";

export interface PixelCleanupOptions {
  alpha: {
    invisibleBelow: number;
    opaqueAbove: number;
    levels: number;
  };
  palette: {
    maxColours: number;
    skipBelowColours: number;
  };
  removeIsolatedPixels: boolean;
}

export interface PixelCleanupReport {
  alpha: AlphaCleanupReport;
  palette: QuantizationReport;
  /** Pixels isolés retirés, ou `null` si l'étape est désactivée. */
  isolatedPixelsRemoved: number | null;
}

/**
 * Réglages issus de la configuration centrale.
 *
 * Le plafond de palette s'adapte à la taille finale quand elle est connue :
 * un 16 × 16 n'a pas besoin d'autant de teintes qu'un 128 × 128.
 */
export function defaultCleanupOptions(finalSize?: {
  width: number;
  height: number;
}): PixelCleanupOptions {
  const maxColours =
    finalSize === undefined
      ? PIXEL_CLEANUP.PALETTE.MAX_COLOURS
      : maxColoursForFinalSize(finalSize.width, finalSize.height);

  return {
    alpha: {
      invisibleBelow: PIXEL_CLEANUP.ALPHA.INVISIBLE_BELOW,
      opaqueAbove: PIXEL_CLEANUP.ALPHA.OPAQUE_ABOVE,
      levels: PIXEL_CLEANUP.ALPHA.LEVELS,
    },
    palette: {
      maxColours,
      // Le seuil de saut suit le plafond : inutile de quantifier une image
      // déjà plus propre que la cible.
      skipBelowColours: Math.max(4, Math.round(maxColours * 0.75)),
    },
    removeIsolatedPixels: PIXEL_CLEANUP.REMOVE_ISOLATED_PIXELS,
  };
}

/**
 * Applique la chaîne complète. L'image d'entrée n'est jamais modifiée.
 */
export function applyPixelCleanup(
  image: RgbaImage,
  options: PixelCleanupOptions = defaultCleanupOptions(),
): { image: RgbaImage; report: PixelCleanupReport } {
  const alphaStep = cleanupAlpha(image, options.alpha);
  const paletteStep = quantizePalette(alphaStep.image, options.palette);

  const isolatedStep = options.removeIsolatedPixels
    ? removeIsolatedPixels(paletteStep.image)
    : null;

  return {
    image: isolatedStep?.image ?? paletteStep.image,
    report: {
      alpha: alphaStep.report,
      palette: paletteStep.report,
      isolatedPixelsRemoved: isolatedStep?.removed ?? null,
    },
  };
}
