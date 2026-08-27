"use client";

/**
 * Accès aux RÉFÉRENCES DE STYLE (entrées de génération).
 *
 * Ce module ne touche qu'au store `styleReferences`. Il ne connaît pas
 * l'existence de la bibliothèque d'assets générés — c'est volontaire, et cela
 * doit le rester : voir l'en-tête de `types/domain.ts`.
 */

import type { StyleReference } from "@/types/domain";
import { STORE_STYLE_REFERENCES, createId, runRequest } from "@/lib/storage/db";

export function createStyleReferenceId(): string {
  return createId("ref");
}

/** Références d'un Style Pack donné, dans leur ordre d'affichage et d'envoi. */
export async function listReferencesForPack(packId: string): Promise<StyleReference[]> {
  const records = await runRequest<StyleReference[]>(
    STORE_STYLE_REFERENCES,
    "readonly",
    (store) => store.index("packId").getAll(packId) as IDBRequest<StyleReference[]>,
  );
  return records.sort((a, b) => a.order - b.order);
}

export async function putReference(reference: StyleReference): Promise<void> {
  await runRequest(STORE_STYLE_REFERENCES, "readwrite", (store) => store.put(reference));
}

export async function putReferences(references: StyleReference[]): Promise<void> {
  await Promise.all(references.map(putReference));
}

export async function deleteReference(id: string): Promise<void> {
  await runRequest(STORE_STYLE_REFERENCES, "readwrite", (store) => store.delete(id));
}

/** Supprime toutes les références d'un pack (appelé à la suppression du pack). */
export async function deleteReferencesForPack(packId: string): Promise<void> {
  const references = await listReferencesForPack(packId);
  await Promise.all(references.map((reference) => deleteReference(reference.id)));
}

/** Duplique les références d'un pack vers un autre (duplication de Style Pack). */
export async function copyReferencesToPack(
  sourcePackId: string,
  targetPackId: string,
): Promise<void> {
  const references = await listReferencesForPack(sourcePackId);
  await putReferences(
    references.map((reference) => ({
      ...reference,
      id: createStyleReferenceId(),
      packId: targetPackId,
      createdAt: Date.now(),
    })),
  );
}

/** Nombre de références rattachées à un pack, sans charger les blobs. */
export async function countReferencesForPack(packId: string): Promise<number> {
  return runRequest<number>(STORE_STYLE_REFERENCES, "readonly", (store) =>
    store.index("packId").count(packId),
  );
}
