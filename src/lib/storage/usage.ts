"use client";

/**
 * Compteur cumulatif local de consommation API.
 *
 * Purement indicatif : il additionne ce que l'API a réellement renvoyé, et
 * rien d'autre. Une génération dont l'API ne remonte aucune donnée d'usage
 * incrémente le nombre de générations sans gonfler les compteurs de jetons.
 */

import type { TokenUsage, UsageTotals } from "@/types/domain";

const USAGE_KEY = "asset-generator:usageTotals";

export const EMPTY_USAGE_TOTALS: UsageTotals = {
  generations: 0,
  textInputTokens: 0,
  imageInputTokens: 0,
  imageOutputTokens: 0,
  totalTokens: 0,
};

export function loadUsageTotals(): UsageTotals {
  try {
    const raw = window.localStorage.getItem(USAGE_KEY);
    if (!raw) return { ...EMPTY_USAGE_TOTALS };
    const parsed = JSON.parse(raw) as Partial<UsageTotals>;
    return {
      generations: numberOrZero(parsed.generations),
      textInputTokens: numberOrZero(parsed.textInputTokens),
      imageInputTokens: numberOrZero(parsed.imageInputTokens),
      imageOutputTokens: numberOrZero(parsed.imageOutputTokens),
      totalTokens: numberOrZero(parsed.totalTokens),
    };
  } catch {
    return { ...EMPTY_USAGE_TOTALS };
  }
}

export function saveUsageTotals(totals: UsageTotals): void {
  try {
    window.localStorage.setItem(USAGE_KEY, JSON.stringify(totals));
  } catch {
    // Compteur indicatif : son échec ne doit rien casser.
  }
}

/** Ajoute une génération aux totaux. Les champs absents n'ajoutent rien. */
export function accumulateUsage(totals: UsageTotals, usage: TokenUsage | null): UsageTotals {
  return {
    generations: totals.generations + 1,
    textInputTokens: totals.textInputTokens + (usage?.textInputTokens ?? 0),
    imageInputTokens: totals.imageInputTokens + (usage?.imageInputTokens ?? 0),
    imageOutputTokens: totals.imageOutputTokens + (usage?.imageOutputTokens ?? 0),
    totalTokens: totals.totalTokens + (usage?.totalTokens ?? 0),
  };
}

export function resetUsageTotals(): UsageTotals {
  saveUsageTotals(EMPTY_USAGE_TOTALS);
  return { ...EMPTY_USAGE_TOTALS };
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
