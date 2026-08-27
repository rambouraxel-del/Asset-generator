"use client";

import { useRef } from "react";

import { ACCEPTED_IMAGE_MIME_TYPES, LIMITS } from "@/lib/config";
import type { StyleReference } from "@/types/domain";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Section } from "@/components/ui/Section";

/**
 * Références graphiques du Style Pack actif.
 *
 * Ces images sont des ENTRÉES de génération. Aucun asset généré n'apparaît ici.
 */
export function ReferencesCard({
  packName,
  references,
  previews,
  enabledCount,
  enabledBytes,
  onAddFiles,
  onToggle,
  onRemove,
  onSetAllEnabled,
}: {
  packName: string;
  references: StyleReference[];
  previews: Record<string, string>;
  enabledCount: number;
  enabledBytes: number;
  onAddFiles: (files: File[]) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onSetAllEnabled: (enabled: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const ratio = enabledBytes / LIMITS.MAX_TOTAL_BYTES;
  const overBudget = enabledBytes > LIMITS.MAX_TOTAL_BYTES;

  return (
    <Section
      step="3"
      title="Références"
      description={`Référentiel graphique du pack « ${packName} ». Jusqu'à ${LIMITS.MAX_REFERENCES} images PNG, JPEG ou WebP.`}
      action={
        references.length > 0 ? (
          <span className="text-xs text-muted">
            {enabledCount}/{references.length} active{enabledCount > 1 ? "s" : ""}
          </span>
        ) : null
      }
    >
      {/* Jauge de charge utile : rend la limite d'envoi immédiatement lisible. */}
      <div className="mb-3 rounded-xl bg-surface-muted p-3">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted">Poids total des références actives</span>
          <span className={overBudget ? "font-semibold text-danger" : "font-semibold"}>
            {formatBytes(enabledBytes)} / {formatBytes(LIMITS.MAX_TOTAL_BYTES)}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
          <div
            className={`h-full rounded-full ${overBudget ? "bg-danger" : "bg-accent"}`}
            style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
          />
        </div>
        {overBudget ? (
          <p className="mt-2 text-xs text-danger">
            Au-delà de cette limite la génération est refusée. Désactivez des références,
            ou regroupez-les dans une planche compacte.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          disabled={references.length >= LIMITS.MAX_REFERENCES}
        >
          Importer des images
        </Button>
        {references.length > 1 ? (
          <>
            <Button variant="ghost" onClick={() => onSetAllEnabled(true)}>
              Tout activer
            </Button>
            <Button variant="ghost" onClick={() => onSetAllEnabled(false)}>
              Tout désactiver
            </Button>
          </>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_IMAGE_MIME_TYPES.join(",")}
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Réinitialise pour permettre de réimporter le même fichier.
          event.target.value = "";
          onAddFiles(files);
        }}
      />

      <div className="mt-3">
        {references.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted">
            Aucune référence dans ce pack. La génération fonctionnera avec le contexte
            seul.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {references.map((reference) => (
              <li
                key={reference.id}
                className={`flex items-center gap-3 rounded-xl border p-2 ${
                  reference.enabled
                    ? "border-accent/40 bg-surface-muted"
                    : "border-border opacity-60"
                }`}
              >
                {/* Aperçu depuis un blob local : `next/image` n'apporte rien ici. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previews[reference.id]}
                  alt=""
                  className="checkerboard size-14 shrink-0 rounded-lg object-contain"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={reference.name}>
                    {reference.name}
                  </p>
                  <p className="text-xs text-muted">
                    {reference.width}×{reference.height} · {formatBytes(reference.size)}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={reference.enabled}
                  onChange={() => onToggle(reference.id)}
                  aria-label={`Activer ${reference.name} comme référence`}
                  className="size-5 shrink-0 accent-[var(--accent)]"
                />
                <ConfirmButton
                  label="Suppr."
                  className="px-2"
                  onConfirm={() => onRemove(reference.id)}
                  ariaLabel={`Supprimer ${reference.name}`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {references.length >= LIMITS.MAX_REFERENCES ? (
        <div className="mt-3">
          <Alert tone="info">
            Limite de {LIMITS.MAX_REFERENCES} références atteinte pour ce pack.
          </Alert>
        </div>
      ) : null}
    </Section>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
