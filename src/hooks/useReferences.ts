"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { LIMITS } from "@/lib/config";
import { AppError, userMessageFor } from "@/lib/errors";
import { prepareReferenceImage } from "@/lib/client/prepareImage";
import {
  createReferenceId,
  deleteReference,
  listReferences,
  putReference,
  type ReferenceImage,
} from "@/lib/storage/references";

const STORAGE_ERROR =
  "Les références n'ont pas pu être enregistrées dans ce navigateur. Elles resteront disponibles jusqu'au prochain rechargement.";

/**
 * Gestion des images de référence : import, activation, suppression.
 *
 * L'état React est la source d'affichage ; IndexedDB assure la persistance.
 * Les modifications sont appliquées à l'écran immédiatement puis persistées
 * en arrière-plan, afin que l'interface reste réactive sur mobile.
 */
export function useReferences() {
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /*
   * Les URL d'aperçu sont dérivées des blobs. La clé de mémoïsation ne dépend
   * que des identifiants : basculer l'activation d'une référence ne recree
   * donc pas inutilement toutes les URL.
   */
  const previewKey = references.map((reference) => reference.id).join("|");
  const previews = useMemo(() => {
    const map: Record<string, string> = {};
    for (const reference of references) {
      map[reference.id] = URL.createObjectURL(reference.blob);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  // Libere le jeu d'URL précédent des qu'il n'est plus affiché.
  useEffect(
    () => () => {
      for (const url of Object.values(previews)) URL.revokeObjectURL(url);
    },
    [previews],
  );

  // Chargement initial depuis IndexedDB.
  useEffect(() => {
    let cancelled = false;
    listReferences()
      .then((stored) => {
        if (!cancelled) setReferences(stored);
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            "Les références enregistrées n'ont pas pu être chargées. Le stockage du navigateur est peut-être indisponible.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((operation: Promise<void>) => {
    operation.catch(() => setError(STORAGE_ERROR));
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);

      const added: ReferenceImage[] = [];
      const failures: string[] = [];

      for (const file of files) {
        if (references.length + added.length >= LIMITS.MAX_REFERENCES) {
          failures.push(
            `Limite de ${LIMITS.MAX_REFERENCES} références atteinte : "${file.name}" n'a pas été importée.`,
          );
          continue;
        }

        try {
          const prepared = await prepareReferenceImage(file);
          added.push({
            id: createReferenceId(),
            name: file.name,
            mimeType: prepared.mimeType,
            size: prepared.blob.size,
            width: prepared.width,
            height: prepared.height,
            enabled: true,
            createdAt: Date.now(),
            order: references.length + added.length,
            blob: prepared.blob,
          });
        } catch (cause) {
          const message =
            cause instanceof AppError ? cause.message : userMessageFor("UNKNOWN");
          failures.push(`"${file.name}" : ${message}`);
        }
      }

      if (added.length > 0) {
        setReferences([...references, ...added]);
        persist(Promise.all(added.map(putReference)).then(() => undefined));
      }
      if (failures.length > 0) setError(failures.join("\n"));
    },
    [references, persist],
  );

  const toggleReference = useCallback(
    (id: string) => {
      const target = references.find((reference) => reference.id === id);
      if (!target) return;

      const updated = { ...target, enabled: !target.enabled };
      setReferences(
        references.map((reference) => (reference.id === id ? updated : reference)),
      );
      persist(putReference(updated));
    },
    [references, persist],
  );

  const removeReference = useCallback(
    (id: string) => {
      setReferences(references.filter((reference) => reference.id !== id));
      persist(deleteReference(id));
    },
    [references, persist],
  );

  const setAllEnabled = useCallback(
    (enabled: boolean) => {
      const updated = references.map((reference) => ({ ...reference, enabled }));
      setReferences(updated);
      persist(Promise.all(updated.map(putReference)).then(() => undefined));
    },
    [references, persist],
  );

  const enabledReferences = references.filter((reference) => reference.enabled);

  return {
    references,
    enabledReferences,
    enabledBytes: enabledReferences.reduce((sum, reference) => sum + reference.size, 0),
    previews,
    loading,
    error,
    addFiles,
    toggleReference,
    removeReference,
    setAllEnabled,
  };
}
