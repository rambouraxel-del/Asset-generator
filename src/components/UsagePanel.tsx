"use client";

import { estimateGenerationCost, formatUsd, type PricingRates } from "@/lib/pricing";
import type { GenerateSuccessResponse } from "@/types/api";
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
  meta,
}: {
  usage: TokenUsage | null;
  rates: PricingRates | null;
  /** Métadonnées de la génération, pour expliquer d'où vient l'image livrée. */
  meta?: GenerateSuccessResponse["meta"];
}) {
  const cost = estimateGenerationCost(usage, rates);

  return (
    <div className="rounded-xl bg-surface-muted p-3">
      {meta ? <GenerationSummary meta={meta} /> : null}

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

/**
 * Explique ce qui s'est réellement passé : taille livrée, résolution demandée
 * au modèle, mode qualité, et étiquettes d'optimisation.
 *
 * C'est ce bloc qui évite l'incompréhension « j'ai demandé 16 × 16 et GPT a
 * généré 816 × 816 ».
 */
function GenerationSummary({ meta }: { meta: GenerateSuccessResponse["meta"] }) {
  const hasFinalSize = meta.finalWidth !== null && meta.finalHeight !== null;

  const badges: string[] = [];
  if (meta.minimalResolution) badges.push("résolution minimisée");
  if (meta.qualityMode === "eco" || meta.qualityModeLabel?.includes("éco")) {
    badges.push("mode éco");
  }
  if (meta.postProcessing !== null) badges.push("post-traitement local");

  return (
    <div className="mb-3 border-b border-border pb-3">
      <p className="text-xs uppercase tracking-wide text-muted">Génération</p>
      <dl className="mt-2 flex flex-col gap-1 text-sm">
        {hasFinalSize ? (
          <SummaryRow
            label="Taille finale livrée"
            value={`${meta.finalWidth} × ${meta.finalHeight} px`}
            strong
          />
        ) : null}
        <SummaryRow label="Résolution de génération" value={formatSize(meta.generationSize)} />
        {meta.qualityModeLabel ? (
          <SummaryRow label="Qualité" value={meta.qualityModeLabel} />
        ) : null}
      </dl>

      {badges.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1">
          {badges.map((badge) => (
            <li
              key={badge}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted"
            >
              {badge}
            </li>
          ))}
        </ul>
      ) : null}

      {meta.postProcessing !== null && !meta.postProcessing.empty ? (
        <p className="mt-2 text-xs text-muted">
          Rendu en {meta.postProcessing.sourceWidth} × {meta.postProcessing.sourceHeight},
          {meta.postProcessing.trimmed ? " détouré," : ""} réduit, puis nettoyé
          {meta.postProcessing.cleanup
            ? ` (palette ${meta.postProcessing.cleanup.palette.coloursBefore} → ${meta.postProcessing.cleanup.palette.coloursAfter} couleurs, contours francs)`
            : ""}{" "}
          et recentré sur un canvas de {meta.postProcessing.finalWidth} ×{" "}
          {meta.postProcessing.finalHeight} px. Aucun jeton supplémentaire.
        </p>
      ) : null}

      {meta.postProcessing?.empty ? (
        <p className="mt-2 text-xs text-danger">
          Le rendu ne contenait aucun pixel visible : l&apos;asset livré est vide.
          Reformulez la demande ou changez le fond.
        </p>
      ) : null}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? "font-semibold" : ""}>{value}</dd>
    </div>
  );
}

function formatSize(size: string): string {
  const match = /^(\d+)x(\d+)$/i.exec(size);
  return match ? `${match[1]} × ${match[2]} px` : size;
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
