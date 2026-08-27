"use client";

/**
 * Bibliothèque d'assets générés.
 *
 * ---------------------------------------------------------------------------
 * SORTIES UNIQUEMENT
 * ---------------------------------------------------------------------------
 * Ce hook est le seul point d'accès aux assets générés côté interface. Il est
 * consommé par l'onglet Bibliothèque et par le bouton « Ajouter à la
 * bibliothèque » — jamais par le chemin de génération.
 *
 * Un asset ajouté ici ne rejoint JAMAIS les références de style : rien dans ce
 * module n'écrit dans le store des références, et le type `GeneratedAsset`
 * est structurellement incompatible avec `StyleReference`.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { LIBRARY_MAX_ASSETS, NAME_LIMITS } from "@/lib/config";
import {
  createGeneratedAssetId,
  deleteGeneratedAsset,
  listGeneratedAssets,
  putGeneratedAsset,
} from "@/lib/storage/generatedAssets";
import type { GeneratedAsset } from "@/types/domain";

const LIBRARY_ERROR =
  "La bibliothèque n'a pas pu être mise à jour dans ce navigateur. Réessayez, ou libérez de l'espace de stockage.";

export interface NewLibraryAsset {
  name: string;
  packId: string;
  packName: string;
  categoryName: string | null;
  targetWidth: number | null;
  targetHeight: number | null;
  request: string;
  settings: GeneratedAsset["settings"];
  usage: GeneratedAsset["usage"];
  mimeType: string;
  blob: Blob;
}

export function useLibrary() {
  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listGeneratedAssets()
      .then((stored) => {
        if (!cancelled) setAssets(stored);
      })
      .catch(() => {
        if (!cancelled) {
          setError("La bibliothèque enregistrée n'a pas pu être chargée.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Aperçus dérivés des blobs, révoqués dès qu'ils ne servent plus.
  const previewKey = assets.map((asset) => asset.id).join("|");
  const previews = useMemo(() => {
    const map: Record<string, string> = {};
    for (const asset of assets) map[asset.id] = URL.createObjectURL(asset.blob);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  useEffect(
    () => () => {
      for (const url of Object.values(previews)) URL.revokeObjectURL(url);
    },
    [previews],
  );

  const addAsset = useCallback(
    async (input: NewLibraryAsset): Promise<boolean> => {
      setError(null);

      if (assets.length >= LIBRARY_MAX_ASSETS) {
        setError(
          `La bibliothèque locale est pleine (${LIBRARY_MAX_ASSETS} assets). Supprimez-en avant d'en ajouter.`,
        );
        return false;
      }

      const asset: GeneratedAsset = {
        kind: "generated-asset",
        id: createGeneratedAssetId(),
        createdAt: Date.now(),
        ...input,
        name: input.name.trim().slice(0, NAME_LIMITS.ASSET_NAME_MAX_CHARS) || "Asset",
      };

      try {
        await putGeneratedAsset(asset);
        setAssets((current) => [asset, ...current]);
        return true;
      } catch {
        setError(LIBRARY_ERROR);
        return false;
      }
    },
    [assets.length],
  );

  const renameAsset = useCallback(
    (id: string, name: string) => {
      const target = assets.find((asset) => asset.id === id);
      if (!target) return;
      const updated: GeneratedAsset = {
        ...target,
        name: name.trim().slice(0, NAME_LIMITS.ASSET_NAME_MAX_CHARS) || target.name,
      };
      setAssets(assets.map((asset) => (asset.id === id ? updated : asset)));
      putGeneratedAsset(updated).catch(() => setError(LIBRARY_ERROR));
    },
    [assets],
  );

  const removeAsset = useCallback(
    (id: string) => {
      setAssets((current) => current.filter((asset) => asset.id !== id));
      deleteGeneratedAsset(id).catch(() => setError(LIBRARY_ERROR));
    },
    [],
  );

  return {
    assets,
    previews,
    loading,
    error,
    clearError: useCallback(() => setError(null), []),
    addAsset,
    renameAsset,
    removeAsset,
  };
}
