"use client";

import { estimateGenerationCost, formatUsd, type PricingRates } from "@/lib/pricing";
import type { TokenUsage } from "@/types/domain";

/**
 * Consommation API d'une génération.
 *
 * N'invente jamais de chiffre : un champ que l'API n'a pas renvoyé s'affiche
 * « Donnée non disponible ».
 */
export function UsagePanel({
  usage,
  rates,
}: {
  usage: TokenUsage | null;
  rates: PricingRates | null;
}) {
  const cost = estimateGenerationCost(usage, rates);

  return (
    <div className="rounded-xl bg-surface-muted p-3">
      <p className="text-xs uppercase tracking-wide text-muted">Utilisation API</p>

      {usage === null ? (
        <p className="mt-1 text-sm text-muted">Donnée non disponible</p>
      ) : (
        <dl className="mt-2 flex flex-col gap-1 text-sm">
          <UsageRow label="Entrée texte" value={usage.textInputTokens} />
          <UsageRow label="Entrée image" value={usage.imageInputTokens} />
          <UsageRow label="Sortie image" value={usage.imageOutputTokens} />
          <UsageRow label="Total" value={usage.totalTokens} strong />
        </dl>
      )}

      {cost.available ? (
        <p className="mt-2 border-t border-border pt-2 text-sm">
          <span className="text-muted">Coût estimé : </span>
          <span className="font-medium">{formatUsd(cost.totalUsd)}</span>
          <span className="text-xs text-muted">
            {cost.partial ? " (partiel — certains postes non fournis)" : ""} · estimation
            basée sur vos tarifs
          </span>
        </p>
      ) : null}
    </div>
  );
}

function UsageRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number | null;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? "font-semibold" : ""}>
        {value === null ? (
          <span className="text-xs text-muted">Donnée non disponible</span>
        ) : (
          `${value.toLocaleString("fr-FR")} jetons`
        )}
      </dd>
    </div>
  );
}
