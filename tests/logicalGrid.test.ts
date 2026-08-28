/**
 * Grille logique : lecture bloc par bloc, étanchéité, fidélité.
 */

import { describe, expect, it } from "vitest";

import { describeFidelity, downscaleLogicalGrid } from "@/lib/image/logicalGrid";
import { createTransparentImage, type RgbaImage } from "@/lib/image/pixels";

/**
 * Source dont chaque bloc est parfaitement uniforme : c'est le cas d'un modèle
 * qui respecte la consigne de grille.
 */
function perfectGrid(
  final: number,
  scale: number,
  seed = 1,
): { source: RgbaImage; expected: RgbaImage } {
  const size = final * scale;
  const source = createTransparentImage(size, size);
  const expected = createTransparentImage(final, final);

  let state = seed;
  const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;

  for (let by = 0; by < final; by += 1) {
    for (let bx = 0; bx < final; bx += 1) {
      const inside = Math.hypot(bx - final / 2 + 0.5, by - final / 2 + 0.5) < final * 0.4;
      const r = inside ? Math.floor(random() * 4) * 60 + 20 : 0;
      const g = inside ? Math.floor(random() * 4) * 50 + 30 : 0;
      const b = inside ? Math.floor(random() * 4) * 55 + 25 : 0;
      const a = inside ? 255 : 0;

      const target = (by * final + bx) * 4;
      expected.data[target] = r;
      expected.data[target + 1] = g;
      expected.data[target + 2] = b;
      expected.data[target + 3] = a;

      for (let y = by * scale; y < (by + 1) * scale; y += 1) {
        for (let x = bx * scale; x < (bx + 1) * scale; x += 1) {
          const offset = (y * size + x) * 4;
          source.data[offset] = r;
          source.data[offset + 1] = g;
          source.data[offset + 2] = b;
          source.data[offset + 3] = a;
        }
      }
    }
  }

  return { source, expected };
}

function identical(a: RgbaImage, b: RgbaImage): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let index = 0; index < a.data.length; index += 1) {
    if (a.data[index] !== b.data[index]) return false;
  }
  return true;
}

describe("downscaleLogicalGrid — reproduction exacte", () => {
  const methods = ["dominant", "premultipliedMean", "median"] as const;

  for (const method of methods) {
    it(`reproduit exactement une grille parfaite (${method})`, () => {
      const { source, expected } = perfectGrid(64, 13);
      const result = downscaleLogicalGrid(source, {
        finalWidth: 64,
        finalHeight: 64,
        method,
      });

      expect(result.image.width).toBe(64);
      expect(result.image.height).toBe(64);
      expect(identical(result.image, expected)).toBe(true);
      expect(result.stats.fidelity).toBe(1);
    });
  }

  it("fonctionne pour toutes les tailles visées", () => {
    for (const [final, scale] of [
      [16, 51],
      [32, 26],
      [48, 17],
      [64, 13],
      [128, 7],
    ]) {
      const { source, expected } = perfectGrid(final, scale);
      const result = downscaleLogicalGrid(source, {
        finalWidth: final,
        finalHeight: final,
      });
      expect(identical(result.image, expected), `${final} @ ×${scale}`).toBe(true);
    }
  });

  it("annonce le facteur réellement appliqué", () => {
    const { source } = perfectGrid(64, 13);
    const result = downscaleLogicalGrid(source, { finalWidth: 64, finalHeight: 64 });
    expect(result.scaleX).toBe(13);
    expect(result.scaleY).toBe(13);
  });
});

describe("downscaleLogicalGrid — étanchéité des blocs", () => {
  it("un bloc n'influence jamais un pixel voisin", () => {
    // Un seul bloc coloré au milieu d'une grille vide : le sprite final ne doit
    // comporter qu'UN pixel visible, exactement à sa place.
    const scale = 13;
    const final = 8;
    const source = createTransparentImage(final * scale, final * scale);

    const bx = 3;
    const by = 5;
    for (let y = by * scale; y < (by + 1) * scale; y += 1) {
      for (let x = bx * scale; x < (bx + 1) * scale; x += 1) {
        const offset = (y * final * scale + x) * 4;
        source.data[offset] = 200;
        source.data[offset + 1] = 30;
        source.data[offset + 2] = 60;
        source.data[offset + 3] = 255;
      }
    }

    const { image } = downscaleLogicalGrid(source, {
      finalWidth: final,
      finalHeight: final,
    });

    let visible = 0;
    for (let y = 0; y < final; y += 1) {
      for (let x = 0; x < final; x += 1) {
        const alpha = image.data[(y * final + x) * 4 + 3];
        if (alpha === 0) continue;
        visible += 1;
        expect([x, y]).toEqual([bx, by]);
      }
    }
    expect(visible).toBe(1);
  });

  it("deux blocs voisins de couleurs opposées ne se mélangent pas", () => {
    const scale = 10;
    const source = createTransparentImage(20, 10);
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 20; x += 1) {
        const offset = (y * 20 + x) * 4;
        const left = x < scale;
        source.data[offset] = left ? 255 : 0;
        source.data[offset + 1] = left ? 0 : 255;
        source.data[offset + 2] = 0;
        source.data[offset + 3] = 255;
      }
    }

    const { image } = downscaleLogicalGrid(source, { finalWidth: 2, finalHeight: 1 });

    expect(Array.from(image.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(image.data.slice(4, 8))).toEqual([0, 255, 0, 255]);
  });
});

describe("downscaleLogicalGrid — fidélité de grille", () => {
  /** Ajoute du bruit à l'intérieur des blocs, sans changer leur structure. */
  function withNoise(source: RgbaImage, amplitude: number): RgbaImage {
    const data = new Uint8Array(source.data);
    let state = 99;
    const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] === 0) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        data[index + channel] = Math.max(
          0,
          Math.min(255, data[index + channel] + Math.round((random() - 0.5) * 2 * amplitude)),
        );
      }
    }
    return { width: source.width, height: source.height, data };
  }

  /** Illustration lisse : le modèle a totalement ignoré la grille. */
  function smooth(size: number): RgbaImage {
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
    return image;
  }

  it("annonce une fidélité parfaite sur une grille respectée", () => {
    const { source } = perfectGrid(64, 13);
    const { stats } = downscaleLogicalGrid(source, { finalWidth: 64, finalHeight: 64 });

    expect(stats.fidelity).toBe(1);
    expect(stats.meanDeviation).toBe(0);
    expect(stats.coherentBlocks).toBe(stats.nonEmptyBlocks);
    expect(describeFidelity(stats.fidelity)).toBe("bonne");
  });

  it("tolère un bruit léger à l'intérieur des blocs", () => {
    const { source } = perfectGrid(64, 13);
    const { stats } = downscaleLogicalGrid(withNoise(source, 10), {
      finalWidth: 64,
      finalHeight: 64,
    });
    expect(stats.fidelity).toBeGreaterThan(0.9);
  });

  it("s'effondre quand les blocs ne sont plus homogènes", () => {
    const { source } = perfectGrid(64, 13);
    const { stats } = downscaleLogicalGrid(withNoise(source, 60), {
      finalWidth: 64,
      finalHeight: 64,
    });
    expect(stats.fidelity).toBeLessThan(0.2);
    expect(describeFidelity(stats.fidelity)).toBe("faible");
  });

  it("détecte qu'une illustration lisse n'est pas une grille", () => {
    /*
     * Point délicat : à ×13, une illustration lisse a des blocs presque plats,
     * si bien qu'un simple critère d'homogénéité absolue la déclarerait
     * conforme. C'est le RAPPORT entre écart interne et contraste avec les
     * voisins qui la démasque.
     */
    const { stats } = downscaleLogicalGrid(smooth(832), {
      finalWidth: 64,
      finalHeight: 64,
    });

    expect(stats.meanDeviation).toBeLessThan(5);
    expect(stats.meanNeighbourContrast).toBeLessThan(15);
    expect(stats.fidelity).toBeLessThan(0.6);
    expect(describeFidelity(stats.fidelity)).not.toBe("bonne");
  });

  it("considère un aplat uni comme parfaitement conforme", () => {
    // Contraste nul entre voisins : une grande zone unie reste du pixel art
    // valide, le plancher de tolérance doit l'accepter.
    const flat = createTransparentImage(416, 416);
    for (let index = 0; index < flat.data.length; index += 4) {
      flat.data[index] = 120;
      flat.data[index + 1] = 60;
      flat.data[index + 2] = 200;
      flat.data[index + 3] = 255;
    }
    const { stats } = downscaleLogicalGrid(flat, { finalWidth: 32, finalHeight: 32 });
    expect(stats.fidelity).toBe(1);
  });

  it("renvoie une fidélité nulle sur une image vide", () => {
    const { stats } = downscaleLogicalGrid(createTransparentImage(416, 416), {
      finalWidth: 32,
      finalHeight: 32,
    });
    expect(stats.nonEmptyBlocks).toBe(0);
    expect(stats.fidelity).toBe(0);
  });
});

describe("describeFidelity", () => {
  it("classe les trois niveaux", () => {
    expect(describeFidelity(1)).toBe("bonne");
    expect(describeFidelity(0.9)).toBe("bonne");
    expect(describeFidelity(0.7)).toBe("moyenne");
    expect(describeFidelity(0.3)).toBe("faible");
  });
});
