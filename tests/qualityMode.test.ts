import { describe, expect, it } from "vitest";

import {
  AUTO_QUALITY_THRESHOLDS,
  QUALITY_MODES,
  apiQualityFor,
  describeQualityMode,
  resolveQualityMode,
} from "@/lib/generation/qualityMode";

describe("resolveQualityMode — mode Auto", () => {
  it("choisit l'éco pour un très petit asset", () => {
    expect(resolveQualityMode("auto", 16, 16)).toBe("eco");
    expect(resolveQualityMode("auto", 32, 32)).toBe("eco");
    expect(resolveQualityMode("auto", AUTO_QUALITY_THRESHOLDS.ECO_MAX_EDGE, 16)).toBe("eco");
  });

  it("choisit le standard pour un asset moyen", () => {
    expect(resolveQualityMode("auto", 48, 48)).toBe("standard");
    expect(resolveQualityMode("auto", 64, 96)).toBe("standard");
  });

  it("choisit la haute qualité pour un grand asset", () => {
    expect(resolveQualityMode("auto", 128, 128)).toBe("high");
    expect(resolveQualityMode("auto", 512, 512)).toBe("high");
  });

  it("se fonde sur le plus grand côté", () => {
    expect(resolveQualityMode("auto", 16, 128)).toBe("high");
  });

  it("retombe sur le standard sans taille finale connue", () => {
    expect(resolveQualityMode("auto", null, null)).toBe("standard");
  });
});

describe("resolveQualityMode — modes forcés", () => {
  it("respecte le mode demandé quel que soit la taille", () => {
    expect(resolveQualityMode("eco", 512, 512)).toBe("eco");
    expect(resolveQualityMode("high", 16, 16)).toBe("high");
    expect(resolveQualityMode("standard", 16, 16)).toBe("standard");
  });
});

describe("apiQualityFor", () => {
  it("associe chaque mode à une qualité API valide", () => {
    expect(apiQualityFor("eco")).toBe("low");
    expect(apiQualityFor("standard")).toBe("medium");
    expect(apiQualityFor("high")).toBe("high");
  });
});

describe("describeQualityMode", () => {
  it("annonce le mode retenu quand Auto a tranché", () => {
    expect(describeQualityMode("auto", "eco")).toBe("Auto (éco)");
    expect(describeQualityMode("auto", "high")).toBe("Auto (haute qualité)");
  });

  it("annonce simplement le mode forcé", () => {
    expect(describeQualityMode("eco", "eco")).toBe("Éco");
  });
});

describe("QUALITY_MODES", () => {
  it("expose exactement les quatre modes attendus", () => {
    expect([...QUALITY_MODES]).toEqual(["auto", "eco", "standard", "high"]);
  });
});
