"use client";

import { SYNC_HINTS, SYNC_LABELS, type SyncState } from "@/lib/project/repository";

/**
 * État de synchronisation, affiché en permanence.
 *
 * Ce n'est pas décoratif : c'est ce qui dit à l'utilisateur si son travail est
 * à l'abri. « Local uniquement » et « Erreur » sont donc visuellement distincts
 * de « Synchronisé », et le sous-titre explique la conséquence concrète plutôt
 * que de se contenter d'un mot.
 */
const TONE: Record<SyncState, string> = {
  "local-only": "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-500",
  syncing: "border-border bg-surface-muted text-muted",
  synced: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  error: "border-danger/40 bg-danger-surface text-danger",
};

const ICON: Record<SyncState, string> = {
  "local-only": "◐",
  syncing: "↻",
  synced: "✓",
  error: "!",
};

export function SyncBadge({
  state,
  detail,
  compact = false,
}: {
  state: SyncState;
  /** Message d'erreur précis, prioritaire sur l'explication générique. */
  detail?: string | null;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs ${TONE[state]}`}
        role="status"
      >
        <span aria-hidden>{ICON[state]}</span>
        {SYNC_LABELS[state]}
      </span>
    );
  }

  return (
    <div className={`rounded-xl border px-3 py-2 text-sm ${TONE[state]}`} role="status">
      <p className="font-medium">
        <span aria-hidden className="mr-1.5">
          {ICON[state]}
        </span>
        {SYNC_LABELS[state]}
      </p>
      <p className="mt-0.5 text-xs opacity-90">{detail ?? SYNC_HINTS[state]}</p>
    </div>
  );
}
