"use client";

/**
 * Ouverture et migration de la base IndexedDB.
 *
 * ---------------------------------------------------------------------------
 * DEUX STORES, VOLONTAIREMENT SÉPARÉS
 * ---------------------------------------------------------------------------
 *   `styleReferences` — ENTRÉES : images de référence des Style Packs.
 *   `generatedAssets` — SORTIES : bibliothèque d'assets générés.
 *
 * Aucun code ne lit les deux stores : `storage/styleReferences.ts` et
 * `storage/generatedAssets.ts` sont deux modules distincts, chacun limité à
 * son store. Une erreur de requête ne peut donc pas ramener un asset généré
 * là où une référence est attendue.
 * ---------------------------------------------------------------------------
 *
 * Historique du schéma :
 *   v1 (V0.1) — store unique `references`, sans notion de Style Pack.
 *   v2 (V0.2) — `styleReferences` (+ index `packId`) et `generatedAssets`.
 *               Les références v1 sont recopiées et rattachées au pack de
 *               migration, puis l'ancien store est supprimé.
 */

const DB_NAME = "asset-generator";
const DB_VERSION = 2;

export const STORE_STYLE_REFERENCES = "styleReferences";
export const STORE_GENERATED_ASSETS = "generatedAssets";

/** Ancien store de la V0.1, conservé le temps de la migration. */
const LEGACY_STORE_REFERENCES = "references";

/**
 * Identifiant du Style Pack qui recueille les données de la V0.1.
 * Fixe : la migration IndexedDB et la migration `localStorage` doivent
 * converger vers le même pack sans se coordonner.
 */
export const LEGACY_PACK_ID = "pack-v01";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const transaction = request.transaction;
      if (!transaction) return;

      if (!db.objectStoreNames.contains(STORE_STYLE_REFERENCES)) {
        const store = db.createObjectStore(STORE_STYLE_REFERENCES, { keyPath: "id" });
        store.createIndex("packId", "packId", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_GENERATED_ASSETS)) {
        const store = db.createObjectStore(STORE_GENERATED_ASSETS, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }

      const upgradingFromV1 =
        event.oldVersion >= 1 && db.objectStoreNames.contains(LEGACY_STORE_REFERENCES);

      if (upgradingFromV1) {
        migrateLegacyReferences(transaction, db);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () =>
      reject(new Error("IndexedDB upgrade blocked by another open tab"));
  });

  return dbPromise;
}

/**
 * Recopie les références de la V0.1 vers le nouveau store en les rattachant au
 * pack de migration, puis supprime l'ancien store.
 *
 * Tout se déroule dans la transaction de mise à jour : soit la migration
 * aboutit entièrement, soit rien n'est modifié.
 */
function migrateLegacyReferences(transaction: IDBTransaction, db: IDBDatabase): void {
  const legacy = transaction.objectStore(LEGACY_STORE_REFERENCES);
  const target = transaction.objectStore(STORE_STYLE_REFERENCES);

  const readAll = legacy.getAll();
  readAll.onsuccess = () => {
    for (const record of readAll.result as Array<Record<string, unknown>>) {
      target.put({
        ...record,
        kind: "style-reference",
        packId: LEGACY_PACK_ID,
      });
    }
    // L'ancien store n'a plus de raison d'exister une fois recopié.
    db.deleteObjectStore(LEGACY_STORE_REFERENCES);
  };
}

/**
 * Exécute une requête sur UN store donné.
 * Le store est passé explicitement : aucun helper ne peut ouvrir les deux.
 */
export function runRequest<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = operation(transaction.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error(`IndexedDB request failed on ${storeName}`));
      }),
  );
}

/**
 * Ferme la connexion et vide le cache.
 *
 * Utile aux tests, qui recréent la base entre deux cas : sans fermeture,
 * `indexedDB.deleteDatabase` reste bloqué par la connexion ouverte.
 */
export function closeDatabase(): void {
  const pending = dbPromise;
  dbPromise = null;
  pending?.then((db) => db.close()).catch(() => undefined);
}

export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
