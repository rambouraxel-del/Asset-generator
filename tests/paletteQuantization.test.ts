/**
 * Réduction de palette : le traitement qui supprime l'effet
 * « illustration réduite ».
 */

import { describe, expect, it } from "vitest";

import {
  countVisibleColours,
  quantizePalette,
} from "@/lib/image/paletteQuantization";
import { createTransparentImage, type RgbaImage } from "@/lib/image/pixels";

const OPTIONS = { maxColours: 32, skipBelowColours: 24 };

/**
 * Image très bariolée, proche du cas pathologique réel : une illustration
 * réduite où presque chaque pixel porte sa propre teinte.
 */
function gradient(width: number, height: number): RgbaImage {
  const image = createTransparentImage(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      image.data[offset] = Math.round((x / Math.max(1, width - 1)) * 255);
      image.data[offset + 1] = Math.round((y / Math.max(1, height - 1)) * 255);
      image.data[offset + 2] = (x * 5 + y * 3) % 256;
      image.data[offset + 3] = 255;
    }
  }
  return image;
}

describe("quantizePalette — réduction du nombre de couleurs", () => {
  it("ramène une image très bariolée sous le plafond demandé", () => {
    const source = gradient(32, 32);
    expect(countVisibleColours(source)).toBeGreaterThan(500);

    const { image, report } = quantizePalette(source, OPTIONS);

    expect(report.skipped).toBe(false);
    expect(report.coloursAfter).toBeLessThanOrEqual(OPTIONS.maxColours);
    expect(countVisibleColours(image)).toBeLessThanOrEqual(OPTIONS.maxColours);
    expect(report.coloursAfter).toBeLessThan(report.coloursBefore);
  });

  it("respecte un plafond très bas", () => {
    const { image } = quantizePalette(gradient(32, 32), {
      maxColours: 8,
      skipBelowColours: 4,
    });
    expect(countVisibleColours(image)).toBeLessThanOrEqual(8);
  });

  it("laisse intacte une image déjà propre", () => {
    // Quatre aplats : rien à quantifier.
    const image = createTransparentImage(4, 4);
    for (let index = 0; index < 16; index += 1) {
      const offset = index * 4;
      image.data[offset] = (index % 4) * 60;
      image.data[offset + 3] = 255;
    }
    const before = Array.from(image.data);
    const { image: result, report } = quantizePalette(image, OPTIONS);

    expect(report.skipped).toBe(true);
    expect(Array.from(result.data)).toEqual(before);
  });
});

describe("quantizePalette — respect de la transparence", () => {
  it("ignore les pixels transparents dans la palette", () => {
    const image = createTransparentImage(4, 4);
    // Un seul pixel visible, le reste transparent avec du RVB résiduel.
    for (let index = 0; index < 16; index += 1) {
      const offset = index * 4;
      image.data[offset] = 123;
      image.data[offset + 1] = 45;
      image.data[offset + 2] = 67;
    }
    image.data[3] = 255;

    const { report } = quantizePalette(image, { maxColours: 2, skipBelowColours: 1 });
    expect(report.coloursBefore).toBe(1);
  });

  it("ne modifie jamais la couche alpha", () => {
    const source = gradient(16, 16);
    for (let index = 0; index < 256; index += 2) source.data[index * 4 + 3] = 128;

    const { image } = quantizePalette(source, OPTIONS);
    for (let index = 3; index < image.data.length; index += 4) {
      expect(image.data[index]).toBe(source.data[index]);
    }
  });

  it("n'altère jamais l'image d'entrée", () => {
    const source = gradient(16, 16);
    const copy = Array.from(source.data);
    quantizePalette(source, OPTIONS);
    expect(Array.from(source.data)).toEqual(copy);
  });
});

describe("quantizePalette — stabilité sur les petits sprites", () => {
  it("fonctionne sur une image minuscule", () => {
    for (const size of [1, 2, 3, 4]) {
      const { image } = quantizePalette(gradient(size, size), {
        maxColours: 4,
        skipBelowColours: 2,
      });
      expect(image.width).toBe(size);
      expect(countVisibleColours(image)).toBeLessThanOrEqual(4);
    }
  });

  it("supporte une image entièrement transparente", () => {
    const { image, report } = quantizePalette(createTransparentImage(8, 8), OPTIONS);
    expect(report.coloursBefore).toBe(0);
    expect(report.skipped).toBe(true);
    expect(image.width).toBe(8);
  });

  it("est déterministe", () => {
    const first = quantizePalette(gradient(16, 16), OPTIONS);
    const second = quantizePalette(gradient(16, 16), OPTIONS);
    expect(Array.from(first.image.data)).toEqual(Array.from(second.image.data));
  });

  it("conserve des teintes proches de l'original", () => {
    // Deux familles nettes : rouge sombre et bleu clair. Après quantification,
    // chaque pixel doit rester dans sa famille.
    const image = createTransparentImage(8, 8);
    for (let index = 0; index < 64; index += 1) {
      const offset = index * 4;
      const isRed = index < 32;
      image.data[offset] = isRed ? 180 + (index % 8) : 10;
      image.data[offset + 1] = 10;
      image.data[offset + 2] = isRed ? 10 : 180 + (index % 8);
      image.data[offset + 3] = 255;
    }

    const { image: result } = quantizePalette(image, { maxColours: 2, skipBelowColours: 1 });

    for (let index = 0; index < 64; index += 1) {
      const offset = index * 4;
      if (index < 32) expect(result.data[offset]).toBeGreaterThan(result.data[offset + 2]);
      else expect(result.data[offset + 2]).toBeGreaterThan(result.data[offset]);
    }
  });
});
