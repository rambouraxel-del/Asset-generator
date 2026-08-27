import { describe, expect, it } from "vitest";

import { SIZE_CONSTRAINTS } from "@/lib/config";
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
