import { describe, expect, it } from "vitest";

import { PROMPT_TEMPLATE, buildAssetPrompt } from "@/lib/prompt/assetPrompt";

const BASE = {
  context: "Pixel art 2D vue du dessus.\nFond transparent.",
  request: "Un grand chene, environ deux fois la hauteur d'un humain.",
  referenceCount: 3,
  background: "transparent" as const,
};

describe("buildAssetPrompt", () => {
  it("assemble les trois blocs autorises", () => {
    const prompt = buildAssetPrompt(BASE);

    expect(prompt).toContain(PROMPT_TEMPLATE.intro);
    expect(prompt).toContain(PROMPT_TEMPLATE.styleHeading);
    expect(prompt).toContain(BASE.context);
    expect(prompt).toContain(PROMPT_TEMPLATE.referencesNotice);
    expect(prompt).toContain(PROMPT_TEMPLATE.assetHeading);
    expect(prompt).toContain(BASE.request);
    for (const constraint of PROMPT_TEMPLATE.constraints) {
      expect(prompt).toContain(constraint);
    }
  });

  it("est pur : memes entrees, meme sortie (aucune memoire entre appels)", () => {
    const first = buildAssetPrompt(BASE);
    buildAssetPrompt({ ...BASE, request: "Une hache de bucheron" });
    const third = buildAssetPrompt(BASE);

    expect(third).toBe(first);
    // Aucune trace de la demande intercalee.
    expect(third).not.toContain("hache");
  });

  it("omet le bloc de regles quand le contexte est vide", () => {
    const prompt = buildAssetPrompt({ ...BASE, context: "   " });
    expect(prompt).not.toContain(PROMPT_TEMPLATE.styleHeading);
  });

  it("signale l'absence de reference", () => {
    const prompt = buildAssetPrompt({ ...BASE, referenceCount: 0 });
    expect(prompt).toContain(PROMPT_TEMPLATE.noReferencesNotice);
    expect(prompt).not.toContain(PROMPT_TEMPLATE.referencesNotice);
  });

  it("ajoute la consigne de transparence uniquement si demandee", () => {
    expect(buildAssetPrompt(BASE)).toContain(PROMPT_TEMPLATE.transparentBackgroundNotice);
    expect(buildAssetPrompt({ ...BASE, background: "opaque" })).not.toContain(
      PROMPT_TEMPLATE.transparentBackgroundNotice,
    );
  });
});
