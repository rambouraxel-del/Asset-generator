"use client";

import { useMemo, useState } from "react";

import {
  buildAssetFilename,
  downloadDataUrl,
  extensionForMimeType,
} from "@/lib/client/download";
import type { GenerateSuccessResponse } from "@/types/api";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Section";

/**
 * Section D — Résultat.
 *
 * L'image affichée ici n'est jamais ajoutée aux références et n'est jamais
 * renvoyée à OpenAI : « Régénérer » relance la requête d'origine à l'identique.
 */
export function ResultSection({
  result,
  pending,
  onRegenerate,
}: {
  result: GenerateSuccessResponse | null;
  pending: boolean;
  onRegenerate: () => void;
}) {
  const [promptVisible, setPromptVisible] = useState(false);

  const dataUrl = useMemo(
    () => (result ? `data:${result.image.mimeType};base64,${result.image.base64}` : null),
    [result],
  );

  if (!result || !dataUrl) {
    return (
      <Section step="D" title="Résultat">
        <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted">
          {pending
            ? "Génération en cours, cela peut prendre jusqu'à une minute…"
            : "L'asset généré apparaîtra ici."}
        </p>
      </Section>
    );
  }

  const referenceCount = result.meta.referenceCount;

  return (
    <Section
      step="D"
      title="Résultat"
      description={`${result.meta.model} · ${referenceCount} référence${
        referenceCount > 1 ? "s" : ""
      } utilisée${referenceCount > 1 ? "s" : ""}`}
    >
      <div className="checkerboard flex items-center justify-center rounded-xl border border-border p-3">
        {/* Image en data URL locale : `next/image` n'apporte rien ici. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={dataUrl}
          alt={`Asset généré : ${result.request}`}
          className="max-h-[60vh] w-auto max-w-full object-contain"
        />
      </div>

      <div className="mt-3 rounded-xl bg-surface-muted p-3">
        <p className="text-xs uppercase tracking-wide text-muted">Demande utilisée</p>
        <p className="mt-1 whitespace-pre-line text-sm">{result.request}</p>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button
          variant="primary"
          className="flex-1"
          onClick={() =>
            downloadDataUrl(
              dataUrl,
              buildAssetFilename(
                result.request,
                extensionForMimeType(result.image.mimeType),
              ),
            )
          }
        >
          Télécharger
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          onClick={onRegenerate}
          disabled={pending}
        >
          {pending ? "Génération en cours…" : "Régénérer"}
        </Button>
      </div>

      <p className="mt-3 text-center text-xs text-muted">
        Cette image n&apos;est pas ajoutée aux références et ne sera pas envoyée lors des
        prochaines générations.
      </p>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setPromptVisible((visible) => !visible)}
          className="text-xs text-muted underline underline-offset-2"
        >
          {promptVisible ? "Masquer" : "Voir"} le prompt envoyé
        </button>
        {promptVisible ? (
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-muted p-3 text-xs leading-relaxed">
            {result.prompt}
          </pre>
        ) : null}
      </div>
    </Section>
  );
}
