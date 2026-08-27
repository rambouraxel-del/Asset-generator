/**
 * @vitest-environment happy-dom
 *
 * Style Packs et stockage local : création, duplication, isolement des
 * références entre packs, et migration des données de la V0.1.
 *
 * IndexedDB est fourni par `fake-indexeddb`, ce qui permet d'exercer la vraie
 * logique de migration `onupgradeneeded` plutôt qu'une imitation.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LEGACY_PACK_ID } from "@/lib/storage/db";
import {
  createDefaultCategories,
  createPack,
  loadPacks,
  savePacks,
} from "@/lib/storage/packs";
import type { StyleReference } from "@/types/domain";

const DB_NAME = "asset-generator";

/**
 * Vide localStorage et supprime la base entre deux tests.
 *
 * L'ordre compte : la connexion ouverte par le test précédent doit être
 * fermée AVANT `deleteDatabase`, sinon la suppression reste bloquée. Le cache
 * de modules n'est réinitialisé qu'ensuite, pour que le test suivant reparte
 * d'un module vierge.
 */
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

/** Crée une base au format V0.1 (v1, store `references`) avec des données. */
function seedLegacyDatabase(references: Array<Record<string, unknown>>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("references", { keyPath: "id" });
      store.createIndex("order", "order", { unique: false });
    };
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("references", "readwrite");
      const store = transaction.objectStore("references");
      for (const reference of references) store.put(reference);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
}

function legacyReference(id: string): Record<string, unknown> {
  return {
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    size: 64,
    width: 32,
    height: 32,
    enabled: true,
    createdAt: 1,
    order: 0,
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
  };
}

describe("Style Packs — création et persistance", () => {
  it("crée un pack avec les catégories initiales", () => {
    const pack = createPack({ name: "Office Escape" });

    expect(pack.name).toBe("Office Escape");
    expect(pack.categories.length).toBeGreaterThan(0);
    expect(pack.categories.map((category) => category.name)).toContain("Personnage");
    expect(pack.id).toMatch(/^pack-/);
  });

  it("relit les packs enregistrés à l'identique", () => {
    const packs = [createPack({ name: "Pack A" }), createPack({ name: "Pack B" })];
    savePacks(packs);

    const reloaded = loadPacks();
    expect(reloaded.map((pack) => pack.name)).toEqual(["Pack A", "Pack B"]);
    expect(reloaded[0].categories.length).toBe(packs[0].categories.length);
  });

  it("complète un pack enregistré par une version antérieure", () => {
    // Pack sans `categories` ni `updatedAt` : ne doit pas faire planter la lecture.
    window.localStorage.setItem(
      "asset-generator:packs",
      JSON.stringify([{ id: "pack-x", name: "Ancien", context: "ctx" }]),
    );

    const [pack] = loadPacks();
    expect(pack.categories).toEqual([]);
    expect(typeof pack.updatedAt).toBe("number");
  });

  it("ignore un contenu corrompu sans lever d'erreur", () => {
    window.localStorage.setItem("asset-generator:packs", "{ pas du json");
    expect(loadPacks()).toEqual([]);
  });

  it("duplique les catégories en profondeur", () => {
    const source = createPack({ name: "Source" });
    const copy = createPack({
      name: "Source (copie)",
      context: source.context,
      categories: source.categories.map((category) => ({ ...category, id: `${category.id}-c` })),
    });

    copy.categories[0].name = "Renommée dans la copie";
    expect(source.categories[0].name).not.toBe("Renommée dans la copie");
  });

  it("les catégories initiales portent des identifiants distincts", () => {
    const categories = createDefaultCategories();
    const ids = new Set(categories.map((category) => category.id));
    expect(ids.size).toBe(categories.length);
  });
});

describe("Isolement des références entre packs", () => {
  it("un pack ne voit jamais les références d'un autre", async () => {
    const { putReferences, listReferencesForPack } = await import(
      "@/lib/storage/styleReferences"
    );

    const makeReference = (id: string, packId: string): StyleReference => ({
      kind: "style-reference",
      id,
      packId,
      name: `${id}.png`,
      mimeType: "image/png",
      size: 64,
      width: 32,
      height: 32,
      enabled: true,
      createdAt: 1,
      order: 0,
      blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
    });

    await putReferences([
      makeReference("ref-a1", "pack-A"),
      makeReference("ref-a2", "pack-A"),
      makeReference("ref-b1", "pack-B"),
    ]);

    const packA = await listReferencesForPack("pack-A");
    const packB = await listReferencesForPack("pack-B");

    expect(packA.map((reference) => reference.id).sort()).toEqual(["ref-a1", "ref-a2"]);
    expect(packB.map((reference) => reference.id)).toEqual(["ref-b1"]);
    expect(packB.every((reference) => reference.packId === "pack-B")).toBe(true);
  });

  it("supprimer un pack n'efface que ses références", async () => {
    const { putReferences, listReferencesForPack, deleteReferencesForPack } = await import(
      "@/lib/storage/styleReferences"
    );

    const reference = (id: string, packId: string): StyleReference => ({
      kind: "style-reference",
      id,
      packId,
      name: `${id}.png`,
      mimeType: "image/png",
      size: 1,
      width: 1,
      height: 1,
      enabled: true,
      createdAt: 1,
      order: 0,
      blob: new Blob([new Uint8Array([1])]),
    });

    await putReferences([reference("a", "pack-A"), reference("b", "pack-B")]);
    await deleteReferencesForPack("pack-A");

    expect(await listReferencesForPack("pack-A")).toEqual([]);
    expect((await listReferencesForPack("pack-B")).length).toBe(1);
  });

  it("dupliquer un pack copie ses références sans les partager", async () => {
    const { putReferences, listReferencesForPack, copyReferencesToPack } = await import(
      "@/lib/storage/styleReferences"
    );

    await putReferences([
      {
        kind: "style-reference",
        id: "src-1",
        packId: "pack-src",
        name: "planche.png",
        mimeType: "image/png",
        size: 10,
        width: 8,
        height: 8,
        enabled: true,
        createdAt: 1,
        order: 0,
        blob: new Blob([new Uint8Array([7])]),
      },
    ]);

    await copyReferencesToPack("pack-src", "pack-copy");

    const source = await listReferencesForPack("pack-src");
    const copy = await listReferencesForPack("pack-copy");

    expect(copy.length).toBe(1);
    expect(copy[0].name).toBe("planche.png");
    // Identifiants distincts : modifier la copie n'affecte pas l'original.
    expect(copy[0].id).not.toBe(source[0].id);
    expect(copy[0].packId).toBe("pack-copy");
  });
});

describe("Migration des données V0.1", () => {
  it("rapatrie contexte et références dans un pack « Style Pack V0.1 »", async () => {
    await seedLegacyDatabase([legacyReference("old-1"), legacyReference("old-2")]);
    window.localStorage.setItem(
      "asset-generator:context",
      "Contexte hérité de la V0.1",
    );

    const { bootstrapStorage, LEGACY_PACK_NAME } = await import("@/lib/storage/bootstrap");
    const { listReferencesForPack } = await import("@/lib/storage/styleReferences");

    const result = await bootstrapStorage();

    expect(result.migratedFromV1).toBe(true);
    expect(result.packs).toHaveLength(1);
    expect(result.packs[0].name).toBe(LEGACY_PACK_NAME);
    expect(result.packs[0].id).toBe(LEGACY_PACK_ID);
    expect(result.packs[0].context).toBe("Contexte hérité de la V0.1");

    // Les références V0.1 sont rattachées au pack de migration.
    const references = await listReferencesForPack(LEGACY_PACK_ID);
    expect(references.map((reference) => reference.id).sort()).toEqual(["old-1", "old-2"]);
    expect(references.every((reference) => reference.kind === "style-reference")).toBe(true);
  });

  it("migre les références même sans contexte enregistré", async () => {
    await seedLegacyDatabase([legacyReference("solo")]);

    const { bootstrapStorage } = await import("@/lib/storage/bootstrap");
    const { listReferencesForPack } = await import("@/lib/storage/styleReferences");

    const result = await bootstrapStorage();

    expect(result.migratedFromV1).toBe(true);
    expect((await listReferencesForPack(LEGACY_PACK_ID)).length).toBe(1);
  });

  it("crée un pack par défaut lors d'une première visite", async () => {
    const { bootstrapStorage, DEFAULT_PACK_NAME } = await import("@/lib/storage/bootstrap");

    const result = await bootstrapStorage();

    expect(result.migratedFromV1).toBe(false);
    expect(result.packs[0].name).toBe(DEFAULT_PACK_NAME);
    expect(result.packs[0].categories.length).toBeGreaterThan(0);
  });

  it("est idempotente : relancer le démarrage ne duplique rien", async () => {
    await seedLegacyDatabase([legacyReference("old-1")]);
    window.localStorage.setItem("asset-generator:context", "Contexte V0.1");

    const { bootstrapStorage } = await import("@/lib/storage/bootstrap");

    const first = await bootstrapStorage();
    const second = await bootstrapStorage();

    expect(first.packs).toHaveLength(1);
    expect(second.packs).toHaveLength(1);
    expect(second.migratedFromV1).toBe(false);
    expect(second.packs[0].id).toBe(first.packs[0].id);
  });

  it("ne touche pas aux packs V0.2 déjà présents", async () => {
    savePacks([createPack({ name: "Pack existant" })]);
    window.localStorage.setItem("asset-generator:context", "Contexte V0.1 ignoré");

    const { bootstrapStorage } = await import("@/lib/storage/bootstrap");
    const result = await bootstrapStorage();

    expect(result.migratedFromV1).toBe(false);
    expect(result.packs).toHaveLength(1);
    expect(result.packs[0].name).toBe("Pack existant");
  });
});
