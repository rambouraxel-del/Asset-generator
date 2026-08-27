"use client";

/**
 * Persistance du contexte permanent et des réglages de génération.
 *
 * Ces données sont petites et purement textuelles : `localStorage` suffit.
 * Les images de référence, elles, vivent dans IndexedDB (cf. `références.ts`).
 *
 * En V0.2, un "Style Pack" pourra regrouper un contexte + une selection de
 * références sous une même clé : la structure ci-dessous est volontairement
 * isolee derriere deux magasins nommes pour rendre cette évolution simple.
 */

import {
  DEFAULT_GENERATION_SETTINGS,
  type BackgroundMode,
  type ImageQuality,
  type ImageSize,
  type OutputFormat,
} from "@/lib/config";
import { createLocalStore } from "@/lib/storage/localStore";

export const DEFAULT_CONTEXT = `Pixel art 2D vue du dessus.
Respect strict des proportions.
Fond transparent.
Un humain adulte mesure 48 pixels de haut.
Les assets doivent rester cohérents avec les références fournies.`;

export interface GenerationSettings {
  size: ImageSize;
  quality: ImageQuality;
  background: BackgroundMode;
  outputFormat: OutputFormat;
}

export const DEFAULT_SETTINGS: GenerationSettings = { ...DEFAULT_GENERATION_SETTINGS };

export const contextStore = createLocalStore<string>({
  key: "asset-generator:context",
  defaultValue: DEFAULT_CONTEXT,
  serialize: (value) => value,
  deserialize: (raw) => raw,
});

export const settingsStore = createLocalStore<GenerationSettings>({
  key: "asset-generator:settings",
  defaultValue: DEFAULT_SETTINGS,
  serialize: (value) => JSON.stringify(value),
  deserialize: (raw) => {
    const parsed = JSON.parse(raw) as Partial<GenerationSettings>;
    // Fusion avec les valeurs par défaut : un réglage ajoute en V0.2 ne
    // cassera pas les preferences déjà enregistrées.
    return { ...DEFAULT_SETTINGS, ...parsed };
  },
});
