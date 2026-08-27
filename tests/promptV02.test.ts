import { describe, expect, it } from "vitest";

import { PROMPT_TEMPLATE, buildAssetPrompt } from "@/lib/prompt/assetPrompt";

const BASE = {
  context: "Pixel art 2D vue du dessus.",
  categoryName: "Petit objet",
  targetWidth: 64,
  targetHeight: 64,
  categoryRule: "L'objet doit tenir entièrement dans cette emprise.",
  request: "Un tonneau en bois.",
  referenceCount: 2,
  background: "transparent" as const,
};

describe("buildAssetPrompt — structure V0.2", () => {
  it("contient les blocs attendus, dans l'ordre attendu", () => {
    const prompt = buildAssetPrompt(BASE);

    const order = [
      PROMPT_TEMPLATE.intro,
      PROMPT_TEMPLATE.styleHeading,
      PROMPT_TEMPLATE.referencesHeading,
      PROMPT_TEMPLATE.categoryHeading,
      PROMPT_TEMPLATE.dimensionsHeading,
      PROMPT_TEMPLATE.assetHeading,
      PROMPT_TEMPLATE.constraintsHeading,
    ];

    let cursor = -1;
    for (const marker of order) {
      const index = prompt.indexOf(marker);
      expect(index, `bloc manquant : ${marker}`).toBeGreaterThan(-1);
      expect(index, `bloc mal ordonné : ${marker}`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it("injecte la catégorie et ses contraintes dimensionnelles", () => {
    const prompt = buildAssetPrompt(BASE);
    expect(prompt).toContain("Petit objet");
    expect(prompt).toContain("64 × 64 pixels");
    expect(prompt).toContain(BASE.categoryRule);
    expect(prompt).toContain(PROMPT_TEMPLATE.dimensionsNotice);
  });

  it("précise que la dimension n'autorise pas à déformer l'objet", () => {
    const prompt = buildAssetPrompt(BASE);
    expect(prompt).toMatch(/Ne l'étire pas/);
  });

  it("omet le bloc dimensionnel quand la catégorie n'impose rien", () => {
    const prompt = buildAssetPrompt({
      ...BASE,
      categoryName: "Libre",
      targetWidth: null,
      targetHeight: null,
      categoryRule: "",
    });
    expect(prompt).toContain("Libre");
    expect(prompt).not.toContain(PROMPT_TEMPLATE.dimensionsHeading);
  });

  it("omet la catégorie quand aucune n'est sélectionnée", () => {
    const prompt = buildAssetPrompt({ ...BASE, categoryName: null });
    expect(prompt).not.toContain(PROMPT_TEMPLATE.categoryHeading);
  });

  it("reprend toutes les contraintes générales", () => {
    const prompt = buildAssetPrompt(BASE);
    for (const constraint of PROMPT_TEMPLATE.constraints) {
      expect(prompt).toContain(constraint);
    }
  });

  it("adapte la consigne de fond au mode demandé", () => {
    expect(buildAssetPrompt(BASE)).toContain(PROMPT_TEMPLATE.transparentBackgroundNotice);
    expect(buildAssetPrompt({ ...BASE, background: "opaque" })).toContain(
      PROMPT_TEMPLATE.opaqueBackgroundNotice,
    );
    const auto = buildAssetPrompt({ ...BASE, background: "auto" });
    expect(auto).not.toContain(PROMPT_TEMPLATE.transparentBackgroundNotice);
    expect(auto).not.toContain(PROMPT_TEMPLATE.opaqueBackgroundNotice);
  });
});

describe("buildAssetPrompt — le prompt ne contient QUE les entrées autorisées", () => {
  it("ne laisse fuir aucune donnée non fournie en entrée", () => {
    const prompt = buildAssetPrompt(BASE);

    // Tout ce qui apparaît doit provenir des entrées ou du gabarit figé.
    const allowed = [
      ...Object.values(PROMPT_TEMPLATE).flat(),
      BASE.context,
      BASE.categoryName,
      BASE.categoryRule,
      BASE.request,
      "64",
      "×",
      "pixels",
      "Emprise cible de l'asset",
    ].join(" ");

    // Les mots « significatifs » du prompt doivent tous exister dans les entrées.
    const words = prompt.split(/\s+/).filter((word) => word.length > 3);
    const unexpected = words.filter((word) => !allowed.includes(word.replace(/[.,;:]$/, "")));
    expect(unexpected).toEqual([]);
  });
});
