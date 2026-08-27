/**
 * Estimation du coût d'une génération.
 *
 * ---------------------------------------------------------------------------
 * AUCUN TARIF N'EST CODÉ EN DUR
 * ---------------------------------------------------------------------------
 * Les tarifs OpenAI changent, et une valeur figée dans le code devient fausse
 * en silence — ce qui est pire que pas de prix du tout. Aucun tarif n'est donc
 * livré avec l'application : l'estimation reste désactivée tant que
 * l'utilisateur n'a pas saisi lui-même les tarifs relevés sur sa page de
 * facturation OpenAI (écran Paramètres).
 *
 * Tant qu'aucun tarif n'est renseigné, l'interface affiche uniquement les
 * données d'usage réellement renvoyées par l'API.
 *
 * Tout ce qui touche à la tarification est concentré dans ce fichier : la V0.3
 * pourra y brancher une source automatique sans toucher au reste du code.
 * ---------------------------------------------------------------------------
 */

import type { TokenUsage } from "@/types/domain";

/** Tarifs en dollars par million de jetons, tels que saisis par l'utilisateur. */
export interface PricingRates {
  textInputPerMillion: number;
  imageInputPerMillion: number;
  imageOutputPerMillion: number;
  /** Date de relevé, affichée pour rappeler que le tarif peut avoir changé. */
  updatedAt: number;
}

export type CostEstimate =
  | { available: false; reason: "no-rates" | "no-usage" }
  | {
      available: true;
      /** Coût total estimé, en dollars. */
      totalUsd: number;
      breakdown: {
        textInputUsd: number;
        imageInputUsd: number;
        imageOutputUsd: number;
      };
      /** `true` si un poste a été ignoré faute de donnée d'usage. */
      partial: boolean;
    };

/**
 * Estime le coût d'une génération. Fonction pure et sans effet de bord.
 *
 * Ne devine jamais : un poste dont l'usage est inconnu vaut 0 et bascule le
 * résultat en `partial`, pour que l'interface puisse le signaler.
 */
export function estimateGenerationCost(
  usage: TokenUsage | null,
  rates: PricingRates | null,
): CostEstimate {
  if (rates === null) return { available: false, reason: "no-rates" };
  if (usage === null) return { available: false, reason: "no-usage" };

  const known = [usage.textInputTokens, usage.imageInputTokens, usage.imageOutputTokens];
  if (known.every((value) => value === null)) {
    return { available: false, reason: "no-usage" };
  }

  const textInputUsd = costOf(usage.textInputTokens, rates.textInputPerMillion);
  const imageInputUsd = costOf(usage.imageInputTokens, rates.imageInputPerMillion);
  const imageOutputUsd = costOf(usage.imageOutputTokens, rates.imageOutputPerMillion);

  return {
    available: true,
    totalUsd: textInputUsd + imageInputUsd + imageOutputUsd,
    breakdown: { textInputUsd, imageInputUsd, imageOutputUsd },
    partial: known.some((value) => value === null),
  };
}

function costOf(tokens: number | null, ratePerMillion: number): number {
  if (tokens === null) return 0;
  return (tokens / 1_000_000) * ratePerMillion;
}

export function formatUsd(amount: number): string {
  // Les montants sont minuscules : on garde assez de décimales pour rester lisible.
  if (amount === 0) return "$0";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(3)}`;
}
