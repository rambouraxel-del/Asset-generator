"use client";

import { describeFidelity } from "@/lib/image/logicalGrid";
import type { PostProcessReport } from "@/lib/image/postProcessing";
import {
  VERDICT_HINTS,
  VERDICT_LABELS,
  type PixelMetrics,
} from "@/lib/image/pixelMetrics";

const VERDICT_CLASSES: Record<PixelMetrics["verdict"], string> = {
  propre: "border-success/40 text-success",
  acceptable: "border-border text-foreground",
  "à surveiller": "border-border text-muted",
  "trop lissé": "border-danger/40 text-danger",
};

/**
 * Qualité pixel-art du sprite livré.
 *
 * Volontairement compact : quatre chiffres et un verdict. L'objectif est de
 * rendre le problème visible d'un coup d'œil, pas de noyer l'écran.
 */
export function PixelMetricsPanel({
  metrics,
  report,
}: {
  metrics: PixelMetrics;
  /** Compte rendu du post-traitement, pour la partie grille logique. */
  report?: PostProcessReport;
}) {
  const grid = report?.grid ?? null;

  return (
    <div className="rounded-xl bg-surface-muted p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs uppercase tracking-wide text-muted">Qualité pixel-art</p>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${VERDICT_CLASSES[metrics.verdict]}`}
        >
          {VERDICT_LABELS[metrics.verdict]}
        </span>
      </div>

      {grid !== null ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-b border-border pb-2 text-sm">
          <Row label="Grille logique" value={`×${grid.scaleX}`} />
          <Row
            label="Fidélité"
            value={`${Math.round(grid.stats.fidelity * 100)} % (${describeFidelity(grid.stats.fidelity)})`}
          />
        </dl>
      ) : report?.fallbackReason ? (
        <p className="mt-2 border-b border-border pb-2 text-xs text-muted">
          Grille logique non appliquée ({describeFallback(report.fallbackReason)}) :
          nettoyage classique utilisé.
        </p>
      ) : null}

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <Row label="Couleurs" value={String(metrics.colourCount)} />
        <Row label="Niveaux d'alpha" value={String(metrics.alphaLevelCount)} />
        <Row
          label="Pixels semi-transp."
          value={String(metrics.semiTransparentPixels)}
        />
        <Row
          label="Pixels visibles"
          value={`${metrics.visiblePixels} (${Math.round(metrics.coverage * 100)} %)`}
        />
        {metrics.bounds ? (
          <Row
            label="Boîte utile"
            value={`${metrics.bounds.width} × ${metrics.bounds.height}`}
          />
        ) : null}
        <Row label="Densité couleurs" value={metrics.colourDensity.toFixed(2)} />
      </dl>

      <p className="mt-2 text-xs text-muted">{VERDICT_HINTS[metrics.verdict]}</p>

      {grid !== null && grid.stats.fidelity < 0.6 ? (
        <p className="mt-2 text-xs text-muted">
          Fidélité de grille faible : le modèle n&apos;a pas vraiment composé sur la
          grille. Le nettoyage a corrigé le rendu, mais une description plus simple
          donnerait un meilleur résultat.
        </p>
      ) : null}
    </div>
  );
}

/** Formulation lisible d'une raison de repli. */
function describeFallback(reason: string): string {
  switch (reason) {
    case "pipeline-classique":
      return "mode choisi";
    case "grille-non-entiere":
      return "aucun facteur entier à cette taille";
    case "sprite-vide-en-grille":
      return "asset plus petit qu'un bloc";
    default:
      return "dimensions inattendues";
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="truncate text-muted">{label}</dt>
      <dd className="shrink-0 font-medium">{value}</dd>
    </div>
  );
}
