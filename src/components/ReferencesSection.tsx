"use client";

import { useRef } from "react";

import { ACCEPTED_IMAGE_MIME_TYPES, LIMITS } from "@/lib/config";
import type { ReferenceImage } from "@/lib/storage/references";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Section";

/**
 * Section B — Références graphiques.
 * Seules les références activées sont envoyées lors d'une génération.
 */
export function ReferencesSection({
  references,
  previews,
  enabledCount,
  enabledBytes,
  loading,
  error,
  onAddFiles,
  onToggle,
  onRemove,
  onSetAllEnabled,
}: {
  references: ReferenceImage[];
  previews: Record<string, string>;
  enabledCount: number;
  enabledBytes: number;
  loading: boolean;
  error: string | null;
  onAddFiles: (files: File[]) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onSetAllEnabled: (enabled: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const overBudget = enabledBytes > LIMITS.MAX_TOTAL_BYTES;

  return (
    <Section
      step="B"
      title="Références"
      description={`Jusqu'à ${LIMITS.MAX_REFERENCES} images PNG, JPEG ou WebP. Elles restent dans ce navigateur.`}
      action={
        references.length > 0 ? (
          <span className="text-xs text-muted">
            {enabledCount}/{references.length} activée{enabledCount > 1 ? "s" : ""}
          </span>
        ) : null
      }
    >
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

      {error ? (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      {overBudget ? (
        <div className="mt-3">
          <Alert tone="warning">
            Les références activées pèsent {formatBytes(enabledBytes)}, au-delà de la
            limite de {formatBytes(LIMITS.MAX_TOTAL_BYTES)} par génération.
            Désactivez-en quelques-unes.
          </Alert>
        </div>
      ) : null}

      <div className="mt-3">
        {loading ? (
          <p className="text-sm text-muted">Chargement des références…</p>
        ) : references.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted">
            Aucune référence pour l&apos;instant. La génération fonctionnera avec le
            contexte seul.
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
                <Button
                  variant="danger"
                  className="px-2"
                  aria-label={`Supprimer ${reference.name}`}
                  onClick={() => onRemove(reference.id)}
                >
                  Suppr.
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
