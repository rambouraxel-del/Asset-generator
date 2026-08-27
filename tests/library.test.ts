/**
 * @vitest-environment happy-dom
 *
 * Bibliothèque d'assets générés : persistance, et surtout preuve que les deux
 * stores restent étanches — un asset enregistré ne rejoint jamais les
 * références de style.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GeneratedAsset, StyleReference } from "@/types/domain";

const DB_NAME = "asset-generator";

async function resetStorage(): Promise<void> {
  const db = await import("@/lib/storage/db");
  db.closeDatabase();
  window.localStorage.clear();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
  vi.resetModules();
}

beforeEach(async () => {
  await resetStorage();
});

function makeAsset(id: string, name: string): GeneratedAsset {
  return {
    kind: "generated-asset",
    id,
    name,
    createdAt: Number(id.replace(/\D/g, "")) || 1,
    packId: "pack-1",
    packName: "A Timeless Journey",
    categoryName: "Végétation",
    targetWidth: 96,
    targetHeight: 128,
    request: `Demande ayant produit ${name}`,
    settings: {
      size: "1024x1024",
      quality: "high",
      background: "transparent",
      outputFormat: "png",
      model: "gpt-image-2",
      referenceCount: 2,
    },
    usage: null,
    mimeType: "image/png",
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
  };
}

describe("Bibliothèque — persistance", () => {
  it("enregistre et relit un asset avec toutes ses métadonnées", async () => {
    const { putGeneratedAsset, listGeneratedAssets } = await import(
      "@/lib/storage/generatedAssets"
    );

    await putGeneratedAsset(makeAsset("asset-1", "Grand chêne"));
    const [stored] = await listGeneratedAssets();

    expect(stored.name).toBe("Grand chêne");
    expect(stored.packName).toBe("A Timeless Journey");
    expect(stored.categoryName).toBe("Végétation");
    expect(stored.targetWidth).toBe(96);
    expect(stored.request).toContain("Grand chêne");
    expect(stored.settings.size).toBe("1024x1024");
    expect(stored.settings.model).toBe("gpt-image-2");
    // `fake-indexeddb` reconstruit un objet équivalent plutôt qu'une instance
    // de `Blob` : on vérifie donc les données transportées, et la vraie
    // conservation du Blob est contrôlée par le test navigateur.
    expect(stored.blob.type).toBe("image/png");
  });

  it("trie du plus récent au plus ancien", async () => {
    const { putGeneratedAsset, listGeneratedAssets } = await import(
      "@/lib/storage/generatedAssets"
    );

    await putGeneratedAsset(makeAsset("asset-1", "Ancien"));
    await putGeneratedAsset(makeAsset("asset-3", "Récent"));

    const assets = await listGeneratedAssets();
    expect(assets.map((asset) => asset.name)).toEqual(["Récent", "Ancien"]);
  });

  it("supprime un asset sans toucher aux autres", async () => {
    const { putGeneratedAsset, deleteGeneratedAsset, listGeneratedAssets } = await import(
      "@/lib/storage/generatedAssets"
    );

    await putGeneratedAsset(makeAsset("asset-1", "A"));
    await putGeneratedAsset(makeAsset("asset-2", "B"));
    await deleteGeneratedAsset("asset-1");

    const assets = await listGeneratedAssets();
    expect(assets.map((asset) => asset.name)).toEqual(["B"]);
  });
});

describe("Étanchéité entre bibliothèque et références", () => {
  it("un asset enregistré n'apparaît dans aucune liste de références", async () => {
    const { putGeneratedAsset } = await import("@/lib/storage/generatedAssets");
    const { putReferences, listReferencesForPack } = await import(
      "@/lib/storage/styleReferences"
    );

    const reference: StyleReference = {
      kind: "style-reference",
      id: "ref-1",
      packId: "pack-1",
      name: "planche.png",
      mimeType: "image/png",
      size: 10,
      width: 8,
      height: 8,
      enabled: true,
      createdAt: 1,
      order: 0,
      blob: new Blob([new Uint8Array([4])]),
    };

    await putReferences([reference]);
    await putGeneratedAsset(makeAsset("asset-1", "Arbre généré"));

    const references = await listReferencesForPack("pack-1");

    // L'asset partage pourtant le même packId : seul le store les sépare.
    expect(references).toHaveLength(1);
    expect(references[0].id).toBe("ref-1");
    expect(references.every((entry) => entry.kind === "style-reference")).toBe(true);
    expect(references.some((entry) => entry.id === "asset-1")).toBe(false);
  });

  it("enregistrer dans la bibliothèque n'ajoute aucune référence", async () => {
    const { putGeneratedAsset } = await import("@/lib/storage/generatedAssets");
    const { listReferencesForPack, countReferencesForPack } = await import(
      "@/lib/storage/styleReferences"
    );

    expect(await countReferencesForPack("pack-1")).toBe(0);

    await putGeneratedAsset(makeAsset("asset-1", "Arbre"));
    await putGeneratedAsset(makeAsset("asset-2", "Chaise"));

    expect(await countReferencesForPack("pack-1")).toBe(0);
    expect(await listReferencesForPack("pack-1")).toEqual([]);
  });

  it("supprimer les références d'un pack ne touche pas à la bibliothèque", async () => {
    const { putGeneratedAsset, listGeneratedAssets } = await import(
      "@/lib/storage/generatedAssets"
    );
    const { putReferences, deleteReferencesForPack } = await import(
      "@/lib/storage/styleReferences"
    );

    await putReferences([
      {
        kind: "style-reference",
        id: "ref-1",
        packId: "pack-1",
        name: "planche.png",
        mimeType: "image/png",
        size: 10,
        width: 8,
        height: 8,
        enabled: true,
        createdAt: 1,
        order: 0,
        blob: new Blob([new Uint8Array([4])]),
      },
    ]);
    await putGeneratedAsset(makeAsset("asset-1", "Arbre"));

    await deleteReferencesForPack("pack-1");

    const assets = await listGeneratedAssets();
    expect(assets).toHaveLength(1);
    expect(assets[0].name).toBe("Arbre");
  });

  it("un asset relu depuis la bibliothèque reste refusé par le chemin de génération", async () => {
    const { putGeneratedAsset, listGeneratedAssets } = await import(
      "@/lib/storage/generatedAssets"
    );
    const { assertStyleReference, ForbiddenReferenceError } = await import(
      "@/lib/generation/payload"
    );

    await putGeneratedAsset(makeAsset("asset-1", "Arbre"));
    const [stored] = await listGeneratedAssets();

    // Même après un aller-retour dans IndexedDB, le discriminant tient.
    expect(stored.kind).toBe("generated-asset");
    expect(() => assertStyleReference(stored)).toThrow(ForbiddenReferenceError);
  });
});
