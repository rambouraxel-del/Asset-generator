"use client";

/**
 * Réglages de génération (résolution, qualité, fond, format).
 *
 * Globaux et non liés à un Style Pack : ce sont des préférences de sortie, pas
 * des règles graphiques.
 */

import { DEFAULT_GENERATION_SETTINGS } from "@/lib/config";
import type { GenerationSettings } from "@/lib/generation/payload";

const SETTINGS_KEY = "asset-generator:settings";

export const DEFAULT_SETTINGS: GenerationSettings = {
  ...DEFAULT_GENERATION_SETTINGS,
  qualityMode: "auto",
};

export function loadSettings(): GenerationSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GenerationSettings>;
    // Fusion avec les valeurs par défaut : un réglage ajouté plus tard ne
    // cassera pas les préférences déjà enregistrées.
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GenerationSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // La perte de persistance ne doit jamais casser l'application.
  }
}
