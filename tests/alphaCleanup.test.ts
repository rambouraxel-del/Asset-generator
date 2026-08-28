/**
 * Nettoyage alpha : poussière invisible, halos, paliers de contour.
 */

import { describe, expect, it } from "vitest";

import { cleanupAlpha, removeIsolatedPixels } from "@/lib/image/alphaCleanup";
import { createTransparentImage, type RgbaImage } from "@/lib/image/pixels";

const OPTIONS = { invisibleBelow: 24, opaqueAbove: 200, levels: 2 };

/** Image d'une ligne, dont on fixe l'alpha pixel par pixel. */
function rowWithAlphas(alphas: number[]): RgbaImage {
  const image = createTransparentImage(alphas.length, 1);
  alphas.forEach((alpha, index) => {
    const offset = index * 4;
    image.data[offset] = 200;
    image.data[offset + 1] = 100;
    image.data[offset + 2] = 50;
    image.data[offset + 3] = alpha;
  });
  return image;
}

function alphasOf(image: RgbaImage): number[] {
  const result: number[] = [];
  for (let index = 3; index < image.data.length; index += 4) result.push(image.data[index]);
  return result;
}

describe("cleanupAlpha — poussière quasi invisible", () => {
  it("efface les pixels sous le seuil de visibilité", () => {
    const { image, report } = cleanupAlpha(rowWithAlphas([0, 3, 12, 23, 24, 255]), OPTIONS);
    // 3, 12 et 23 sont effacés ; 24 est au seuil, donc conservé.
    expect(alphasOf(image).slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(report.clearedPixels).toBe(3);
  });

  it("efface aussi la couleur d'un pixel devenu transparent", () => {
    const { image } = cleanupAlpha(rowWithAlphas([10]), OPTIONS);
    expect(Array.from(image.data)).toEqual([0, 0, 0, 0]);
  });
});

describe("cleanupAlpha — halos quasi opaques", () => {
  it("rend pleinement opaques les pixels presque opaques", () => {
    const { image, report } = cleanupAlpha(rowWithAlphas([201, 240, 254, 255]), OPTIONS);
    expect(alphasOf(image)).toEqual([255, 255, 255, 255]);
    // Le pixel déjà à 255 n'est pas compté comme modifié.
    expect(report.solidifiedPixels).toBe(3);
  });
});

describe("cleanupAlpha — paliers de contour", () => {
  it("ramène les alphas intermédiaires sur une transparence binaire", () => {
    const { image, report } = cleanupAlpha(rowWithAlphas([40, 100, 130, 190]), OPTIONS);
    expect(alphasOf(image).every((alpha) => alpha === 0 || alpha === 255)).toBe(true);
    expect(report.remainingSemiTransparent).toBe(0);
  });

  it("conserve des translucidités quand plusieurs paliers sont autorisés", () => {
    const { image } = cleanupAlpha(rowWithAlphas([40, 100, 130, 190]), {
      ...OPTIONS,
      levels: 4,
    });
    const distinct = new Set(alphasOf(image));
    // Quatre paliers possibles : 0, 85, 170, 255.
    expect([...distinct].every((alpha) => [0, 85, 170, 255].includes(alpha))).toBe(true);
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("réduit toujours le nombre de niveaux d'alpha présents", () => {
    const source = rowWithAlphas([30, 60, 90, 120, 150, 180, 195]);
    const before = new Set(alphasOf(source)).size;
    const { image } = cleanupAlpha(source, OPTIONS);
    expect(new Set(alphasOf(image)).size).toBeLessThan(before);
  });

  it("laisse un contour lisible : l'asset ne disparaît pas", () => {
    // Un disque dont tout le bord est à mi-opacité doit rester visible.
    const image = createTransparentImage(8, 8);
    for (let index = 0; index < 8 * 8; index += 1) {
      image.data[index * 4 + 3] = 140;
    }
    const { image: cleaned } = cleanupAlpha(image, OPTIONS);
    expect(alphasOf(cleaned).every((alpha) => alpha === 255)).toBe(true);
  });

  it("n'altère jamais l'image d'entrée", () => {
    const source = rowWithAlphas([10, 130, 250]);
    const copy = Array.from(source.data);
    cleanupAlpha(source, OPTIONS);
    expect(Array.from(source.data)).toEqual(copy);
  });
});

describe("removeIsolatedPixels", () => {
  /** Grille 5×5 : on marque les pixels visibles listés. */
  function grid(visible: Array<[number, number]>): RgbaImage {
    const image = createTransparentImage(5, 5);
    for (const [x, y] of visible) {
      const offset = (y * 5 + x) * 4;
      image.data[offset] = 255;
      image.data[offset + 3] = 255;
    }
    return image;
  }

  function visibleCount(image: RgbaImage): number {
    let count = 0;
    for (let index = 3; index < image.data.length; index += 4) {
      if (image.data[index] > 0) count += 1;
    }
    return count;
  }

  it("retire un pixel sans aucun voisin", () => {
    const { image, removed } = removeIsolatedPixels(grid([[0, 0], [3, 3], [3, 4]]));
    expect(removed).toBe(1);
    expect(visibleCount(image)).toBe(2);
  });

  it("conserve un pixel ayant au moins un voisin orthogonal", () => {
    const { image, removed } = removeIsolatedPixels(grid([[2, 2], [2, 3]]));
    expect(removed).toBe(0);
    expect(visibleCount(image)).toBe(2);
  });

  it("ne touche pas à une forme pleine", () => {
    const full: Array<[number, number]> = [];
    for (let y = 0; y < 5; y += 1) for (let x = 0; x < 5; x += 1) full.push([x, y]);
    const { removed } = removeIsolatedPixels(grid(full));
    expect(removed).toBe(0);
  });

  it("juge l'isolement sur l'image d'origine, sans effet de cascade", () => {
    // Deux pixels voisins : aucun n'est isolé, même après retrait de l'autre.
    const { removed } = removeIsolatedPixels(grid([[1, 1], [2, 1]]));
    expect(removed).toBe(0);
  });
});
