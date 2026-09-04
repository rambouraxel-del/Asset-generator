/**
 * Chaîne serveur de la planche de personnage : export, prompt, isolement, et
 * bout en bout depuis un PNG.
 *
 * Le scénario reproduit celui relevé en production : trois vues de tailles et
 * de lignes de pieds différentes, qui doivent ressortir strictement alignées.
 */

import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";

import { CHARACTER_SHEET } from "@/lib/config";
import { CharacterCellError } from "@/lib/character/cellAlignment";
import {
  DEFAULT_CHARACTER_SLUG,
  buildExportSheet,
  cellAssetName,
  cellFilename,
  characterSlug,
  sheetFilename,
} from "@/lib/character/sheetExport";
import {
  decodeMaster,
  runSheetPipeline,
  toBase64Png,
  upscaleMasterForModel,
} from "@/lib/character/sheetPipeline";
import { assembleSheet, sliceSheet, type Direction } from "@/lib/character/sheetLayout";
import { buildSheetRequest } from "@/lib/generation/sheetPayload";
import { buildAssetPrompt, PROMPT_TEMPLATE } from "@/lib/prompt/assetPrompt";
import { decodePng, encodePng } from "@/lib/image/postProcessing";
import { createTransparentImage, type RgbaImage } from "@/lib/image/pixels";
import type { GeneratedAsset, StylePack, StyleReference } from "@/types/domain";

const CELL = CHARACTER_SHEET.CELL_SIZE;

function figure(options: {
  width: number;
  height: number;
  feetY: number;
  colour?: [number, number, number];
  cellSize?: number;
}): RgbaImage {
  const size = options.cellSize ?? CELL;
  const image = createTransparentImage(size, size);
  const colour = options.colour ?? [200, 120, 80];
  const left = Math.floor((size - options.width) / 2);
  const top = options.feetY - (options.height - 1);

  if (top < 0 || left < 0 || options.feetY >= size) {
    throw new Error("Silhouette hors canvas dans la fixture.");
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

/** Agrandit une image d'un facteur entier : chaque pixel devient un bloc plein. */
function magnify(image: RgbaImage, scale: number): RgbaImage {
  const result = createTransparentImage(image.width * scale, image.height * scale);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const from = (y * image.width + x) * 4;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const to = ((y * scale + dy) * result.width + x * scale + dx) * 4;
          result.data[to] = image.data[from];
          result.data[to + 1] = image.data[from + 1];
          result.data[to + 2] = image.data[from + 2];
          result.data[to + 3] = image.data[from + 3];
        }
      }
    }
  }
  return result;
}

/** Le désalignement réel : face 20×44 Y=45, dos 16×42 Y=44, profil 16×40 Y=43. */
function realWorldRender(scale = 9): Buffer {
  const sheet = assembleSheet({
    down: figure({ width: 20, height: 44, feetY: 45 }),
    up: figure({ width: 16, height: 42, feetY: 44 }),
    left: figure({ width: 16, height: 40, feetY: 43 }),
    right: figure({ width: 16, height: 40, feetY: 43 }),
  });
  return encodePng(magnify(sheet, scale));
}

const MASTER = () => encodePng(figure({ width: 20, height: 44, feetY: 45 }));

describe("Nommage des exports", () => {
  it("produit les quatre noms attendus", () => {
    expect(cellFilename("Héros", "down")).toBe("heros_idle_down.png");
    expect(cellFilename("Héros", "up")).toBe("heros_idle_up.png");
    expect(cellFilename("Héros", "left")).toBe("heros_idle_left.png");
    expect(cellFilename("Héros", "right")).toBe("heros_idle_right.png");
    expect(sheetFilename("Héros")).toBe("heros_idle_sheet.png");
  });

  it("réduit un nom libre à un identifiant sûr", () => {
    expect(characterSlug("  Épée & Bouclier !! ")).toBe("epee_bouclier");
    expect(characterSlug("///")).toBe(DEFAULT_CHARACTER_SLUG);
    expect(characterSlug("")).toBe(DEFAULT_CHARACTER_SLUG);
  });

  it("nomme lisiblement une vue rangée dans la bibliothèque", () => {
    expect(cellAssetName("Héros", "left")).toBe("Héros — idle_left");
  });

  it("assemble une planche 2 × 2 aux dimensions attendues", () => {
    const cells = {
      down: figure({ width: 20, height: 44, feetY: 45 }),
      up: figure({ width: 16, height: 42, feetY: 45 }),
      left: figure({ width: 16, height: 40, feetY: 45 }),
      right: figure({ width: 16, height: 40, feetY: 45 }),
    };
    const sheet = buildExportSheet(cells);
    expect(sheet.width).toBe(96);
    expect(sheet.height).toBe(96);

    // Chaque quart doit ressortir identique à la cellule d'origine.
    const sliced = sliceSheet(sheet);
    for (const direction of ["down", "up", "left", "right"] as Direction[]) {
      expect(Array.from(sliced[direction].data)).toEqual(
        Array.from(cells[direction].data),
      );
    }
  });
});

describe("Décodage du sprite maître", () => {
  it("accepte un PNG à la bonne dimension et n'y touche pas", () => {
    const source = figure({ width: 20, height: 44, feetY: 45 });
    const decoded = decodeMaster(encodePng(source));
    expect(decoded.semiTransparentPixels).toBe(0);
    expect(decoded.adjustedPixels).toBe(0);
    expect(Array.from(decoded.image.data)).toEqual(Array.from(source.data));
  });

  it("refuse un maître aux mauvaises dimensions", () => {
    const wrong = encodePng(createTransparentImage(64, 64));
    expect(() => decodeMaster(wrong)).toThrow(CharacterCellError);
    expect(() => decodeMaster(wrong)).toThrow(/64 × 64 px/);
  });

  it("refuse un PNG illisible", () => {
    expect(() => decodeMaster(Buffer.from("pas un png"))).toThrow(CharacterCellError);
  });

  it("agrandit le maître sans introduire de couleur", () => {
    const source = figure({ width: 20, height: 44, feetY: 45 });
    const enlarged = decodePng(upscaleMasterForModel(source, 9));

    expect(enlarged.width).toBe(CELL * 9);
    expect(enlarged.height).toBe(CELL * 9);

    // Un agrandissement au plus proche voisin ne crée aucune teinte nouvelle.
    const colours = new Set<string>();
    for (let offset = 0; offset < enlarged.data.length; offset += 4) {
      colours.add(Array.from(enlarged.data.slice(offset, offset + 4)).join(","));
    }
    expect(colours.size).toBe(2); // transparent + la couleur de la silhouette
  });

  it("refuse un facteur d'agrandissement non entier", () => {
    const source = figure({ width: 20, height: 44, feetY: 45 });
    expect(() => upscaleMasterForModel(source, 1.5)).toThrow(CharacterCellError);
  });
});

describe("Chaîne complète de planche", () => {
  it("aligne les trois vues sur la géométrie du maître", () => {
    const result = runSheetPipeline({
      masterPng: MASTER(),
      masterDirection: "down",
      generatedPng: realWorldRender(),
    });

    expect(result.geometry.visualHeight).toBe(44);
    expect(result.geometry.feetY).toBe(45);
    expect(result.geometry.matchesStandardFeetLine).toBe(true);

    for (const direction of ["down", "up", "left", "right"] as Direction[]) {
      const metrics = result.cells[direction].validation.metrics;
      expect(metrics.canvasWidth).toBe(CELL);
      expect(metrics.canvasHeight).toBe(CELL);
      expect(metrics.feetY).toBe(45);
      expect(Math.abs((metrics.visualHeight ?? 0) - 44)).toBeLessThanOrEqual(1);
      expect(metrics.binaryAlpha).toBe(true);
      expect(metrics.semiTransparentPixels).toBe(0);
      expect(result.cells[direction].validation.status).toBe("ok");
    }
  });

  it("livre le maître strictement identique, pixel pour pixel", () => {
    const masterPng = MASTER();
    const source = decodePng(masterPng);

    const result = runSheetPipeline({
      masterPng,
      masterDirection: "down",
      generatedPng: realWorldRender(),
    });

    expect(Array.from(result.cells.down.image.data)).toEqual(Array.from(source.data));
    expect(result.cells.down.origin).toBe("maître");
    // La cellule « face » produite par le modèle est écartée, pas fusionnée.
    expect(result.generatedDirections).not.toContain("down");
  });

  it("déduit le profil droit par miroir exact du gauche", () => {
    const result = runSheetPipeline({
      masterPng: MASTER(),
      masterDirection: "down",
      generatedPng: realWorldRender(),
    });

    expect(result.cells.right.origin).toBe("miroir");

    const left = result.cells.left.image;
    const right = result.cells.right.image;
    for (let y = 0; y < CELL; y += 1) {
      for (let x = 0; x < CELL; x += 1) {
        const from = (y * CELL + x) * 4;
        const to = (y * CELL + (CELL - 1 - x)) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          expect(right.data[to + channel]).toBe(left.data[from + channel]);
        }
      }
    }
  });

  it("génère le profil droit séparément sur demande", () => {
    const result = runSheetPipeline({
      masterPng: MASTER(),
      masterDirection: "down",
      generatedPng: realWorldRender(),
      generateRightSeparately: true,
    });

    expect(result.cells.right.origin).toBe("générée");
    expect(result.generatedDirections).toContain("right");
  });

  it("n'impose pas au profil la largeur de la face", () => {
    const result = runSheetPipeline({
      masterPng: MASTER(),
      masterDirection: "down",
      generatedPng: realWorldRender(),
    });

    const face = result.cells.down.validation.metrics.bounds?.width ?? 0;
    const profile = result.cells.left.validation.metrics.bounds?.width ?? 0;
    expect(face).toBe(20);
    expect(profile).toBeLessThan(face);
  });

  it("assemble une planche 2 × 2 de 96 × 96 px", () => {
    const result = runSheetPipeline({
      masterPng: MASTER(),
      masterDirection: "down",
      generatedPng: realWorldRender(),
    });

    expect(result.sheet.width).toBe(96);
    expect(result.sheet.height).toBe(96);

    // La planche exportée est bien la juxtaposition des quatre vues livrées.
    const sliced = sliceSheet(result.sheet);
    expect(Array.from(sliced.left.data)).toEqual(Array.from(result.cells.left.image.data));
  });

  it("signale une grille propre quand le facteur est entier et uniforme", () => {
    const result = runSheetPipeline({
      masterPng: MASTER(),
      masterDirection: "down",
      generatedPng: realWorldRender(9),
    });

    expect(result.report.scaleX).toBe(9);
    expect(result.report.scaleY).toBe(9);
    expect(result.report.logicalGridClean).toBe(true);
    expect(result.report.gridStats.fidelity).toBeGreaterThan(0.9);
  });

  it("reste exploitable si le modèle rend une résolution non divisible", () => {
    // 872 n'est pas un multiple de 96 : la grille n'est plus propre, mais rien
    // n'est rogné et les quatre quarts restent les quatre quarts.
    const odd = createTransparentImage(872, 872);
    const source = decodePng(realWorldRender(9));
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const from = (y * source.width + x) * 4;
        const to = (y * odd.width + x) * 4;
        odd.data.set(source.data.slice(from, from + 4), to);
      }
    }

    const result = runSheetPipeline({
      masterPng: MASTER(),
      masterDirection: "down",
      generatedPng: encodePng(odd),
    });

    expect(result.report.logicalGridClean).toBe(false);
    expect(result.cells.up.validation.metrics.feetY).toBe(45);
  });

  it("aligne sur le maître même si ses pieds ne sont pas à la ligne standard", () => {
    const master = encodePng(figure({ width: 20, height: 44, feetY: 44 }));
    const result = runSheetPipeline({
      masterPng: master,
      masterDirection: "down",
      generatedPng: realWorldRender(),
    });

    expect(result.geometry.feetY).toBe(44);
    expect(result.geometry.matchesStandardFeetLine).toBe(false);
    expect(result.notices.join(" ")).toMatch(/Y=44/);
    // Toutes les vues suivent le maître, pas la constante.
    expect(result.cells.up.validation.metrics.feetY).toBe(44);
  });

  it("échoue franchement sur une cellule vide", () => {
    const incomplete = assembleSheet({
      down: figure({ width: 20, height: 44, feetY: 45 }),
      up: createTransparentImage(CELL, CELL),
      left: figure({ width: 16, height: 40, feetY: 43 }),
      right: createTransparentImage(CELL, CELL),
    });

    expect(() =>
      runSheetPipeline({
        masterPng: MASTER(),
        masterDirection: "down",
        generatedPng: encodePng(magnify(incomplete, 9)),
      }),
    ).toThrow(CharacterCellError);
  });

  it("refuse un rendu plus petit que la planche", () => {
    expect(() =>
      runSheetPipeline({
        masterPng: MASTER(),
        masterDirection: "down",
        generatedPng: encodePng(createTransparentImage(48, 48)),
      }),
    ).toThrow(/moins que les 96 × 96/);
  });

  it("refuse un rendu illisible", () => {
    expect(() =>
      runSheetPipeline({
        masterPng: MASTER(),
        masterDirection: "down",
        generatedPng: Buffer.from("pas un png"),
      }),
    ).toThrow(CharacterCellError);
  });

  it("signale un maître à transparence partielle sans le corriger", () => {
    const master = figure({ width: 20, height: 44, feetY: 45 });
    master.data[(45 * CELL + 24) * 4 + 3] = 200;

    const result = runSheetPipeline({
      masterPng: encodePng(master),
      masterDirection: "down",
      generatedPng: realWorldRender(),
    });

    expect(result.report.masterSemiTransparentPixels).toBe(1);
    expect(result.cells.down.image.data[(45 * CELL + 24) * 4 + 3]).toBe(200);
    expect(result.notices.join(" ")).toMatch(/semi-transparent/);
    // Et l'utilisateur le voit : la cellule passe en rouge.
    expect(result.cells.down.validation.status).toBe("error");
  });

  it("produit un PNG relisible pour chaque vue", () => {
    const result = runSheetPipeline({
      masterPng: MASTER(),
      masterDirection: "down",
      generatedPng: realWorldRender(),
    });

    const png = PNG.sync.read(Buffer.from(toBase64Png(result.cells.left.image), "base64"));
    expect(png.width).toBe(CELL);
    expect(png.height).toBe(CELL);
  });

  it("accepte un maître de profil droit et en déduit le gauche", () => {
    const result = runSheetPipeline({
      masterPng: encodePng(figure({ width: 16, height: 44, feetY: 45 })),
      masterDirection: "right",
      generatedPng: realWorldRender(),
    });

    expect(result.cells.right.origin).toBe("maître");
    expect(result.cells.left.origin).toBe("miroir");
  });
});

describe("Prompt de planche", () => {
  const base = {
    context: "Pixel art 2D vue du dessus.",
    request: "Un jeune héros en tunique verte.",
    finalWidth: 96,
    finalHeight: 96,
    referenceCount: 1,
    background: "transparent" as const,
  };

  it("contient l'instruction demandée mot pour mot", () => {
    const prompt = buildAssetPrompt({ ...base, characterSheet: true });
    expect(prompt).toContain(
      "Le même personnage que la référence, décliné en vues face, dos et profil gauche. Identité, tête, proportions, vêtements, palette, échelle et position des pieds strictement cohérents. Une pose neutre par cellule, fond transparent, aucun décor ni ombre.",
    );
  });

  it("décrit la disposition 2 × 2 et la ligne de pieds commune", () => {
    const prompt = buildAssetPrompt({ ...base, characterSheet: true });
    expect(prompt).toContain("grille 2 × 2");
    expect(prompt).toContain("même ligne horizontale");
    expect(prompt).toContain("même hauteur de personnage");
  });

  it("retire les contraintes qui contrediraient la planche", () => {
    const prompt = buildAssetPrompt({ ...base, characterSheet: true });
    expect(prompt).not.toContain(PROMPT_TEMPLATE.constraints[0]);
    expect(prompt).not.toContain(PROMPT_TEMPLATE.constraints[2]);
    expect(prompt).not.toContain(PROMPT_TEMPLATE.finalSizeNotice);
  });

  it("laisse le mode Asset unique strictement inchangé", () => {
    const single = buildAssetPrompt(base);
    expect(single).toContain(PROMPT_TEMPLATE.constraints[0]);
    expect(single).toContain(PROMPT_TEMPLATE.constraints[2]);
    expect(single).toContain(PROMPT_TEMPLATE.finalSizeNotice);
    expect(single).not.toContain(PROMPT_TEMPLATE.sheetInstruction);
    expect(single).not.toContain("grille 2 × 2");
  });
});

describe("Isolement du mode planche", () => {
  const pack: StylePack = {
    id: "pack-1",
    name: "A Timeless Journey",
    context: "Pixel art 2D.",
    categories: [],
    createdAt: 1,
    updatedAt: 1,
  };

  function reference(overrides: Partial<StyleReference> = {}): StyleReference {
    return {
      kind: "style-reference",
      id: "ref-1",
      packId: "pack-1",
      name: "palette.png",
      mimeType: "image/png",
      size: 10,
      width: 48,
      height: 48,
      enabled: true,
      createdAt: 1,
      order: 0,
      blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
      ...overrides,
    };
  }

  const baseInput = {
    pack,
    category: null,
    request: "Un jeune héros.",
    characterName: "Héros",
    master: new Blob([new Uint8Array([2])], { type: "image/png" }),
    masterName: "master.png",
    masterDirection: "down" as const,
    generateRightSeparately: false,
    matchMasterPalette: true,
    qualityMode: "auto" as const,
  };

  it("n'emporte que le pack, les références activées et la demande", () => {
    const built = buildSheetRequest({ ...baseInput, references: [reference()] });

    expect(built.context).toBe("Pixel art 2D.");
    expect(built.references).toHaveLength(1);
    expect(built.references[0].name).toBe("palette.png");
    expect(built.request).toBe("Un jeune héros.");
    expect(Object.keys(built)).not.toContain("library");
  });

  it("refuse un asset généré déguisé en référence", () => {
    const asset = {
      kind: "generated-asset",
      id: "asset-1",
      name: "Chêne",
      blob: new Blob([new Uint8Array([3])], { type: "image/png" }),
    } as unknown as GeneratedAsset;

    expect(() =>
      buildSheetRequest({
        ...baseInput,
        references: [asset as unknown as StyleReference],
      }),
    ).toThrow(/référence de style/);
  });

  it("fait voyager le maître dans son propre canal, hors des références", () => {
    const built = buildSheetRequest({ ...baseInput, references: [reference()] });

    // Le maître n'est pas une référence : il ne doit apparaître nulle part
    // dans `references`, sinon `assertStyleReference` s'appliquerait à lui.
    expect(built.master).toBe(baseInput.master);
    expect(built.references.some((entry) => entry.blob === baseInput.master)).toBe(false);
  });
});
