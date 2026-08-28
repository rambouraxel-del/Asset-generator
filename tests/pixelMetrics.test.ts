import { describe, expect, it } from "vitest";

import { analysePixels } from "@/lib/image/pixelMetrics";
import { createTransparentImage, type RgbaImage } from "@/lib/image/pixels";

/** Sprite propre : deux aplats, transparence binaire. */
function cleanSprite(): RgbaImage {
  const image = createTransparentImage(8, 8);
  for (let y = 2; y < 6; y += 1) {
    for (let x = 2; x < 6; x += 1) {
      const offset = (y * 8 + x) * 4;
      image.data[offset] = x < 4 ? 200 : 40;
      image.data[offset + 1] = 60;
      image.data[offset + 2] = 90;
      image.data[offset + 3] = 255;
    }
  }
  return image;
}

/** Sprite « illustration réduite » : une teinte et un alpha par pixel. */
function smearedSprite(): RgbaImage {
  const image = createTransparentImage(8, 8);
  for (let index = 0; index < 64; index += 1) {
    const offset = index * 4;
    image.data[offset] = index * 3;
    image.data[offset + 1] = 255 - index * 2;
    image.data[offset + 2] = (index * 7) % 200;
    image.data[offset + 3] = 60 + index * 3;
  }
  return image;
}

describe("analysePixels — comptages", () => {
  it("compte couleurs, alphas et pixels visibles", () => {
    const metrics = analysePixels(cleanSprite());

    expect(metrics.width).toBe(8);
    expect(metrics.height).toBe(8);
    expect(metrics.colourCount).toBe(2);
    // Transparent et opaque, rien entre les deux.
    expect(metrics.alphaLevelCount).toBe(2);
    expect(metrics.visiblePixels).toBe(16);
    expect(metrics.opaquePixels).toBe(16);
    expect(metrics.semiTransparentPixels).toBe(0);
  });

  it("mesure la couverture du canvas", () => {
    // 16 pixels visibles sur 64.
    expect(analysePixels(cleanSprite()).coverage).toBeCloseTo(0.25, 5);
  });

  it("mesure la boîte utile", () => {
    const bounds = analysePixels(cleanSprite()).bounds;
    expect(bounds).toEqual({ left: 2, top: 2, width: 4, height: 4 });
  });

  it("renvoie une boîte nulle sur une image vide", () => {
    const metrics = analysePixels(createTransparentImage(8, 8));
    expect(metrics.bounds).toBeNull();
    expect(metrics.visiblePixels).toBe(0);
    expect(metrics.colourDensity).toBe(0);
  });

  it("détecte les pixels semi-transparents", () => {
    const metrics = analysePixels(smearedSprite());
    expect(metrics.semiTransparentPixels).toBeGreaterThan(0);
    expect(metrics.alphaLevelCount).toBeGreaterThan(4);
  });

  it("calcule la densité de couleurs", () => {
    // Sprite propre : 2 couleurs pour 16 pixels visibles.
    expect(analysePixels(cleanSprite()).colourDensity).toBeCloseTo(2 / 16, 5);
  });
});

describe("analysePixels — verdict", () => {
  it("juge propre un sprite à aplats et alpha binaire", () => {
    expect(analysePixels(cleanSprite()).verdict).toBe("propre");
  });

  it("juge trop lissé un sprite à une teinte par pixel", () => {
    expect(analysePixels(smearedSprite()).verdict).toBe("trop lissé");
  });

  it("retient le pire des deux critères", () => {
    // Deux couleurs seulement, mais huit niveaux d'alpha : les contours sont
    // flous, le sprite ne peut pas être déclaré propre.
    const image = createTransparentImage(8, 8);
    for (let index = 0; index < 64; index += 1) {
      const offset = index * 4;
      image.data[offset] = index % 2 === 0 ? 200 : 40;
      image.data[offset + 3] = 30 + (index % 9) * 25;
    }
    const metrics = analysePixels(image);
    expect(metrics.colourCount).toBeLessThanOrEqual(2);
    expect(metrics.alphaLevelCount).toBeGreaterThan(4);
    expect(metrics.verdict).not.toBe("propre");
  });

  it("ne prétend pas juger un sprite quasi vide", () => {
    const image = createTransparentImage(8, 8);
    image.data[3] = 255;
    expect(analysePixels(image).verdict).toBe("acceptable");
  });
});
