/**
 * Opérations pixel : détourage, redimensionnement, cadrage.
 *
 * Ces tests portent sur la promesse centrale de la V0.2.1 : aucun lissage,
 * aucun anti-aliasing, dimensions finales exactes, asset jamais coupé.
 */

import { describe, expect, it } from "vitest";

import {
  composeOnCanvas,
  createTransparentImage,
  cropImage,
  fitWithin,
  findVisibleBounds,
  resizeNearestNeighbour,
  type RgbaImage,
} from "@/lib/image/pixels";

/** Petite fabrique : image transparente avec un rectangle plein dedans. */
function imageWithRect(
  width: number,
  height: number,
  rect: { left: number; top: number; width: number; height: number },
  colour: [number, number, number, number] = [255, 0, 0, 255],
): RgbaImage {
  const image = createTransparentImage(width, height);
  for (let y = rect.top; y < rect.top + rect.height; y += 1) {
    for (let x = rect.left; x < rect.left + rect.width; x += 1) {
      const offset = (y * width + x) * 4;
      image.data[offset] = colour[0];
      image.data[offset + 1] = colour[1];
      image.data[offset + 2] = colour[2];
      image.data[offset + 3] = colour[3];
    }
  }
  return image;
}

function pixelAt(image: RgbaImage, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return Array.from(image.data.slice(offset, offset + 4));
}

/** Ensemble des couleurs distinctes présentes dans une image. */
function distinctColours(image: RgbaImage): Set<string> {
  const colours = new Set<string>();
  for (let index = 0; index < image.data.length; index += 4) {
    colours.add(Array.from(image.data.slice(index, index + 4)).join(","));
  }
  return colours;
}

describe("findVisibleBounds — détection des marges transparentes", () => {
  it("trouve le rectangle utile au pixel près", () => {
    const image = imageWithRect(100, 80, { left: 20, top: 10, width: 30, height: 40 });
    expect(findVisibleBounds(image)).toEqual({ left: 20, top: 10, width: 30, height: 40 });
  });

  it("renvoie null sur une image entièrement transparente", () => {
    expect(findVisibleBounds(createTransparentImage(20, 20))).toBeNull();
  });

  it("couvre toute l'image quand rien n'est transparent", () => {
    const image = imageWithRect(10, 10, { left: 0, top: 0, width: 10, height: 10 });
    expect(findVisibleBounds(image)).toEqual({ left: 0, top: 0, width: 10, height: 10 });
  });

  it("conserve un contour translucide par défaut", () => {
    const image = imageWithRect(10, 10, { left: 4, top: 4, width: 2, height: 2 });
    // Pixel très peu opaque en (1,1) : il fait partie de l'asset.
    const offset = (1 * 10 + 1) * 4;
    image.data[offset + 3] = 8;
    expect(findVisibleBounds(image)).toEqual({ left: 1, top: 1, width: 5, height: 5 });
  });

  it("ignore les pixels sous le seuil quand on en demande un", () => {
    const image = imageWithRect(10, 10, { left: 4, top: 4, width: 2, height: 2 });
    const offset = (1 * 10 + 1) * 4;
    image.data[offset + 3] = 8;
    expect(findVisibleBounds(image, 16)).toEqual({ left: 4, top: 4, width: 2, height: 2 });
  });
});

describe("cropImage", () => {
  it("extrait exactement la zone demandée", () => {
    const image = imageWithRect(20, 20, { left: 5, top: 5, width: 4, height: 4 });
    const cropped = cropImage(image, { left: 5, top: 5, width: 4, height: 4 });

    expect(cropped.width).toBe(4);
    expect(cropped.height).toBe(4);
    expect(pixelAt(cropped, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(cropped, 3, 3)).toEqual([255, 0, 0, 255]);
  });
});

describe("resizeNearestNeighbour — jamais de lissage", () => {
  it("n'introduit aucune couleur absente de l'original", () => {
    // Damier deux couleurs : tout mélange créerait une troisième couleur.
    const image = createTransparentImage(64, 64);
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const offset = (y * 64 + x) * 4;
        const dark = (x + y) % 2 === 0;
        image.data[offset] = dark ? 0 : 255;
        image.data[offset + 1] = dark ? 0 : 255;
        image.data[offset + 2] = dark ? 0 : 255;
        image.data[offset + 3] = 255;
      }
    }

    const before = distinctColours(image);
    const after = distinctColours(resizeNearestNeighbour(image, 16, 16));

    expect(before.size).toBe(2);
    for (const colour of after) {
      expect(before.has(colour), `couleur inventée : ${colour}`).toBe(true);
    }
  });

  it("préserve les bords francs lors d'une forte réduction", () => {
    // Moitié gauche rouge opaque, moitié droite transparente.
    const image = imageWithRect(800, 800, { left: 0, top: 0, width: 400, height: 800 });
    const small = resizeNearestNeighbour(image, 16, 16);

    // Aucune valeur d'alpha intermédiaire : soit 0, soit 255.
    for (let index = 3; index < small.data.length; index += 4) {
      expect([0, 255]).toContain(small.data[index]);
    }
    expect(pixelAt(small, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(small, 15, 0)).toEqual([0, 0, 0, 0]);
  });

  it("agrandit par duplication exacte des pixels", () => {
    const image = imageWithRect(2, 2, { left: 0, top: 0, width: 1, height: 1 });
    const large = resizeNearestNeighbour(image, 4, 4);

    expect(pixelAt(large, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(large, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(large, 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it("échantillonne au centre du pixel de destination", () => {
    /*
     * Image de 8 px réduite à 4 : l'échantillonnage au centre retient les
     * colonnes 1, 3, 5 et 7 — une source sur deux, sans décalage vers le bord
     * gauche qu'un simple `floor(x * ratio)` produirait (il retiendrait 0, 2,
     * 4, 6). On marque chaque colonne d'une valeur distincte pour lire
     * précisément laquelle a été retenue.
     */
    const image = createTransparentImage(8, 1);
    for (let x = 0; x < 8; x += 1) {
      image.data[x * 4] = x * 10;
      image.data[x * 4 + 3] = 255;
    }

    const small = resizeNearestNeighbour(image, 4, 1);
    const sampled = [0, 1, 2, 3].map((x) => pixelAt(small, x, 0)[0] / 10);
    expect(sampled).toEqual([1, 3, 5, 7]);
  });

  it("refuse une dimension nulle ou négative", () => {
    const image = createTransparentImage(4, 4);
    expect(() => resizeNearestNeighbour(image, 0, 4)).toThrow();
    expect(() => resizeNearestNeighbour(image, 4, -1)).toThrow();
  });
});

describe("fitWithin — l'asset n'est jamais coupé ni déformé", () => {
  it("tient toujours dans l'emprise", () => {
    for (const [sw, sh, bw, bh] of [
      [1000, 500, 16, 16],
      [300, 900, 64, 96],
      [17, 5, 32, 32],
      [1, 1, 128, 128],
    ]) {
      const fitted = fitWithin(sw, sh, bw, bh);
      expect(fitted.width).toBeLessThanOrEqual(bw);
      expect(fitted.height).toBeLessThanOrEqual(bh);
      expect(fitted.width).toBeGreaterThanOrEqual(1);
      expect(fitted.height).toBeGreaterThanOrEqual(1);
    }
  });

  it("conserve les proportions", () => {
    const fitted = fitWithin(1000, 500, 64, 64);
    expect(fitted.width / fitted.height).toBeCloseTo(2, 1);
  });

  it("ne fait jamais disparaître un asset très allongé", () => {
    const fitted = fitWithin(900, 30, 16, 16);
    expect(fitted.width).toBeGreaterThanOrEqual(1);
    expect(fitted.height).toBeGreaterThanOrEqual(1);
  });
});

describe("composeOnCanvas — dimensions finales exactes", () => {
  it("produit toujours un canvas aux dimensions demandées", () => {
    const image = imageWithRect(6, 4, { left: 0, top: 0, width: 6, height: 4 });
    const canvas = composeOnCanvas(image, 16, 16);
    expect(canvas.width).toBe(16);
    expect(canvas.height).toBe(16);
    expect(canvas.data.length).toBe(16 * 16 * 4);
  });

  it("centre l'asset par défaut", () => {
    const image = imageWithRect(4, 4, { left: 0, top: 0, width: 4, height: 4 });
    const canvas = composeOnCanvas(image, 10, 10);
    // Décalage attendu : (10 - 4) / 2 = 3.
    expect(pixelAt(canvas, 3, 3)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(canvas, 6, 6)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(canvas, 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it("pose l'asset au sol avec l'ancrage bas-centre", () => {
    const image = imageWithRect(4, 4, { left: 0, top: 0, width: 4, height: 4 });
    const canvas = composeOnCanvas(image, 10, 10, "bottom-center");
    expect(pixelAt(canvas, 3, 9)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(canvas, 3, 5)).toEqual([0, 0, 0, 0]);
  });

  it("laisse le reste du canvas parfaitement transparent", () => {
    const image = imageWithRect(2, 2, { left: 0, top: 0, width: 2, height: 2 });
    const canvas = composeOnCanvas(image, 8, 8);
    let opaque = 0;
    for (let index = 3; index < canvas.data.length; index += 4) {
      if (canvas.data[index] > 0) opaque += 1;
    }
    expect(opaque).toBe(4);
  });
});
