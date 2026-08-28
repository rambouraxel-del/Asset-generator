import { describe, expect, it } from "vitest";

import { SIZE_CONSTRAINTS } from "@/lib/config";
import { chooseGenerationSize } from "@/lib/generation/generationSizing";
import {
  validateFinalDimensions,
  validateFinalSize,
} from "@/lib/validation/finalSize";
import { normalizeImageSize, validateImageSize } from "@/lib/validation/imageSize";

describe("validateImageSize", () => {
  it("accepte « auto »", () => {
    expect(validateImageSize("auto")).toEqual({ ok: true, kind: "auto" });
    expect(validateImageSize("AUTO").ok).toBe(true);
  });

  it("accepte les presets et une résolution libre valide", () => {
    for (const size of ["1024x1024", "1024x1536", "1536x1024", "1536x864", "2048x1024"]) {
      expect(validateImageSize(size).ok, size).toBe(true);
    }
  });

  it("refuse une dimension non multiple de 16", () => {
    const result = validateImageSize("1000x1000");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("multiples de 16");
      // Le message propose une correction utilisable.
      expect(result.message).toContain("1008x1008");
    }
  });

  it("refuse un côté au-delà du maximum", () => {
    const result = validateImageSize("3856x1280");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(String(SIZE_CONSTRAINTS.MAX_EDGE));
  });

  it("refuse un rapport supérieur à 3:1", () => {
    const result = validateImageSize("3072x768");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("rapport");
  });

  it("refuse une résolution trop petite pour le modèle", () => {
    // 64×64 est une taille d'asset légitime, mais pas une résolution générable.
    const result = validateImageSize("64x64");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("trop petite");
  });

  it("refuse une résolution dépassant le total de pixels autorisé", () => {
    const result = validateImageSize("3840x2176");
    expect(result.ok).toBe(false);
  });

  it("refuse un format non reconnu", () => {
    for (const value of ["", "grand", "1024", "1024*1024", "-16x1024"]) {
      expect(validateImageSize(value).ok, value).toBe(false);
    }
  });

  it("signale les résolutions expérimentales sans les refuser", () => {
    const result = validateImageSize("3840x2160");
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "explicit") {
      expect(result.value.experimental).toBe(true);
    }

    const standard = validateImageSize("1024x1024");
    if (standard.ok && standard.kind === "explicit") {
      expect(standard.value.experimental).toBe(false);
    }
  });
});

describe("normalizeImageSize", () => {
  it("produit la forme canonique attendue par l'API", () => {
    expect(normalizeImageSize(" 1536 × 864 ")).toBe("1536x864");
    expect(normalizeImageSize("1536X864")).toBe("1536x864");
    expect(normalizeImageSize("AUTO")).toBe("auto");
  });
});

describe("validateFinalSize — taille de l'asset livré", () => {
  it("accepte les presets de la V0.2.1", () => {
    for (const size of ["16x16", "32x32", "48x48", "64x64", "64x96", "128x128"]) {
      expect(validateFinalSize(size).ok, size).toBe(true);
    }
  });

  it("accepte une taille qui n'est pas un multiple de 16", () => {
    // C'est une dimension d'asset, pas une contrainte du modèle : 24 × 24 est
    // une taille de sprite parfaitement courante.
    const result = validateFinalSize("24x24");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.width).toBe(24);
  });

  it("accepte les séparateurs × et x, avec espaces", () => {
    expect(validateFinalSize(" 64 × 96 ")).toEqual({ ok: true, width: 64, height: 96 });
  });

  it("refuse un rapport hors des limites du modèle", () => {
    const result = validateFinalSize("400x100");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("rapport");
  });

  it("refuse une taille hors bornes", () => {
    expect(validateFinalSize("0x16").ok).toBe(false);
    expect(validateFinalSize("5000x5000").ok).toBe(false);
  });

  it("refuse une saisie mal formée", () => {
    for (const value of ["", "grand", "64", "64*64"]) {
      expect(validateFinalSize(value).ok, value).toBe(false);
    }
  });

  it("toute taille finale acceptée admet une résolution de génération", () => {
    // Garde-fou : les deux validations doivent rester cohérentes entre elles.
    for (const [w, h] of [[16, 16], [24, 24], [64, 96], [128, 128], [300, 100], [2048, 2048]]) {
      const validation = validateFinalDimensions(w, h);
      if (!validation.ok) continue;
      expect(chooseGenerationSize(w, h, "eco"), `${w}x${h}`).not.toBeNull();
    }
  });
});
