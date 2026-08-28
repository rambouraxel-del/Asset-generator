/**
 * Mesures de « qualité pixel-art » d'un sprite final.
 *
 * L'objectif n'est pas de bloquer une génération, mais de rendre le problème
 * VISIBLE : un sprite trop riche en couleurs ou en niveaux d'alpha est un
 * sprite qui ressemble encore à une illustration réduite.
 *
 * Les seuils sont regroupés dans `VERDICT_THRESHOLDS`, documentés et
 * ajustables d'un seul endroit — ce ne sont pas des constantes magiques
 * dispersées dans le code.
 */

import { findVisibleBounds, type Bounds, type RgbaImage } from "@/lib/image/pixels";

export interface PixelMetrics {
  width: number;
  height: number;
  /** Pixels dont l'alpha est non nul. */
  visiblePixels: number;
  /** Pixels totalement opaques. */
  opaquePixels: number;
  /** Pixels visibles mais non opaques. */
  semiTransparentPixels: number;
  /** Part de la surface occupée par des pixels visibles, entre 0 et 1. */
  coverage: number;
  /** Couleurs RVB distinctes parmi les pixels visibles. */
  colourCount: number;
  /** Valeurs d'alpha distinctes présentes, transparence comprise. */
  alphaLevelCount: number;
  /**
   * Couleurs rapportées aux pixels visibles. Proche de 1, chaque pixel a sa
   * propre teinte : c'est la signature d'une illustration réduite.
   */
  colourDensity: number;
  /** Rectangle utile de l'asset dans le canvas final. */
  bounds: Bounds | null;
  verdict: PixelVerdict;
}

export type PixelVerdict = "propre" | "acceptable" | "à surveiller" | "trop lissé";

/**
 * Seuils de verdict.
 *
 * `colourDensity` — part de couleurs distinctes par pixel visible. Un sprite
 * dessiné à la main réutilise massivement ses teintes : la densité y est
 * faible. Une illustration réduite s'en approche de 1.
 *
 * `alphaLevels` — un sprite propre n'a que deux valeurs d'alpha (transparent
 * et opaque). Au-delà de quelques paliers, les contours deviennent flous.
 */
export const VERDICT_THRESHOLDS = {
  CLEAN: { colourDensity: 0.15, alphaLevels: 2 },
  ACCEPTABLE: { colourDensity: 0.3, alphaLevels: 4 },
  WATCH: { colourDensity: 0.5, alphaLevels: 8 },
} as const;

export const VERDICT_LABELS: Record<PixelVerdict, string> = {
  propre: "Propre",
  acceptable: "Acceptable",
  "à surveiller": "À surveiller",
  "trop lissé": "Trop lissé",
};

/** Explication courte du verdict, affichée sous les métriques. */
export const VERDICT_HINTS: Record<PixelVerdict, string> = {
  propre: "Aplats francs et contours nets : le sprite se comporte comme du pixel art natif.",
  acceptable: "Rendu correct, avec encore quelques teintes ou paliers d'alpha superflus.",
  "à surveiller":
    "Beaucoup de teintes distinctes : le sprite garde un air d'illustration réduite.",
  "trop lissé":
    "Trop de couleurs et de niveaux d'alpha : demandez une taille finale plus grande, ou simplifiez la description de l'asset.",
};

export function analysePixels(image: RgbaImage): PixelMetrics {
  const colours = new Set<number>();
  const alphaLevels = new Set<number>();

  let visiblePixels = 0;
  let opaquePixels = 0;
  let semiTransparentPixels = 0;

  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3];
    alphaLevels.add(alpha);

    if (alpha === 0) continue;
    visiblePixels += 1;
    if (alpha === 255) opaquePixels += 1;
    else semiTransparentPixels += 1;

    colours.add(
      (image.data[offset] << 16) | (image.data[offset + 1] << 8) | image.data[offset + 2],
    );
  }

  const totalPixels = image.width * image.height;
  const colourCount = colours.size;
  const colourDensity = visiblePixels === 0 ? 0 : colourCount / visiblePixels;

  return {
    width: image.width,
    height: image.height,
    visiblePixels,
    opaquePixels,
    semiTransparentPixels,
    coverage: totalPixels === 0 ? 0 : visiblePixels / totalPixels,
    colourCount,
    alphaLevelCount: alphaLevels.size,
    colourDensity,
    bounds: findVisibleBounds(image),
    verdict: judge(colourDensity, alphaLevels.size, visiblePixels),
  };
}

/**
 * Verdict à partir de la densité de couleurs et du nombre de paliers d'alpha.
 * Le pire des deux critères l'emporte : un sprite aux couleurs impeccables mais
 * aux bords flous n'est pas un sprite propre.
 */
function judge(
  colourDensity: number,
  alphaLevels: number,
  visiblePixels: number,
): PixelVerdict {
  // Un sprite quasi vide n'est pas mesurable : on ne prétend pas le juger.
  if (visiblePixels < 4) return "acceptable";

  const byColour: PixelVerdict =
    colourDensity <= VERDICT_THRESHOLDS.CLEAN.colourDensity
      ? "propre"
      : colourDensity <= VERDICT_THRESHOLDS.ACCEPTABLE.colourDensity
        ? "acceptable"
        : colourDensity <= VERDICT_THRESHOLDS.WATCH.colourDensity
          ? "à surveiller"
          : "trop lissé";

  const byAlpha: PixelVerdict =
    alphaLevels <= VERDICT_THRESHOLDS.CLEAN.alphaLevels
      ? "propre"
      : alphaLevels <= VERDICT_THRESHOLDS.ACCEPTABLE.alphaLevels
        ? "acceptable"
        : alphaLevels <= VERDICT_THRESHOLDS.WATCH.alphaLevels
          ? "à surveiller"
          : "trop lissé";

  const order: PixelVerdict[] = ["propre", "acceptable", "à surveiller", "trop lissé"];
  return order[Math.max(order.indexOf(byColour), order.indexOf(byAlpha))];
}
