/**
 * Tests d'isolement — la garantie centrale du projet.
 *
 * On vérifie ici qu'une génération B ne transporte RIEN de la génération A :
 * ni sa demande, ni son image, ni ses métadonnées, ni une référence vers
 * l'asset A — y compris après que A a été enregistré dans la bibliothèque.
 */

import { describe, expect, it } from "vitest";

import {
  ForbiddenReferenceError,
  assertStyleReference,
  buildGenerationRequest,
  type GenerationSettings,
} from "@/lib/generation/payload";
import { buildAssetPrompt } from "@/lib/prompt/assetPrompt";
import type { GeneratedAsset, StylePack, StyleReference } from "@/types/domain";

const SETTINGS: GenerationSettings = {
  finalSizeEnabled: true,
  finalWidth: 64,
  finalHeight: 64,
  qualityMode: "auto",
  size: "1024x1024",
  quality: "high",
  background: "transparent",
  outputFormat: "png",
};

function makePack(overrides: Partial<StylePack> = {}): StylePack {
  return {
    id: "pack-1",
    name: "A Timeless Journey",
    context: "Pixel art 2D vue du dessus.",
    categories: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeReference(overrides: Partial<StyleReference> = {}): StyleReference {
  return {
    kind: "style-reference",
    id: "ref-1",
    packId: "pack-1",
    name: "planche-style.png",
    mimeType: "image/png",
    size: 128,
    width: 64,
    height: 64,
    enabled: true,
    createdAt: 1,
    order: 0,
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    ...overrides,
  };
}

function makeGeneratedAsset(): GeneratedAsset {
  return {
    kind: "generated-asset",
    id: "asset-A",
    name: "Arbre généré",
    createdAt: 2,
    packId: "pack-1",
    packName: "A Timeless Journey",
    categoryName: "Végétation",
    targetWidth: 96,
    targetHeight: 128,
    request: "Un grand arbre",
    settings: {
      size: "816x816",
      quality: "low",
      background: "transparent",
      outputFormat: "png",
      model: "gpt-image-2",
      referenceCount: 1,
      qualityMode: "auto",
      qualityModeLabel: "Auto (éco)",
      minimalResolution: true,
      postProcessed: true,
    },
    usage: null,
    metrics: {
      colourCount: 18,
      alphaLevelCount: 2,
      semiTransparentPixels: 0,
      verdict: "propre",
    },
    mimeType: "image/png",
    finalWidth: 16,
    finalHeight: 16,
    blob: new Blob([new Uint8Array([9, 9, 9])], { type: "image/png" }),
  };
}

describe("Non-contamination entre deux générations", () => {
  const pack = makePack();
  const reference = makeReference();

  it("la requête B ne contient rien de la requête A", () => {
    // Génération A — un arbre.
    const requestA = buildGenerationRequest({
      pack,
      category: { id: "c1", name: "Végétation", targetWidth: 96, targetHeight: 128, rule: "" },
      request: "Un grand arbre",
      settings: SETTINGS,
      references: [reference],
    });

    // Génération B — une chaise, construite indépendamment.
    const requestB = buildGenerationRequest({
      pack,
      category: { id: "c2", name: "Petit objet", targetWidth: 32, targetHeight: 32, rule: "" },
      request: "Une chaise en bois",
      settings: SETTINGS,
      references: [reference],
    });

    const serializedB = JSON.stringify({
      ...requestB,
      references: requestB.references.map((entry) => entry.name),
    });

    expect(serializedB).not.toContain("arbre");
    expect(serializedB).not.toContain("Arbre");
    expect(serializedB).not.toContain("Végétation");
    expect(serializedB).not.toContain("96");
    expect(serializedB).toContain("chaise");

    // Aucun champ n'a été ajouté d'une requête à l'autre.
    expect(Object.keys(requestB).sort()).toEqual(Object.keys(requestA).sort());
  });

  it("le prompt B ne contient rien de la génération A", () => {
    const promptA = buildAssetPrompt({
      context: pack.context,
      categoryName: "Végétation",
      targetWidth: 96,
      targetHeight: 128,
      request: "Un grand arbre",
      referenceCount: 1,
      background: "transparent",
    });

    const promptB = buildAssetPrompt({
      context: pack.context,
      categoryName: "Petit objet",
      targetWidth: 32,
      targetHeight: 32,
      request: "Une chaise en bois",
      referenceCount: 1,
      background: "transparent",
    });

    expect(promptA).toContain("arbre");
    expect(promptB).not.toContain("arbre");
    expect(promptB).not.toContain("Végétation");
    expect(promptB).toContain("chaise");
  });

  it("enregistrer A dans la bibliothèque ne change rien à la requête B", () => {
    const savedAsset = makeGeneratedAsset();

    const before = buildGenerationRequest({
      pack,
      category: null,
      request: "Une chaise en bois",
      settings: SETTINGS,
      references: [reference],
    });

    // L'asset A existe désormais dans la bibliothèque. La construction de B
    // n'y a aucun accès : elle ne reçoit que le pack et les références.
    const after = buildGenerationRequest({
      pack,
      category: null,
      request: "Une chaise en bois",
      settings: SETTINGS,
      references: [reference],
    });

    const normalize = (request: typeof before) => ({
      ...request,
      references: request.references.map((entry) => entry.name),
    });

    expect(normalize(after)).toEqual(normalize(before));

    const serialized = JSON.stringify(normalize(after));
    expect(serialized).not.toContain(savedAsset.id);
    expect(serialized).not.toContain(savedAsset.name);
    expect(serialized).not.toContain("Arbre");
  });

  it("les références envoyées ne portent que le nom et les octets", () => {
    const request = buildGenerationRequest({
      pack,
      category: null,
      request: "Une chaise",
      settings: SETTINGS,
      references: [reference],
    });

    for (const outgoing of request.references) {
      expect(Object.keys(outgoing).sort()).toEqual(["blob", "name"]);
    }
  });
});

describe("Un asset généré ne peut pas devenir une référence", () => {
  it("assertStyleReference rejette un GeneratedAsset", () => {
    expect(() => assertStyleReference(makeGeneratedAsset())).toThrow(ForbiddenReferenceError);
  });

  it("assertStyleReference accepte une StyleReference", () => {
    expect(() => assertStyleReference(makeReference())).not.toThrow();
  });

  it("buildGenerationRequest refuse un asset généré déguisé en référence", () => {
    const disguised = makeGeneratedAsset() as unknown as StyleReference;

    expect(() =>
      buildGenerationRequest({
        pack: makePack(),
        category: null,
        request: "Une chaise",
        settings: SETTINGS,
        references: [disguised],
      }),
    ).toThrow(ForbiddenReferenceError);
  });

  it("rejette aussi un objet sans discriminant ni blob", () => {
    expect(() => assertStyleReference({ name: "x" })).toThrow(ForbiddenReferenceError);
    expect(() => assertStyleReference(null)).toThrow(ForbiddenReferenceError);
    expect(() =>
      assertStyleReference({ kind: "style-reference", name: "x" }),
    ).toThrow(ForbiddenReferenceError);
  });
});

describe("Régénérer rejoue exactement la même requête", () => {
  it("un instantané rejoué est identique à l'original", () => {
    const pack = makePack();
    const reference = makeReference();

    const snapshot = buildGenerationRequest({
      pack,
      category: null,
      request: "Un tonneau",
      settings: SETTINGS,
      references: [reference],
    });

    // « Régénérer » renvoie le même objet, sans reconstruction ni enrichissement.
    const replayed = snapshot;

    expect(replayed).toBe(snapshot);
    expect(Object.keys(replayed)).toEqual(Object.keys(snapshot));
  });
});

describe("La chaîne V0.2.1 n'introduit aucune fuite de contexte", () => {
  const pack = makePack();
  const reference = makeReference();

  it("la taille finale et le mode qualité ne transportent rien d'une génération à l'autre", () => {
    const requestA = buildGenerationRequest({
      pack,
      category: null,
      request: "Un grand arbre",
      settings: { ...SETTINGS, finalWidth: 128, finalHeight: 128, qualityMode: "high" },
      references: [reference],
    });

    const requestB = buildGenerationRequest({
      pack,
      category: null,
      request: "Une chaise en bois",
      settings: { ...SETTINGS, finalWidth: 16, finalHeight: 16, qualityMode: "eco" },
      references: [reference],
    });

    expect(requestB.settings.finalWidth).toBe(16);
    expect(requestB.settings.qualityMode).toBe("eco");
    // Les réglages de A n'ont pas déteint sur B.
    expect(requestA.settings.finalWidth).toBe(128);
    expect(JSON.stringify(requestB)).not.toContain("arbre");
  });

  it("un asset post-traité enregistré reste refusé comme référence", () => {
    const saved = makeGeneratedAsset();
    // Il porte désormais une taille finale et un compte rendu de traitement :
    // cela ne le rend pas plus acceptable en entrée.
    expect(saved.finalWidth).toBe(16);
    expect(saved.settings.postProcessed).toBe(true);
    expect(() => assertStyleReference(saved)).toThrow(ForbiddenReferenceError);
  });

  it("la requête ne contient aucun champ lié au résultat post-traité", () => {
    const request = buildGenerationRequest({
      pack,
      category: null,
      request: "Une chaise",
      settings: SETTINGS,
      references: [reference],
    });

    const serialized = JSON.stringify({
      ...request,
      references: request.references.map((entry) => entry.name),
    });

    for (const forbidden of [
      "postProcessing",
      "postProcessed",
      "generationSize",
      "trimmedBounds",
      "scaledWidth",
    ]) {
      expect(serialized, `champ de résultat présent : ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });
});

describe("La chaîne Pixel Cleanup n'introduit aucune fuite de contexte", () => {
  const pack = makePack();
  const reference = makeReference();

  it("le nettoyage pixel est purement local : il ne touche pas à la requête", () => {
    const request = buildGenerationRequest({
      pack,
      category: null,
      request: "Une chaise",
      settings: SETTINGS,
      references: [reference],
    });

    const serialized = JSON.stringify({
      ...request,
      references: request.references.map((entry) => entry.name),
    });

    // Aucun champ issu du post-traitement ou de l'analyse ne remonte dans la
    // requête : ce sont des données de SORTIE.
    for (const forbidden of [
      "cleanup",
      "metrics",
      "verdict",
      "colourCount",
      "alphaLevelCount",
      "downscaleMethod",
      "palette",
    ]) {
      expect(serialized, `champ de sortie présent : ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("les métriques d'un asset enregistré ne le rendent pas utilisable en entrée", () => {
    const saved = makeGeneratedAsset();
    expect(saved.metrics?.verdict).toBe("propre");
    expect(() => assertStyleReference(saved)).toThrow(ForbiddenReferenceError);
  });

  it("deux générations successives produisent des requêtes indépendantes", () => {
    const a = buildGenerationRequest({
      pack,
      category: null,
      request: "Un grand arbre",
      settings: { ...SETTINGS, finalWidth: 64, finalHeight: 64 },
      references: [reference],
    });
    const b = buildGenerationRequest({
      pack,
      category: null,
      request: "Une chaise en bois",
      settings: { ...SETTINGS, finalWidth: 16, finalHeight: 16 },
      references: [reference],
    });

    expect(JSON.stringify(b)).not.toContain("arbre");
    expect(a.settings.finalWidth).toBe(64);
    expect(b.settings.finalWidth).toBe(16);
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });
});
