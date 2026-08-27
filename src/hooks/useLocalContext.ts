"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  contextStore,
  settingsStore,
  type GenerationSettings,
} from "@/lib/storage/context";

/**
 * Contexte permanent + réglages, persistes dans `localStorage`.
 *
 * `useSyncExternalStore` gère le rendu serveur (valeurs par défaut) puis
 * l'hydratation (valeurs enregistrées) sans effet de bord ni cascade.
 */
export function useLocalContext() {
  const context = useSyncExternalStore(
    contextStore.subscribe,
    contextStore.getSnapshot,
    contextStore.getServerSnapshot,
  );

  const settings = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
    settingsStore.getServerSnapshot,
  );

  const updateSettings = useCallback((patch: Partial<GenerationSettings>) => {
    settingsStore.set({ ...settingsStore.getSnapshot(), ...patch });
  }, []);

  return { context, setContext: contextStore.set, settings, updateSettings };
}
