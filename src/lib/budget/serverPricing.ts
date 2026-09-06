import "server-only";

/**
 * Tarifs côté serveur, pour que le registre de dépense ait un sens.
 *
 * ---------------------------------------------------------------------------
 * TOUJOURS AUCUN TARIF CODÉ EN DUR
 * ---------------------------------------------------------------------------
 * Les tarifs d'un fournisseur changent, et une valeur figée dans le code
 * devient fausse en silence — pire que pas de prix du tout. Ils sont donc lus
 * dans l'environnement, avec une VERSION obligatoire enregistrée à côté de
 * chaque génération : on peut ainsi recalculer plus tard en sachant quel
 * barème s'appliquait.
 *
 * Sans tarifs configurés, le coût d'une génération est « inconnu ». Il n'est
 * JAMAIS assimilé à zéro : le registre compte les générations sans coût à
 * part, et l'interface l'affiche comme tel.
 * ---------------------------------------------------------------------------
 */

import type { TokenUsage } from "@/types/domain";

export interface ServerRates {
  textInputPerMillion: number;
  imageInputPerMillion: number;
  imageOutputPerMillion: number;
  /** Étiquette libre, p. ex. « 2026-09-relevé-facturation ». */
  version: string;
}

/** Lit les tarifs serveur, ou `null` s'ils ne sont pas tous renseignés. */
export function readServerRates(): ServerRates | null {
  const text = Number(process.env.PRICING_TEXT_INPUT_PER_MILLION);
  const imageIn = Number(process.env.PRICING_IMAGE_INPUT_PER_MILLION);
  const imageOut = Number(process.env.PRICING_IMAGE_OUTPUT_PER_MILLION);
  const version = process.env.PRICING_VERSION?.trim();

  const values = [text, imageIn, imageOut];
  if (!values.every((value) => Number.isFinite(value) && value >= 0)) return null;
  if (!version) return null;

  return {
    textInputPerMillion: text,
    imageInputPerMillion: imageIn,
    imageOutputPerMillion: imageOut,
    version,
  };
}

export type ServerCost =
  | { status: "measured"; amountUsd: number; pricingVersion: string; partial: boolean }
  | { status: "unknown"; reason: "aucun-tarif-configuré" | "aucun-usage-remonté" };

/**
 * Calcule le coût d'une génération à partir de l'usage réellement remonté.
 *
 * « Mesuré » signifie : usage réel du fournisseur × tarif connu. Ce n'est pas
 * une estimation a priori. Si un poste manque, le coût reste mesuré mais
 * `partial` le signale.
 */
export function computeServerCost(usage: TokenUsage | null): ServerCost {
  const rates = readServerRates();
  if (rates === null) return { status: "unknown", reason: "aucun-tarif-configuré" };
  if (usage === null) return { status: "unknown", reason: "aucun-usage-remonté" };

  const parts = [usage.textInputTokens, usage.imageInputTokens, usage.imageOutputTokens];
  if (parts.every((value) => value === null)) {
    return { status: "unknown", reason: "aucun-usage-remonté" };
  }

  const amountUsd =
    perMillion(usage.textInputTokens, rates.textInputPerMillion) +
    perMillion(usage.imageInputTokens, rates.imageInputPerMillion) +
    perMillion(usage.imageOutputTokens, rates.imageOutputPerMillion);

  return {
    status: "measured",
    amountUsd,
    pricingVersion: rates.version,
    partial: parts.some((value) => value === null),
  };
}

function perMillion(tokens: number | null, rate: number): number {
  return tokens === null ? 0 : (tokens / 1_000_000) * rate;
}
