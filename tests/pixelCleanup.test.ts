/**
 * Chaîne Pixel Cleanup de bout en bout.
 *
 * Le test central de la V0.2.2 : sur une source qui reproduit fidèlement ce que
 * produit GPT-Image-2 — illustration lisse, anti-aliasée, à dégradés — la
 * chaîne doit livrer un sprite à aplats francs et transparence binaire.
 */

import { describe, expect, it } from "vitest";

import { applyPixelCleanup, defaultCleanupOptions } from "@/lib/image/pixelCleanup";
import { createTransparentImage, type RgbaImage } from "@/lib/image/pixels";
import {
  decodePng,
  encodePng,
  postProcessToFinalSize,
} from "@/lib/image/postProcessing";

/**
 * Rendu type de GPT-Image-2 : disque au contour anti-aliasé, dégradé interne
 * et légère ondulation de teinte. C'est très exactement la source qui produit
 * le « faux pixel art ».
 */
function smoothIllustration(size: number): Buffer {
  const image = createTransparentImage(size, size);
  const centre = size / 2;
  const radius = size * 0.35;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - centre;
      const dy = y + 0.5 - centre;
      const distance = Math.sqrt(dx * dx + dy * dy);
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

describe("Pixel Cleanup — le sprite cesse d'être une illustration réduite", () => {
  for (const size of [16, 32, 64]) {
    it(`${size} × ${size} : palette et alpha maîtrisés`, () => {
      const { report } = postProcessToFinalSize(smoothIllustration(816), {
        finalWidth: size,
        finalHeight: size,
      });

      const metrics = report.metrics;
      // Palette bornée par le plafond configuré.
      expect(metrics.colourCount).toBeLessThanOrEqual(32);
      // Transparence binaire : plus aucun bord flou.
      expect(metrics.alphaLevelCount).toBeLessThanOrEqual(2);
      expect(metrics.semiTransparentPixels).toBe(0);
      expect(metrics.verdict).toBe("propre");
    });
  }

  it("améliore nettement la sortie par rapport à la chaîne V0.2.1", () => {
    const source = () => smoothIllustration(816);

    const avant = postProcessToFinalSize(source(), {
      finalWidth: 64,
      finalHeight: 64,
      downscaleMethod: "nearest",
      cleanup: null,
    }).report.metrics;

    const apres = postProcessToFinalSize(source(), {
      finalWidth: 64,
      finalHeight: 64,
    }).report.metrics;

    // Repères mesurés : plus de 1300 couleurs et 8 niveaux d'alpha avant.
    expect(avant.colourCount).toBeGreaterThan(500);
    expect(avant.semiTransparentPixels).toBeGreaterThan(0);

    expect(apres.colourCount).toBeLessThan(avant.colourCount / 10);
    expect(apres.alphaLevelCount).toBeLessThan(avant.alphaLevelCount);
    expect(apres.semiTransparentPixels).toBe(0);
    expect(apres.colourDensity).toBeLessThan(avant.colourDensity / 5);
  });

  it("conserve la silhouette de l'asset", () => {
    const { report } = postProcessToFinalSize(smoothIllustration(816), {
      finalWidth: 32,
      finalHeight: 32,
    });

    // Un disque inscrit dans le canvas : couverture proche de π/4 ≈ 0,785.
    expect(report.metrics.coverage).toBeGreaterThan(0.6);
    expect(report.metrics.coverage).toBeLessThan(0.9);
    expect(report.metrics.bounds).not.toBeNull();
  });

  it("livre toujours les dimensions exactes demandées", () => {
    for (const [width, height] of [[16, 16], [24, 24], [64, 96], [128, 128]]) {
      const { buffer } = postProcessToFinalSize(smoothIllustration(816), {
        finalWidth: width,
        finalHeight: height,
      });
      const decoded = decodePng(buffer);
      expect(decoded.width).toBe(width);
      expect(decoded.height).toBe(height);
    }
  });
});

describe("Pixel Cleanup — compte rendu", () => {
  it("détaille chaque étape", () => {
    const { report } = postProcessToFinalSize(smoothIllustration(816), {
      finalWidth: 32,
      finalHeight: 32,
    });

    expect(report.cleanup).not.toBeNull();
    expect(report.cleanup!.alpha.remainingSemiTransparent).toBe(0);
    expect(report.cleanup!.palette.coloursAfter).toBeLessThanOrEqual(32);
    expect(report.cleanup!.isolatedPixelsRemoved).not.toBeNull();
    expect(report.downscaleMethod).toBe("area");
  });

  it("peut être entièrement désactivée", () => {
    const { report } = postProcessToFinalSize(smoothIllustration(816), {
      finalWidth: 32,
      finalHeight: 32,
      cleanup: null,
    });
    expect(report.cleanup).toBeNull();
  });
});

describe("applyPixelCleanup — ordre des étapes", () => {
  it("n'altère jamais l'image d'entrée", () => {
    const image = createTransparentImage(8, 8);
    for (let index = 0; index < 64; index += 1) {
      image.data[index * 4] = index * 3;
      image.data[index * 4 + 3] = 40 + index * 3;
    }
    const copy = Array.from(image.data);

    applyPixelCleanup(image, defaultCleanupOptions());
    expect(Array.from(image.data)).toEqual(copy);
  });

  it("supprime les pixels isolés apparus après nettoyage alpha", () => {
    // Un pixel opaque isolé, plus une paire voisine : seul l'isolé doit tomber.
    const image: RgbaImage = createTransparentImage(6, 6);
    const set = (x: number, y: number, alpha: number) => {
      const offset = (y * 6 + x) * 4;
      image.data[offset] = 180;
      image.data[offset + 1] = 60;
      image.data[offset + 2] = 40;
      image.data[offset + 3] = alpha;
    };
    set(0, 0, 255);
    set(3, 3, 255);
    set(3, 4, 255);

    const { report } = applyPixelCleanup(image, defaultCleanupOptions());
    expect(report.isolatedPixelsRemoved).toBe(1);
  });

  it("supporte une image entièrement transparente", () => {
    const { image, report } = applyPixelCleanup(
      createTransparentImage(8, 8),
      defaultCleanupOptions(),
    );
    expect(image.width).toBe(8);
    expect(report.palette.skipped).toBe(true);
  });
});

describe("Redimensionnement — aucune interpolation dans la sortie", () => {
  it("le sprite final ne contient que des alphas francs", () => {
    const { buffer } = postProcessToFinalSize(smoothIllustration(1024), {
      finalWidth: 32,
      finalHeight: 32,
    });
    const decoded = decodePng(buffer);
    for (let index = 3; index < decoded.data.length; index += 4) {
      expect([0, 255]).toContain(decoded.data[index]);
    }
  });

  it("le mode nearest strict reste disponible et sans mélange", () => {
    // Damier deux couleurs : le plus proche voisin ne doit inventer aucune teinte.
    const source = createTransparentImage(64, 64);
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const offset = (y * 64 + x) * 4;
        const dark = (x + y) % 2 === 0;
        source.data[offset] = dark ? 0 : 255;
        source.data[offset + 1] = dark ? 0 : 255;
        source.data[offset + 2] = dark ? 0 : 255;
        source.data[offset + 3] = 255;
      }
    }

    const { buffer } = postProcessToFinalSize(encodePng(source), {
      finalWidth: 16,
      finalHeight: 16,
      downscaleMethod: "nearest",
      cleanup: null,
    });

    const decoded = decodePng(buffer);
    const colours = new Set<string>();
    for (let index = 0; index < decoded.data.length; index += 4) {
      colours.add(Array.from(decoded.data.slice(index, index + 3)).join(","));
    }
    for (const colour of colours) {
      expect(["0,0,0", "255,255,255"]).toContain(colour);
    }
  });
});
