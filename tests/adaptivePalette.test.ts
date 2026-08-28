/**
 * Palette adaptative — correction de la limite relevée en V0.2.2, où un
 * 16 × 16 ressortait « acceptable » faute d'un plafond de couleurs adapté.
 */

import { describe, expect, it } from "vitest";

import { ADAPTIVE_PALETTE } from "@/lib/config";
import { defaultCleanupOptions } from "@/lib/image/pixelCleanup";
import { maxColoursForFinalSize } from "@/lib/image/paletteQuantization";
import { analysePixels } from "@/lib/image/pixelMetrics";
import { createTransparentImage } from "@/lib/image/pixels";
import { decodePng, encodePng, postProcessToFinalSize } from "@/lib/image/postProcessing";

describe("maxColoursForFinalSize", () => {
  it("suit la table pour les tailles de référence", () => {
    for (const entry of ADAPTIVE_PALETTE) {
      expect(maxColoursForFinalSize(entry.edge, entry.edge), `${entry.edge}`).toBe(
        entry.colours,
      );
    }
  });

  it("croît avec la taille finale", () => {
    const edges = [16, 32, 48, 64, 128];
    for (let index = 1; index < edges.length; index += 1) {
      expect(maxColoursForFinalSize(edges[index], edges[index])).toBeGreaterThan(
        maxColoursForFinalSize(edges[index - 1], edges[index - 1]),
      );
    }
  });

  it("interpole entre deux points de la table", () => {
    // 24 est à mi-chemin entre 16 (12 couleurs) et 32 (20 couleurs).
    expect(maxColoursForFinalSize(24, 24)).toBe(16);
  });

  it("se fonde sur le plus grand côté", () => {
    expect(maxColoursForFinalSize(64, 96)).toBe(maxColoursForFinalSize(96, 96));
  });

  it("reste borné hors de la table", () => {
    expect(maxColoursForFinalSize(4, 4)).toBe(ADAPTIVE_PALETTE[0].colours);
    expect(maxColoursForFinalSize(2048, 2048)).toBe(
      ADAPTIVE_PALETTE[ADAPTIVE_PALETTE.length - 1].colours,
    );
  });
});

describe("defaultCleanupOptions", () => {
  it("adapte le plafond de palette à la taille finale", () => {
    expect(defaultCleanupOptions({ width: 16, height: 16 }).palette.maxColours).toBe(12);
    expect(defaultCleanupOptions({ width: 128, height: 128 }).palette.maxColours).toBe(48);
  });

  it("garde le seuil de saut cohérent avec le plafond", () => {
    const options = defaultCleanupOptions({ width: 16, height: 16 });
    expect(options.palette.skipBelowColours).toBeLessThan(options.palette.maxColours);
  });
});

describe("Effet sur le sprite livré", () => {
  /** Illustration lisse : le pire cas pour la richesse de palette. */
  function smooth(size: number) {
    const image = createTransparentImage(size, size);
    const centre = size / 2;
    const radius = size * 0.35;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
        const coverage = Math.max(0, Math.min(1, (radius - distance) / 2));
        if (coverage <= 0) continue;
        const t = distance / radius;
        const offset = (y * size + x) * 4;
        image.data[offset] = Math.round(40 + 150 * (1 - t) + 20 * Math.sin(x / 9));
        image.data[offset + 1] = Math.round(90 + 120 * (1 - t));
        image.data[offset + 2] = Math.round(160 + 80 * t);
        image.data[offset + 3] = Math.round(255 * coverage);
      }
    }
    return encodePng(image);
  }

  it("respecte le plafond adapté à chaque taille", () => {
    for (const [final, source] of [
      [16, 816],
      [32, 832],
      [64, 832],
      [128, 896],
    ]) {
      const { buffer } = postProcessToFinalSize(smooth(source), {
        finalWidth: final,
        finalHeight: final,
      });
      const metrics = analysePixels(decodePng(buffer));
      expect(metrics.colourCount, `${final}px`).toBeLessThanOrEqual(
        maxColoursForFinalSize(final, final),
      );
    }
  });

  it("rend enfin un 16 × 16 propre", () => {
    // En V0.2.2, un 16 × 16 gardait 31 couleurs pour ~200 pixels visibles et
    // ressortait « acceptable ». Le plafond adapté à 12 couleurs corrige cela.
    const { buffer } = postProcessToFinalSize(smooth(816), {
      finalWidth: 16,
      finalHeight: 16,
    });
    const metrics = analysePixels(decodePng(buffer));

    expect(metrics.colourCount).toBeLessThanOrEqual(12);
    expect(metrics.verdict).toBe("propre");
  });
});
