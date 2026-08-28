/**
 * Choix automatique de la résolution de génération.
 *
 * On vérifie que la fonction reste sobre (plus petite résolution compatible),
 * fidèle au rapport demandé, et stable dans ses règles.
 */

import { describe, expect, it } from "vitest";

import { SIZE_CONSTRAINTS } from "@/lib/config";
import { chooseGenerationSize } from "@/lib/generation/generationSizing";
import { validateImageSize } from "@/lib/validation/imageSize";

const FINAL_SIZES = [
  [16, 16],
  [32, 32],
  [48, 48],
  [64, 64],
  [64, 96],
  [128, 128],
] as const;

describe("chooseGenerationSize — respect des contraintes du modèle", () => {
  it("produit toujours une résolution acceptée par la validation API", () => {
    for (const [width, height] of FINAL_SIZES) {
      for (const mode of ["eco", "standard", "high"] as const) {
        const choice = chooseGenerationSize(width, height, mode);
        expect(choice, `${width}x${height} ${mode}`).not.toBeNull();

        const validation = validateImageSize(choice!.size);
        expect(validation.ok, `${choice!.size} refusé par validateImageSize`).toBe(true);
      }
    }
  });

  it("respecte multiples de 16, bornes de pixels et rapport", () => {
    for (const [width, height] of FINAL_SIZES) {
      const choice = chooseGenerationSize(width, height, "eco")!;

      expect(choice.width % SIZE_CONSTRAINTS.MULTIPLE_OF).toBe(0);
      expect(choice.height % SIZE_CONSTRAINTS.MULTIPLE_OF).toBe(0);
      expect(choice.width).toBeLessThanOrEqual(SIZE_CONSTRAINTS.MAX_EDGE);
      expect(choice.height).toBeLessThanOrEqual(SIZE_CONSTRAINTS.MAX_EDGE);

      const total = choice.width * choice.height;
      expect(total).toBeGreaterThanOrEqual(SIZE_CONSTRAINTS.MIN_TOTAL_PIXELS);
      expect(total).toBeLessThanOrEqual(SIZE_CONSTRAINTS.MAX_TOTAL_PIXELS);
    }
  });
});

describe("chooseGenerationSize — sobriété", () => {
  it("reste au plus près du plancher du modèle", () => {
    // 816 × 816 = 665 856 px : le premier carré multiple de 16 au-dessus du
    // plancher de 655 360 px. La V0.2.3 accepte un léger surcoût pour obtenir
    // une grille entière, mais jamais davantage que le plafond configuré.
    for (const [width, height] of FINAL_SIZES) {
      const choice = chooseGenerationSize(width, height, "eco")!;
      expect(choice.costRatio, `${width}x${height}`).toBeLessThanOrEqual(1.25);
    }
  });

  it("prend la résolution la moins chère quand elle donne déjà une grille", () => {
    // 816 / 16 = 51 et 816 / 48 = 17 : la résolution minimale tombe juste.
    expect(chooseGenerationSize(16, 16, "eco")!.size).toBe("816x816");
    expect(chooseGenerationSize(48, 48, "eco")!.size).toBe("816x816");
    expect(chooseGenerationSize(16, 16, "eco")!.costRatio).toBe(1);
  });

  it("ne gonfle pas la résolution d'un petit asset selon le mode qualité", () => {
    // Le plancher du modèle domine : inutile de générer plus grand pour un
    // 16 × 16, tout le détail supplémentaire serait perdu.
    const eco = chooseGenerationSize(16, 16, "eco")!;
    const high = chooseGenerationSize(16, 16, "high")!;
    expect(high.size).toBe(eco.size);
  });

  it("augmente la résolution pour un grand asset en qualité supérieure", () => {
    const standard = chooseGenerationSize(512, 512, "standard")!;
    const high = chooseGenerationSize(512, 512, "high")!;

    expect(high.width).toBeGreaterThan(standard.width);
    // Le suréchantillonnage annoncé est bien appliqué.
    expect(standard.width).toBeGreaterThanOrEqual(512 * 2);
    expect(high.width).toBeGreaterThanOrEqual(512 * 3);
  });

  it("refuse de payer une grille trop chère en mode éco", () => {
    // Aligner un 512 × 512 coûterait +57 % : hors budget éco, dans le budget
    // standard. Le mode éco doit rester éco.
    const eco = chooseGenerationSize(512, 512, "eco")!;
    const standard = chooseGenerationSize(512, 512, "standard")!;

    expect(eco.logicalGridReady).toBe(false);
    expect(eco.costRatio).toBe(1);
    expect(standard.logicalGridReady).toBe(true);
  });
});

describe("chooseGenerationSize — respect du rapport", () => {
  it("conserve exactement un rapport 2:3", () => {
    const choice = chooseGenerationSize(64, 96, "eco")!;
    expect(choice.width / choice.height).toBeCloseTo(64 / 96, 5);
    expect(choice.aspectError).toBeCloseTo(0, 5);
  });

  it("conserve exactement un rapport 2:1", () => {
    const choice = chooseGenerationSize(256, 128, "eco")!;
    expect(choice.width / choice.height).toBeCloseTo(2, 5);
  });

  it("reste très proche du rapport demandé dans tous les cas", () => {
    for (const [width, height] of [...FINAL_SIZES, [96, 64], [100, 75], [24, 24]] as const) {
      const choice = chooseGenerationSize(width, height, "eco");
      expect(choice, `${width}x${height}`).not.toBeNull();
      expect(choice!.aspectError, `${width}x${height}`).toBeLessThanOrEqual(0.02);
    }
  });

  it("refuse un rapport hors des limites du modèle", () => {
    expect(chooseGenerationSize(400, 100, "eco")).toBeNull();
    expect(chooseGenerationSize(100, 400, "eco")).toBeNull();
  });

  it("refuse des dimensions absurdes", () => {
    expect(chooseGenerationSize(0, 16, "eco")).toBeNull();
    expect(chooseGenerationSize(-16, 16, "eco")).toBeNull();
    expect(chooseGenerationSize(Number.NaN, 16, "eco")).toBeNull();
  });
});

describe("chooseGenerationSize — stabilité des règles", () => {
  it("est déterministe", () => {
    for (let run = 0; run < 3; run += 1) {
      expect(chooseGenerationSize(64, 96, "standard")!.size).toBe(
        chooseGenerationSize(64, 96, "standard")!.size,
      );
    }
  });

  it("annonce le facteur de réduction réellement appliqué ensuite", () => {
    const choice = chooseGenerationSize(16, 16, "eco")!;
    expect(choice.downscaleFactor).toBeCloseTo(choice.width / 16, 5);
    expect(choice.downscaleFactor).toBeGreaterThan(1);
  });
});
