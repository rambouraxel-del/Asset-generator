"use client";

/**
 * Stockage local des images de référence (IndexedDB).
 *
 * IndexedDB plutôt que localStorage : les blobs binaires y sont stockes
 * nativement, sans surcoût base64, et le quota est bien plus large.
 *
 * Le schéma porte un numéro de version : ajouter un champ (style pack,
 * catégorie, tags...) en V0.2 se fera par une migration `onupgradeneeded`
 * sans casser les données existantes.
 */

import type { AcceptedImageMimeType } from "@/lib/config";

const DB_NAME = "asset-generator";
const DB_VERSION = 1;
const STORE_REFERENCES = "references";

/** Une image de référence telle que persistee dans le navigateur. */
export interface ReferenceImage {
  id: string;
  name: string;
  mimeType: AcceptedImageMimeType;
  /** Taille du blob en octets. */
  size: number;
  width: number;
  height: number;
  /** Seules les références activées sont envoyées à la génération. */
  enabled: boolean;
  createdAt: number;
  /** Position d'affichage et d'envoi. */
  order: number;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_REFERENCES)) {
        const store = db.createObjectStore(STORE_REFERENCES, { keyPath: "id" });
        store.createIndex("order", "order", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });

  return dbPromise;
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_REFERENCES, mode);
        const request = operation(transaction.objectStore(STORE_REFERENCES));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error("IndexedDB request failed"));
      }),
  );
}

export async function listReferences(): Promise<ReferenceImage[]> {
  const all = await runTransaction<ReferenceImage[]>("readonly", (store) =>
    store.getAll() as IDBRequest<ReferenceImage[]>,
  );
  return all.sort((a, b) => a.order - b.order);
}

export async function putReference(reference: ReferenceImage): Promise<void> {
  await runTransaction("readwrite", (store) => store.put(reference));
}

export async function deleteReference(id: string): Promise<void> {
  await runTransaction("readwrite", (store) => store.delete(id));
}

export async function clearReferences(): Promise<void> {
  await runTransaction("readwrite", (store) => store.clear());
}

export function createReferenceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
