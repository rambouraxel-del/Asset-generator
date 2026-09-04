/**
 * Planche de personnage : découpage, alignement, miroir, palette, validation.
 *
 * Le scénario de référence est celui relevé en production sur des cellules de
 * 48 × 48 : face 20 × 44 pieds à Y=45, dos 16 × 42 pieds à Y=44, profil
 * 16 × 40 pieds à Y=43. Après normalisation, les trois doivent partager
 * exactement la même hauteur visuelle et la même ligne de pieds.
 */

import { describe, expect, it } from "vitest";

import {
  CharacterCellError,
  alignCell,
  binariseAlpha,
  deriveGeometryFromMaster,
  masterPaletteOf,
  mirrorHorizontally,
} from "@/lib/character/cellAlignment";
import { buildCharacterSheet, prepareMaster } from "@/lib/character/characterSheet";
import {
  DIRECTIONS,
  assembleSheet,
  sliceCell,
  sliceSheet,
} from "@/lib/character/sheetLayout";
import { measureCell, overallStatus, validateCell } from "@/lib/character/sheetValidation";
import { createTransparentImage, type RgbaImage } from "@/lib/image/pixels";

const CELL = 48;

/**
 * Silhouette rectangulaire pleine, posée à une position donnée.
 * Suffit à tester la géométrie : c'est elle qu'on aligne, pas le dessin.
 */
function figure(options: {
  width: number;
  height: number;
  feetY: number;
  left?: number;
  colour?: [number, number, number];
  cellSize?: number;
}): RgbaImage {
  const size = options.cellSize ?? CELL;
  const image = createTransparentImage(size, size);
  const colour = options.colour ?? [200, 120, 80];
  const left = options.left ?? Math.floor((size - options.width) / 2);
  const top = options.feetY - (options.height - 1);

  // Une silhouette qui déborderait serait rognée en silence : la hauteur
  // mesurée ne serait plus celle demandée et le test mentirait.
  if (top < 0 || left < 0 || options.feetY >= size || left + options.width > size) {
    throw new Error(
      `Silhouette hors canvas : ${options.width} × ${options.height} pieds à Y=${options.feetY} ne tient pas dans ${size} × ${size}.`,
    );
  }

  for (let y = top; y <= options.feetY; y += 1) {
    for (let x = left; x < left + options.width; x += 1) {
      const offset = (y * size + x) * 4;
      image.data[offset] = colour[0];
      image.data[offset + 1] = colour[1];
      image.data[offset + 2] = colour[2];
      image.data[offset + 3] = 255;
    }
  }
  return image;
}

/** Reproduit le désalignement observé en production. */
function realWorldSheet(): RgbaImage {
  return assembleSheet({
    down: figure({ width: 20, height: 44, feetY: 45 }),
    up: figure({ width: 16, height: 42, feetY: 44 }),
    left: figure({ width: 16, height: 40, feetY: 43 }),
    right: createTransparentImage(CELL, CELL),
  });
}

function identical(a: RgbaImage, b: RgbaImage): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let index = 0; index < a.data.length; index += 1) {
    if (a.data[index] !== b.data[index]) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */

describe("Découpage et assemblage", () => {
  it("découpe les quatre cellules aux bonnes positions", () => {
    const cells = {
      down: figure({ width: 4, height: 4, feetY: 10, colour: [255, 0, 0] }),
      up: figure({ width: 4, height: 4, feetY: 10, colour: [0, 255, 0] }),
      left: figure({ width: 4, height: 4, feetY: 10, colour: [0, 0, 255] }),
      right: figure({ width: 4, height: 4, feetY: 10, colour: [255, 255, 0] }),
    };
    const sliced = sliceSheet(assembleSheet(cells));

    for (const direction of DIRECTIONS) {
      expect(identical(sliced[direction], cells[direction]), direction).toBe(true);
    }
  });

  it("refuse une planche aux mauvaises dimensions", () => {
    expect(() => sliceCell(createTransparentImage(100, 96), "down")).toThrow(
      /attendu 96 × 96/,
    );
  });

  it("refuse d'assembler une cellule de mauvaise taille", () => {
    expect(() =>
      assembleSheet({
        down: createTransparentImage(32, 32),
        up: createTransparentImage(CELL, CELL),
        left: createTransparentImage(CELL, CELL),
        right: createTransparentImage(CELL, CELL),
      }),
    ).toThrow(/attendu 48 × 48/);
  });
});

describe("Géométrie déduite du maître", () => {
  it("reprend la hauteur visuelle et la ligne de pieds du maître", () => {
    const geometry = deriveGeometryFromMaster(figure({ width: 20, height: 44, feetY: 45 }));

    expect(geometry.cellSize).toBe(48);
    expect(geometry.centreX).toBe(23.5);
    expect(geometry.feetY).toBe(45);
    expect(geometry.visualHeight).toBe(44);
    expect(geometry.matchesStandardFeetLine).toBe(true);
  });

  it("signale un maître hors de la ligne de pieds standard", () => {
    const geometry = deriveGeometryFromMaster(figure({ width: 20, height: 44, feetY: 43 }));
    expect(geometry.feetY).toBe(43);
    expect(geometry.matchesStandardFeetLine).toBe(false);
  });

  it("refuse un maître de mauvaises dimensions", () => {
    expect(() => deriveGeometryFromMaster(createTransparentImage(32, 32))).toThrow(
      CharacterCellError,
    );
  });

  it("refuse un maître vide", () => {
    expect(() => deriveGeometryFromMaster(createTransparentImage(CELL, CELL))).toThrow(
      /aucun pixel visible/,
    );
  });
});

describe("Alignement d'une cellule", () => {
  const geometry = deriveGeometryFromMaster(figure({ width: 20, height: 44, feetY: 45 }));

  it("aligne hauteur et pieds sur la cible", () => {
    // Cas du profil relevé en production : 16 × 40, pieds à Y=43.
    const { image } = alignCell(figure({ width: 16, height: 40, feetY: 43 }), geometry);
    const metrics = measureCell(image);

    expect(metrics.visualHeight).toBe(44);
    expect(metrics.feetY).toBe(45);
    expect(metrics.canvasWidth).toBe(48);
    expect(metrics.canvasHeight).toBe(48);
  });

  it("centre horizontalement au demi-pixel près", () => {
    const { image } = alignCell(figure({ width: 16, height: 40, feetY: 43 }), geometry);
    const metrics = measureCell(image);
    expect(Math.abs((metrics.centreX ?? 0) - 23.5)).toBeLessThanOrEqual(0.5);
  });

  it("ne redimensionne pas pour un écart d'un seul pixel", () => {
    const { report } = alignCell(figure({ width: 20, height: 43, feetY: 43 }), geometry);
    expect(report.resized).toBe(false);
    expect(report.alignedHeight).toBe(43);
  });

  it("redimensionne au-delà de la tolérance", () => {
    const { report } = alignCell(figure({ width: 16, height: 40, feetY: 43 }), geometry);
    expect(report.resized).toBe(true);
    expect(report.alignedHeight).toBe(44);
  });

  it("conserve les proportions sans imposer la largeur de la face", () => {
    // 16 × 40 mis à l'échelle 44/40 donne 17,6 → 18. Surtout, on ne force pas 20.
    const { report } = alignCell(figure({ width: 16, height: 40, feetY: 43 }), geometry);
    expect(report.alignedWidth).toBe(18);
    expect(report.alignedWidth).not.toBe(20);
  });

  it("refuse une cellule vide", () => {
    expect(() => alignCell(createTransparentImage(CELL, CELL), geometry)).toThrow(
      /cellule générée est vide/i,
    );
  });

  it("n'introduit aucun alpha intermédiaire", () => {
    const { image } = alignCell(figure({ width: 16, height: 40, feetY: 43 }), geometry);
    for (let offset = 3; offset < image.data.length; offset += 4) {
      expect([0, 255]).toContain(image.data[offset]);
    }
  });

  it("rapproche les couleurs de la palette du maître", () => {
    const master = figure({ width: 20, height: 44, feetY: 45, colour: [200, 120, 80] });
    const palette = masterPaletteOf(master);
    // Vue dérivée : teinte légèrement différente.
    const drifted = figure({ width: 20, height: 44, feetY: 45, colour: [205, 118, 84] });

    const { image, report } = alignCell(drifted, geometry, { masterPalette: palette });

    expect(report.recolouredPixels).toBeGreaterThan(0);
    const metrics = measureCell(image);
    expect(metrics.colourCount).toBe(1);

    const offset = (geometry.feetY * CELL + 24) * 4;
    expect(Array.from(image.data.slice(offset, offset + 3))).toEqual([200, 120, 80]);
  });

  it("laisse les couleurs intactes si le rapprochement est désactivé", () => {
    const drifted = figure({ width: 20, height: 44, feetY: 45, colour: [205, 118, 84] });
    const { report } = alignCell(drifted, geometry, { masterPalette: null });
    expect(report.recolouredPixels).toBe(0);
  });
});

describe("Transparence binaire", () => {
  it("force l'alpha à 0 ou 255", () => {
    const image = createTransparentImage(4, 1);
    [10, 127, 128, 250].forEach((alpha, index) => {
      image.data[index * 4] = 100;
      image.data[index * 4 + 3] = alpha;
    });

    const { image: result, changedPixels } = binariseAlpha(image);
    expect(Array.from([0, 1, 2, 3].map((i) => result.data[i * 4 + 3]))).toEqual([
      0, 0, 255, 255,
    ]);
    expect(changedPixels).toBe(4);
  });

  it("efface aussi la couleur d'un pixel devenu transparent", () => {
    const image = createTransparentImage(1, 1);
    image.data.set([200, 100, 50, 40]);
    const { image: result } = binariseAlpha(image);
    expect(Array.from(result.data)).toEqual([0, 0, 0, 0]);
  });

  it("laisse intacte une image déjà binaire", () => {
    const source = figure({ width: 10, height: 10, feetY: 20 });
    const { image, changedPixels } = binariseAlpha(source);
    expect(changedPixels).toBe(0);
    expect(identical(image, source)).toBe(true);
  });
});

describe("Miroir horizontal", () => {
  it("inverse exactement les colonnes", () => {
    const image = createTransparentImage(4, 1);
    for (let x = 0; x < 4; x += 1) {
      image.data[x * 4] = x * 10;
      image.data[x * 4 + 3] = 255;
    }
    const mirrored = mirrorHorizontally(image);
    expect([0, 1, 2, 3].map((x) => mirrored.data[x * 4])).toEqual([30, 20, 10, 0]);
  });

  it("est sa propre réciproque, au bit près", () => {
    const source = figure({ width: 17, height: 40, feetY: 45, left: 6 });
    expect(identical(mirrorHorizontally(mirrorHorizontally(source)), source)).toBe(true);
  });

  it("conserve exactement les couleurs et l'alpha", () => {
    const source = figure({ width: 17, height: 40, feetY: 45, left: 6 });
    const mirrored = mirrorHorizontally(source);
    expect(measureCell(mirrored).visiblePixels).toBe(measureCell(source).visiblePixels);
    expect(measureCell(mirrored).colourCount).toBe(measureCell(source).colourCount);
    expect(measureCell(mirrored).visualHeight).toBe(measureCell(source).visualHeight);
  });

  it("préserve la ligne de pieds", () => {
    const source = figure({ width: 17, height: 40, feetY: 45 });
    expect(measureCell(mirrorHorizontally(source)).feetY).toBe(45);
  });
});

describe("Validation", () => {
  const geometry = deriveGeometryFromMaster(figure({ width: 20, height: 44, feetY: 45 }));

  it("valide une cellule conforme", () => {
    const validation = validateCell("down", figure({ width: 20, height: 44, feetY: 45 }), geometry);
    expect(validation.status).toBe("ok");
    expect(validation.issues).toEqual([]);
    expect(validation.heightDelta).toBe(0);
  });

  it("tolère un écart d'un pixel", () => {
    expect(
      validateCell("up", figure({ width: 20, height: 43, feetY: 45 }), geometry).status,
    ).toBe("ok");
  });

  it("alerte à deux pixels d'écart", () => {
    const validation = validateCell("up", figure({ width: 20, height: 42, feetY: 45 }), geometry);
    expect(validation.status).toBe("warning");
    expect(validation.heightDelta).toBe(-2);
  });

  it("rejette au-delà de deux pixels", () => {
    expect(
      validateCell("up", figure({ width: 20, height: 40, feetY: 45 }), geometry).status,
    ).toBe("error");
  });

  it("rejette des pieds décalés", () => {
    const validation = validateCell("up", figure({ width: 20, height: 44, feetY: 44 }), geometry);
    expect(validation.status).toBe("error");
    expect(validation.issues.join(" ")).toMatch(/Pieds à Y=44/);
  });

  it("rejette une transparence partielle", () => {
    const cell = figure({ width: 20, height: 44, feetY: 45 });
    cell.data[(45 * CELL + 24) * 4 + 3] = 128;
    const validation = validateCell("down", cell, geometry);
    expect(validation.status).toBe("error");
    expect(validation.metrics.binaryAlpha).toBe(false);
  });

  it("rejette une cellule vide", () => {
    const validation = validateCell("down", createTransparentImage(CELL, CELL), geometry);
    expect(validation.status).toBe("error");
    expect(validation.metrics.bounds).toBeNull();
  });

  it("remonte toutes les mesures demandées", () => {
    const metrics = measureCell(figure({ width: 20, height: 44, feetY: 45 }));
    expect(metrics.canvasWidth).toBe(48);
    expect(metrics.canvasHeight).toBe(48);
    expect(metrics.bounds).toEqual({ left: 14, top: 2, width: 20, height: 44 });
    expect(metrics.centreX).toBe(23.5);
    expect(metrics.feetY).toBe(45);
    expect(metrics.visualHeight).toBe(44);
    expect(metrics.colourCount).toBe(1);
    expect(metrics.alphaLevelCount).toBe(2);
    expect(metrics.visiblePixels).toBe(20 * 44);
  });

  it("retient le pire statut pour l'ensemble", () => {
    const good = validateCell("down", figure({ width: 20, height: 44, feetY: 45 }), geometry);
    const bad = validateCell("up", figure({ width: 20, height: 40, feetY: 45 }), geometry);
    expect(overallStatus([good, good])).toBe("ok");
    expect(overallStatus([good, bad])).toBe("error");
  });
});

describe("Construction complète de la planche", () => {
  const master = figure({ width: 20, height: 44, feetY: 45 });

  it("aligne les trois vues divergentes relevées en production", () => {
    const result = buildCharacterSheet({
      master,
      masterDirection: "down",
      generatedSheet: realWorldSheet(),
    });

    for (const direction of DIRECTIONS) {
      const metrics = result.cells[direction].validation.metrics;
      expect(metrics.visualHeight, direction).toBe(44);
      expect(metrics.feetY, direction).toBe(45);
      expect(metrics.canvasWidth, direction).toBe(48);
      expect(metrics.canvasHeight, direction).toBe(48);
      expect(result.cells[direction].validation.status, direction).toBe("ok");
    }
  });

  it("conserve le maître bit pour bit", () => {
    const result = buildCharacterSheet({
      master,
      masterDirection: "down",
      generatedSheet: realWorldSheet(),
    });

    expect(result.cells.down.origin).toBe("maître");
    expect(identical(result.cells.down.image, master)).toBe(true);
  });

  it("déduit le profil droit par miroir exact du gauche", () => {
    const result = buildCharacterSheet({
      master,
      masterDirection: "down",
      generatedSheet: realWorldSheet(),
    });

    expect(result.cells.right.origin).toBe("miroir");
    expect(identical(result.cells.right.image, mirrorHorizontally(result.cells.left.image))).toBe(
      true,
    );
    expect(result.generatedDirections).not.toContain("right");
  });

  it("génère le profil droit séparément sur demande", () => {
    const sheet = assembleSheet({
      down: figure({ width: 20, height: 44, feetY: 45 }),
      up: figure({ width: 16, height: 42, feetY: 44 }),
      left: figure({ width: 16, height: 40, feetY: 43 }),
      right: figure({ width: 15, height: 41, feetY: 44 }),
    });

    const result = buildCharacterSheet({
      master,
      masterDirection: "down",
      generatedSheet: sheet,
      generateRightSeparately: true,
    });

    expect(result.cells.right.origin).toBe("générée");
    expect(result.generatedDirections).toContain("right");
    expect(result.cells.right.validation.status).toBe("ok");
  });

  it("accepte n'importe quelle orientation comme maître", () => {
    for (const direction of DIRECTIONS) {
      const sheet = assembleSheet({
        down: figure({ width: 20, height: 44, feetY: 45 }),
        up: figure({ width: 16, height: 42, feetY: 44 }),
        left: figure({ width: 16, height: 40, feetY: 43 }),
        right: figure({ width: 15, height: 41, feetY: 44 }),
      });

      const result = buildCharacterSheet({
        master,
        masterDirection: direction,
        generatedSheet: sheet,
        generateRightSeparately: direction === "right",
      });

      expect(result.cells[direction].origin, direction).toBe("maître");
      expect(identical(result.cells[direction].image, master), direction).toBe(true);
      for (const other of DIRECTIONS) {
        expect(result.cells[other].validation.metrics.feetY, `${direction}/${other}`).toBe(45);
      }
    }
  });

  it("signale un maître hors ligne standard sans le corriger", () => {
    const offMaster = figure({ width: 20, height: 44, feetY: 43 });
    const result = buildCharacterSheet({
      master: offMaster,
      masterDirection: "down",
      generatedSheet: realWorldSheet(),
    });

    expect(result.notices.join(" ")).toMatch(/pieds à Y=43/);
    expect(identical(result.cells.down.image, offMaster)).toBe(true);
    // Les autres vues suivent le maître, qui reste la référence.
    expect(result.cells.up.validation.metrics.feetY).toBe(43);
  });

  it("échoue clairement sur une cellule générée vide", () => {
    const sheet = assembleSheet({
      down: figure({ width: 20, height: 44, feetY: 45 }),
      up: createTransparentImage(CELL, CELL),
      left: figure({ width: 16, height: 40, feetY: 43 }),
      right: createTransparentImage(CELL, CELL),
    });

    expect(() =>
      buildCharacterSheet({ master, masterDirection: "down", generatedSheet: sheet }),
    ).toThrow(/up[\s\S]*vide/i);
  });

  it("échoue si la planche générée a de mauvaises dimensions", () => {
    expect(() =>
      buildCharacterSheet({
        master,
        masterDirection: "down",
        generatedSheet: createTransparentImage(64, 64),
      }),
    ).toThrow(/attendu 96 × 96/);
  });
});

describe("Préparation du sprite maître", () => {
  it("laisse intact un maître déjà propre", () => {
    const master = figure({ width: 20, height: 44, feetY: 45 });
    const { image, adjustedPixels, semiTransparentPixels } = prepareMaster(master);
    expect(adjustedPixels).toBe(0);
    expect(semiTransparentPixels).toBe(0);
    expect(identical(image, master)).toBe(true);
  });

  it("signale une transparence partielle sans toucher au maître", () => {
    const master = figure({ width: 20, height: 44, feetY: 45 });
    master.data[(45 * CELL + 24) * 4 + 3] = 200;
    const before = new Uint8Array(master.data);

    const { image, semiTransparentPixels, adjustedPixels } = prepareMaster(master);

    // Signalé, pas corrigé : c'est la garantie « maître identique au pixel près ».
    expect(semiTransparentPixels).toBe(1);
    expect(adjustedPixels).toBe(0);
    expect(identical(image, { width: CELL, height: CELL, data: before })).toBe(true);
  });

  it("nettoie la transparence partielle uniquement sur demande explicite", () => {
    const master = figure({ width: 20, height: 44, feetY: 45 });
    master.data[(45 * CELL + 24) * 4 + 3] = 200;
    const { adjustedPixels } = prepareMaster(master, CELL, { binarise: true });
    expect(adjustedPixels).toBe(1);
  });

  it("refuse un maître de mauvaises dimensions", () => {
    expect(() => prepareMaster(createTransparentImage(64, 64))).toThrow(
      /64 × 64 px, or une cellule fait 48 × 48/,
    );
  });
});
