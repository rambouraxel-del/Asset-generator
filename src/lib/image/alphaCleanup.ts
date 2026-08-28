/**
 * Nettoyage de la couche alpha.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CETTE ÉTAPE CORRIGE
 * ---------------------------------------------------------------------------
 * Un sprite issu d'une illustration réduite traîne trois défauts d'alpha :
 *
 *   1. des pixels quasi invisibles (alpha 1 à 20) qui salissent le fond et
 *      gonflent la boîte utile sans rien apporter ;
 *   2. des pixels presque opaques (alpha 240 à 254) qui forment un halo terne
 *      autour de l'asset ;
 *   3. une multitude de valeurs intermédiaires qui donnent des contours flous,
 *      là où un sprite pixel-art veut des bords francs.
 *
 * Le traitement est volontairement simple et prévisible : deux seuils et un
 * nombre de paliers. Aucune heuristique fragile.
 * ---------------------------------------------------------------------------
 */

import type { RgbaImage } from "@/lib/image/pixels";

export interface AlphaCleanupOptions {
  /** En dessous de cette valeur, le pixel devient totalement transparent. */
  invisibleBelow: number;
  /** Au-dessus de cette valeur, le pixel devient totalement opaque. */
  opaqueAbove: number;
  /**
   * Nombre de paliers d'alpha autorisés entre transparent et opaque, bornes
   * comprises. `2` donne une transparence binaire — le réglage le plus net,
   * et celui qui convient à l'immense majorité des sprites. Une valeur plus
   * élevée conserve des translucidités volontaires (verre, flamme, ombre).
   */
  levels: number;
}

export interface AlphaCleanupReport {
  /** Pixels quasi invisibles effacés. */
  clearedPixels: number;
  /** Pixels quasi opaques ramenés à une opacité pleine. */
  solidifiedPixels: number;
  /** Pixels dont l'alpha a été ramené sur un palier. */
  snappedPixels: number;
  /** Pixels encore semi-transparents après nettoyage. */
  remainingSemiTransparent: number;
}

/**
 * Applique le nettoyage alpha. L'image d'entrée n'est pas modifiée.
 */
export function cleanupAlpha(
  image: RgbaImage,
  options: AlphaCleanupOptions,
): { image: RgbaImage; report: AlphaCleanupReport } {
  const levels = Math.max(2, Math.floor(options.levels));
  const data = new Uint8Array(image.data);
  const report: AlphaCleanupReport = {
    clearedPixels: 0,
    solidifiedPixels: 0,
    snappedPixels: 0,
    remainingSemiTransparent: 0,
  };

  for (let index = 3; index < data.length; index += 4) {
    const alpha = data[index];
    if (alpha === 0) continue;

    if (alpha < options.invisibleBelow) {
      // Poussière invisible : on l'efface, RVB compris, pour ne pas laisser
      // de couleur fantôme dans un pixel totalement transparent.
      data[index - 3] = 0;
      data[index - 2] = 0;
      data[index - 1] = 0;
      data[index] = 0;
      report.clearedPixels += 1;
      continue;
    }

    if (alpha > options.opaqueAbove) {
      if (alpha !== 255) {
        data[index] = 255;
        report.solidifiedPixels += 1;
      }
      continue;
    }

    const snapped = snapToLevel(alpha, levels);
    if (snapped !== alpha) {
      data[index] = snapped;
      report.snappedPixels += 1;
    }
    if (snapped === 0) {
      data[index - 3] = 0;
      data[index - 2] = 0;
      data[index - 1] = 0;
    }
  }

  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 0 && data[index] < 255) report.remainingSemiTransparent += 1;
  }

  return { image: { width: image.width, height: image.height, data }, report };
}

/** Ramène une valeur d'alpha sur le palier le plus proche. */
function snapToLevel(alpha: number, levels: number): number {
  const step = 255 / (levels - 1);
  return Math.round(Math.round(alpha / step) * step);
}

/**
 * Supprime les pixels visibles totalement isolés.
 *
 * Un pixel opaque sans aucun voisin orthogonal opaque est, à l'échelle d'un
 * sprite, du bruit : un éclat de dégradé rescapé du redimensionnement. Le
 * critère est volontairement le plus strict possible — ZÉRO voisin — pour ne
 * jamais entamer un détail légitime comme l'œil d'un personnage, qui touche
 * presque toujours quelque chose.
 */
export function removeIsolatedPixels(image: RgbaImage): {
  image: RgbaImage;
  removed: number;
} {
  const data = new Uint8Array(image.data);
  let removed = 0;

  const alphaAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return 0;
    return image.data[(y * image.width + x) * 4 + 3];
  };

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      if (image.data[offset + 3] === 0) continue;

      const neighbours =
        (alphaAt(x - 1, y) > 0 ? 1 : 0) +
        (alphaAt(x + 1, y) > 0 ? 1 : 0) +
        (alphaAt(x, y - 1) > 0 ? 1 : 0) +
        (alphaAt(x, y + 1) > 0 ? 1 : 0);

      if (neighbours === 0) {
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        data[offset + 3] = 0;
        removed += 1;
      }
    }
  }

  return { image: { width: image.width, height: image.height, data }, removed };
}
