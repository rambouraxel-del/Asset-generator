"use client";

import { useEffect, useMemo, useState } from "react";

import { prepareReferenceImage } from "@/lib/client/prepareImage";
import { AppError, userMessageFor } from "@/lib/errors";
import {
  createProjectReferenceId,
  deleteProjectReference,
  putProjectReference,
} from "@/lib/storage/projectReferences";
import { ASSET_FAMILIES, FAMILY_LABELS } from "@/types/project";
import type { AssetFamily, ProjectReference } from "@/types/project";
import { Alert } from "@/components/ui/Alert";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Field } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";

/**
 * Références graphiques du projet.
 *
 * ---------------------------------------------------------------------------
 * LA VALIDATION EST UN ACTE EXPLICITE
 * ---------------------------------------------------------------------------
 * Importer une image ne la rend pas « validée ». Tant que la case n'est pas
 * cochée, elle n'est jamais envoyée au modèle. C'est ce qui empêche la
 * cohérence du projet de dériver sans décision humaine — et c'est pourquoi
 * l'import de l'ancienne bibliothèque n'active aucune référence.
 * ---------------------------------------------------------------------------
 */
export function ReferencesCard({
  projectId,
  references,
  onChange,
}: {
  projectId: string;
  references: ProjectReference[];
  onChange: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const previews = useMemo(() => {
    const map: Record<string, string> = {};
    for (const reference of references) {
      map[reference.id] = URL.createObjectURL(reference.blob);
    }
    return map;
  }, [references]);

  useEffect(
    () => () => {
      for (const url of Object.values(previews)) URL.revokeObjectURL(url);
    },
    [previews],
  );

  async function importFiles(files: FileList) {
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const prepared = await prepareReferenceImage(file);
        await putProjectReference({
          kind: "project-reference",
          id: createProjectReferenceId(),
          projectId,
          ownerId: null,
          name: file.name,
          mimeType: prepared.mimeType,
          width: prepared.width,
          height: prepared.height,
          size: prepared.blob.size,
          // Jamais validée d'office.
          validated: false,
          pinned: false,
          families: [],
          createdAt: Date.now(),
          blob: prepared.blob,
        });
      }
      onChange();
    } catch (cause) {
      setError(cause instanceof AppError ? cause.message : userMessageFor("UNKNOWN"));
    } finally {
      setBusy(false);
    }
  }

  async function patch(reference: ProjectReference, changes: Partial<ProjectReference>) {
    await putProjectReference({ ...reference, ...changes });
    onChange();
  }

  const validated = references.filter((reference) => reference.validated).length;

  return (
    <Section
      step="3"
      title="Références validées"
      description={`${validated} validée${validated > 1 ? "s" : ""} sur ${references.length} importée${references.length > 1 ? "s" : ""}.`}
    >
      <Field
        label="Importer des références"
        hint="PNG, JPEG ou WebP. Une image importée n'est pas envoyée tant qu'elle n'est pas validée."
      >
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          disabled={busy}
          onChange={(event) => {
            if (event.target.files) void importFiles(event.target.files);
            event.target.value = "";
          }}
          className="min-h-11 w-full rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm"
          aria-label="Importer des références"
        />
      </Field>

      {error ? (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      {references.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted">
          Aucune référence. La génération s&apos;appuiera uniquement sur la charte.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {references.map((reference) => (
            <li key={reference.id} className="rounded-xl border border-border p-3">
              <div className="flex items-start gap-3">
                <div className="checkerboard shrink-0 rounded-lg border border-border p-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previews[reference.id]}
                    alt={reference.name}
                    className="size-14 object-contain [image-rendering:pixelated]"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{reference.name}</p>
                  <p className="text-xs text-muted">
                    {reference.width} × {reference.height} px
                  </p>

                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={reference.validated}
                      onChange={(event) =>
                        void patch(reference, { validated: event.target.checked })
                      }
                      className="size-4"
                      aria-label={`Valider ${reference.name}`}
                    />
                    Validée — utilisable comme référence
                  </label>

                  <label className="mt-1 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={reference.pinned}
                      onChange={(event) =>
                        void patch(reference, { pinned: event.target.checked })
                      }
                      className="size-4"
                      aria-label={`Épingler ${reference.name}`}
                    />
                    Épinglée — proposée en priorité
                  </label>

                  <div className="mt-2 flex flex-wrap gap-1">
                    {ASSET_FAMILIES.map((family) => {
                      const active = reference.families.includes(family);
                      return (
                        <button
                          key={family}
                          type="button"
                          onClick={() =>
                            void patch(reference, {
                              families: active
                                ? reference.families.filter((entry) => entry !== family)
                                : [...reference.families, family as AssetFamily],
                            })
                          }
                          className={[
                            "rounded-lg border px-2 py-1 text-xs",
                            active
                              ? "border-accent bg-accent text-accent-foreground"
                              : "border-border text-muted",
                          ].join(" ")}
                        >
                          {FAMILY_LABELS[family]}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Aucune famille cochée = référence valable pour tout le projet.
                  </p>

                  <div className="mt-2">
                    <ConfirmButton
                      label="Supprimer"
                      onConfirm={() => {
                        void deleteProjectReference(reference.id).then(onChange);
                      }}
                    />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
