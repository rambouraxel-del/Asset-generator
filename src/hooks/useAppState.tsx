"use client";

/**
 * État applicatif : Style Packs, références du pack actif, réglages.
 *
 * ---------------------------------------------------------------------------
 * PÉRIMÈTRE VOLONTAIREMENT LIMITÉ
 * ---------------------------------------------------------------------------
 * Ce fournisseur ne connaît QUE les entrées de génération. Il n'importe ni
 * `storage/generatedAssets`, ni le moindre type `GeneratedAsset` : la
 * bibliothèque vit dans `useLibrary`, séparément. Aucun asset généré ne peut
 * donc transiter par cet état.
 * ---------------------------------------------------------------------------
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { LIMITS, NAME_LIMITS } from "@/lib/config";
import { AppError, userMessageFor } from "@/lib/errors";
import { prepareReferenceImage } from "@/lib/client/prepareImage";
import type { GenerationSettings } from "@/lib/generation/payload";
import { bootstrapStorage } from "@/lib/storage/bootstrap";
import { createId } from "@/lib/storage/db";
import { createPack, savePacks, saveActivePackId } from "@/lib/storage/packs";
import type { PricingRates } from "@/lib/pricing";
import { loadPricingRates, savePricingRates } from "@/lib/storage/pricing";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "@/lib/storage/settings";
import {
  EMPTY_USAGE_TOTALS,
  accumulateUsage,
  loadUsageTotals,
  resetUsageTotals,
  saveUsageTotals,
} from "@/lib/storage/usage";
import {
  copyReferencesToPack,
  createStyleReferenceId,
  deleteReference,
  deleteReferencesForPack,
  listReferencesForPack,
  putReference,
  putReferences,
} from "@/lib/storage/styleReferences";
import type {
  AssetCategory,
  StylePack,
  StyleReference,
  TokenUsage,
  UsageTotals,
} from "@/types/domain";

const STORAGE_ERROR =
  "Les modifications n'ont pas pu être enregistrées dans ce navigateur. Elles resteront actives jusqu'au prochain rechargement.";

interface AppStateValue {
  status: "loading" | "ready" | "error";
  error: string | null;
  clearError: () => void;

  packs: StylePack[];
  activePack: StylePack | null;
  /** Références du pack actif, dans l'ordre d'affichage et d'envoi. */
  references: StyleReference[];
  enabledReferences: StyleReference[];
  enabledBytes: number;
  previews: Record<string, string>;
  migratedFromV1: boolean;

  settings: GenerationSettings;
  updateSettings: (patch: Partial<GenerationSettings>) => void;

  /** Compteur cumulatif local, alimenté par les données réelles de l'API. */
  usageTotals: UsageTotals;
  recordUsage: (usage: TokenUsage | null) => void;
  resetUsage: () => void;

  /** Tarifs saisis par l'utilisateur, ou `null` si l'estimation est désactivée. */
  pricingRates: PricingRates | null;
  setPricingRates: (rates: PricingRates | null) => void;

  createStylePack: (name: string) => void;
  renameStylePack: (id: string, name: string) => void;
  duplicateStylePack: (id: string) => void;
  deleteStylePack: (id: string) => void;
  selectStylePack: (id: string) => void;
  updateContext: (context: string) => void;

  addCategory: () => void;
  updateCategory: (id: string, patch: Partial<Omit<AssetCategory, "id">>) => void;
  deleteCategory: (id: string) => void;

  addReferenceFiles: (files: File[]) => Promise<void>;
  toggleReference: (id: string) => void;
  removeReference: (id: string) => void;
  setAllReferencesEnabled: (enabled: boolean) => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppStateValue["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [packs, setPacks] = useState<StylePack[]>([]);
  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [references, setReferences] = useState<StyleReference[]>([]);
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_SETTINGS);
  const [usageTotals, setUsageTotals] = useState<UsageTotals>(EMPTY_USAGE_TOTALS);
  const [pricingRates, setPricingRatesState] = useState<PricingRates | null>(null);
  const [migratedFromV1, setMigratedFromV1] = useState(false);

  // Démarrage : migration éventuelle, puis chargement du pack actif.
  useEffect(() => {
    let cancelled = false;

    bootstrapStorage()
      .then(async (result) => {
        const packReferences = await listReferencesForPack(result.activePackId);
        if (cancelled) return;
        setPacks(result.packs);
        setActivePackId(result.activePackId);
        setReferences(packReferences);
        setSettings(loadSettings());
        setUsageTotals(loadUsageTotals());
        setPricingRatesState(loadPricingRates());
        setMigratedFromV1(result.migratedFromV1);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setError(
          "Le stockage local n'a pas pu être ouvert. Vérifiez que votre navigateur autorise le stockage pour ce site.",
        );
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const activePack = packs.find((pack) => pack.id === activePackId) ?? null;

  /* ---------------------------------------------------------------------- */
  /* Aperçus                                                                */
  /* ---------------------------------------------------------------------- */

  const previewKey = references.map((reference) => reference.id).join("|");
  const previews = useMemo(() => {
    const map: Record<string, string> = {};
    for (const reference of references) {
      map[reference.id] = URL.createObjectURL(reference.blob);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  useEffect(
    () => () => {
      for (const url of Object.values(previews)) URL.revokeObjectURL(url);
    },
    [previews],
  );

  /* ---------------------------------------------------------------------- */
  /* Helpers de persistance                                                 */
  /* ---------------------------------------------------------------------- */

  const persist = useCallback((operation: Promise<unknown>) => {
    operation.catch(() => setError(STORAGE_ERROR));
  }, []);

  /** Applique une modification aux packs et l'enregistre. */
  const commitPacks = useCallback((next: StylePack[]) => {
    setPacks(next);
    savePacks(next);
  }, []);

  /** Modifie le pack actif via une fonction de mise à jour. */
  const updateActivePack = useCallback(
    (updater: (pack: StylePack) => StylePack) => {
      if (activePackId === null) return;
      commitPacks(
        packs.map((pack) =>
          pack.id === activePackId ? { ...updater(pack), updatedAt: Date.now() } : pack,
        ),
      );
    },
    [activePackId, packs, commitPacks],
  );

  /* ---------------------------------------------------------------------- */
  /* Style Packs                                                            */
  /* ---------------------------------------------------------------------- */

  const selectStylePack = useCallback(
    (id: string) => {
      if (id === activePackId) return;
      setError(null);
      setActivePackId(id);
      saveActivePackId(id);
      // Les références suivent immédiatement le pack sélectionné.
      setReferences([]);
      listReferencesForPack(id)
        .then(setReferences)
        .catch(() => setError(STORAGE_ERROR));
    },
    [activePackId],
  );

  const createStylePack = useCallback(
    (name: string) => {
      setError(null);
      const pack = createPack({ name: name.trim() || "Style Pack" });
      commitPacks([...packs, pack]);
      setActivePackId(pack.id);
      saveActivePackId(pack.id);
      setReferences([]);
    },
    [packs, commitPacks],
  );

  const renameStylePack = useCallback(
    (id: string, name: string) => {
      setError(null);
      commitPacks(
        packs.map((pack) =>
          pack.id === id
            ? {
                ...pack,
                name: name.trim().slice(0, NAME_LIMITS.PACK_NAME_MAX_CHARS) || pack.name,
                updatedAt: Date.now(),
              }
            : pack,
        ),
      );
    },
    [packs, commitPacks],
  );

  const duplicateStylePack = useCallback(
    (id: string) => {
      const source = packs.find((pack) => pack.id === id);
      if (!source) return;
      setError(null);

      const copy = createPack({
        name: `${source.name} (copie)`.slice(0, NAME_LIMITS.PACK_NAME_MAX_CHARS),
        context: source.context,
        // Copie profonde des catégories : les deux packs évoluent séparément.
        categories: source.categories.map((category) => ({
          ...category,
          id: createId("cat"),
        })),
      });

      commitPacks([...packs, copy]);
      setActivePackId(copy.id);
      saveActivePackId(copy.id);
      setReferences([]);

      // Les références sont dupliquées puis rechargées pour le nouveau pack.
      persist(
        copyReferencesToPack(source.id, copy.id)
          .then(() => listReferencesForPack(copy.id))
          .then(setReferences),
      );
    },
    [packs, commitPacks, persist],
  );

  const deleteStylePack = useCallback(
    (id: string) => {
      setError(null);
      const remaining = packs.filter((pack) => pack.id !== id);

      // Il doit toujours rester au moins un pack utilisable.
      const next =
        remaining.length > 0 ? remaining : [createPack({ name: "Nouveau Style Pack" })];
      commitPacks(next);

      persist(deleteReferencesForPack(id));

      if (id === activePackId) {
        const fallback = next[0].id;
        setActivePackId(fallback);
        saveActivePackId(fallback);
        setReferences([]);
        persist(listReferencesForPack(fallback).then(setReferences));
      }
    },
    [packs, activePackId, commitPacks, persist],
  );

  const updateContext = useCallback(
    (context: string) => {
      updateActivePack((pack) => ({ ...pack, context }));
    },
    [updateActivePack],
  );

  /* ---------------------------------------------------------------------- */
  /* Catégories                                                             */
  /* ---------------------------------------------------------------------- */

  const addCategory = useCallback(() => {
    updateActivePack((pack) => ({
      ...pack,
      categories: [
        ...pack.categories,
        {
          id: createId("cat"),
          name: "Nouvelle catégorie",
          targetWidth: null,
          targetHeight: null,
          rule: "",
        },
      ],
    }));
  }, [updateActivePack]);

  const updateCategory = useCallback(
    (id: string, patch: Partial<Omit<AssetCategory, "id">>) => {
      updateActivePack((pack) => ({
        ...pack,
        categories: pack.categories.map((category) =>
          category.id === id ? { ...category, ...patch } : category,
        ),
      }));
    },
    [updateActivePack],
  );

  const deleteCategory = useCallback(
    (id: string) => {
      updateActivePack((pack) => ({
        ...pack,
        categories: pack.categories.filter((category) => category.id !== id),
      }));
    },
    [updateActivePack],
  );

  /* ---------------------------------------------------------------------- */
  /* Références                                                             */
  /* ---------------------------------------------------------------------- */

  const addReferenceFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || activePackId === null) return;
      setError(null);

      const added: StyleReference[] = [];
      const failures: string[] = [];

      for (const file of files) {
        if (references.length + added.length >= LIMITS.MAX_REFERENCES) {
          failures.push(
            `Limite de ${LIMITS.MAX_REFERENCES} références atteinte : « ${file.name} » n'a pas été importée.`,
          );
          continue;
        }

        try {
          const prepared = await prepareReferenceImage(file);
          added.push({
            kind: "style-reference",
            id: createStyleReferenceId(),
            packId: activePackId,
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
          failures.push(`« ${file.name} » : ${message}`);
        }
      }

      if (added.length > 0) {
        setReferences([...references, ...added]);
        persist(putReferences(added));
      }
      if (failures.length > 0) setError(failures.join("\n"));
    },
    [activePackId, references, persist],
  );

  const toggleReference = useCallback(
    (id: string) => {
      const target = references.find((reference) => reference.id === id);
      if (!target) return;
      const updated: StyleReference = { ...target, enabled: !target.enabled };
      setReferences(references.map((reference) => (reference.id === id ? updated : reference)));
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

  const setAllReferencesEnabled = useCallback(
    (enabled: boolean) => {
      const updated = references.map((reference) => ({ ...reference, enabled }));
      setReferences(updated);
      persist(putReferences(updated));
    },
    [references, persist],
  );

  /* ---------------------------------------------------------------------- */
  /* Réglages                                                               */
  /* ---------------------------------------------------------------------- */

  const updateSettings = useCallback((patch: Partial<GenerationSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Consommation API                                                       */
  /* ---------------------------------------------------------------------- */

  /** N'additionne que ce que l'API a réellement renvoyé. */
  const recordUsage = useCallback((usage: TokenUsage | null) => {
    setUsageTotals((current) => {
      const next = accumulateUsage(current, usage);
      saveUsageTotals(next);
      return next;
    });
  }, []);

  const resetUsage = useCallback(() => {
    setUsageTotals(resetUsageTotals());
  }, []);

  const setPricingRates = useCallback((rates: PricingRates | null) => {
    setPricingRatesState(rates);
    savePricingRates(rates);
  }, []);

  const enabledReferences = references.filter((reference) => reference.enabled);

  const value: AppStateValue = {
    status,
    error,
    clearError: useCallback(() => setError(null), []),
    packs,
    activePack,
    references,
    enabledReferences,
    enabledBytes: enabledReferences.reduce((sum, reference) => sum + reference.size, 0),
    previews,
    migratedFromV1,
    settings,
    updateSettings,
    usageTotals,
    recordUsage,
    resetUsage,
    pricingRates,
    setPricingRates,
    createStylePack,
    renameStylePack,
    duplicateStylePack,
    deleteStylePack,
    selectStylePack,
    updateContext,
    addCategory,
    updateCategory,
    deleteCategory,
    addReferenceFiles,
    toggleReference,
    removeReference,
    setAllReferencesEnabled,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (value === null) {
    throw new Error("useAppState doit être utilisé dans <AppStateProvider>");
  }
  return value;
}
