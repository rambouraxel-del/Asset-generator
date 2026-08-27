"use client";

/**
 * Accès à la BIBLIOTHÈQUE D'ASSETS GÉNÉRÉS (sorties).
 *
 * ---------------------------------------------------------------------------
 * CE MODULE EST UN CUL-DE-SAC
 * ---------------------------------------------------------------------------
 * Rien de ce qu'il renvoie ne doit rejoindre une requête de génération. Il ne
 * doit être importé que par la bibliothèque (`hooks/useLibrary.ts` et les
 * composants `components/library/`) — jamais par le chemin de génération.
 *
 * Le type `GeneratedAsset` porte `kind: "generated-asset"` : même en cas
 * d'erreur d'import, un asset ne peut pas être passé là où une
 * `StyleReference` est attendue (échec de compilation), et l'assertion de
 * `lib/generation/payload.ts` le rejetterait à l'exécution.
 * ---------------------------------------------------------------------------
 */

import { LIBRARY_MAX_ASSETS } from "@/lib/config";
import type { GeneratedAsset } from "@/types/domain";
import { STORE_GENERATED_ASSETS, createId, runRequest } from "@/lib/storage/db";

export function createGeneratedAssetId(): string {
  return createId("asset");
}

/** Assets de la bibliothèque, du plus récent au plus ancien. */
export async function listGeneratedAssets(): Promise<GeneratedAsset[]> {
  const records = await runRequest<GeneratedAsset[]>(
    STORE_GENERATED_ASSETS,
    "readonly",
    (store) => store.getAll() as IDBRequest<GeneratedAsset[]>,
  );
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

export async function putGeneratedAsset(asset: GeneratedAsset): Promise<void> {
  await runRequest(STORE_GENERATED_ASSETS, "readwrite", (store) => store.put(asset));
}

export async function deleteGeneratedAsset(id: string): Promise<void> {
  await runRequest(STORE_GENERATED_ASSETS, "readwrite", (store) => store.delete(id));
}

export async function countGeneratedAssets(): Promise<number> {
  return runRequest<number>(STORE_GENERATED_ASSETS, "readonly", (store) => store.count());
}

/** `true` si la bibliothèque locale a atteint son plafond. */
export async function isLibraryFull(): Promise<boolean> {
  return (await countGeneratedAssets()) >= LIBRARY_MAX_ASSETS;
}
