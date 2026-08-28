"use client";

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
export function PixelMetricsPanel({ metrics }: { metrics: PixelMetrics }) {
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
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="truncate text-muted">{label}</dt>
      <dd className="shrink-0 font-medium">{value}</dd>
    </div>
  );
}
