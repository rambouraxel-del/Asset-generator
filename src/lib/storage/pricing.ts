"use client";

/** Persistance des tarifs saisis par l'utilisateur (voir `lib/pricing.ts`). */

import type { PricingRates } from "@/lib/pricing";

const PRICING_KEY = "asset-generator:pricingRates";

export function loadPricingRates(): PricingRates | null {
  try {
    const raw = window.localStorage.getItem(PRICING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PricingRates>;
    if (
      !isPositiveNumber(parsed.textInputPerMillion) ||
      !isPositiveNumber(parsed.imageInputPerMillion) ||
      !isPositiveNumber(parsed.imageOutputPerMillion)
    ) {
      return null;
    }
    return {
      textInputPerMillion: parsed.textInputPerMillion,
      imageInputPerMillion: parsed.imageInputPerMillion,
      imageOutputPerMillion: parsed.imageOutputPerMillion,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function savePricingRates(rates: PricingRates | null): void {
  try {
    if (rates === null) window.localStorage.removeItem(PRICING_KEY);
    else window.localStorage.setItem(PRICING_KEY, JSON.stringify(rates));
  } catch {
    // Sans effet sur le fonctionnement de l'application.
  }
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
