"use client";

import { useMemo, useState } from "react";

import {
  buildAssetFilename,
  downloadDataUrl,
  extensionForMimeType,
} from "@/lib/client/download";
import type { PricingRates } from "@/lib/pricing";
import type { useLibrary } from "@/hooks/useLibrary";
import type { GenerateSuccessResponse } from "@/types/api";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field, textInputClasses } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";
import { PixelMetricsPanel } from "@/components/PixelMetricsPanel";
import { SpritePreview } from "@/components/SpritePreview";
import { UsagePanel } from "@/components/UsagePanel";

/**
 * Résultat d'une génération.
 *
 * ---------------------------------------------------------------------------
 * L'IMAGE AFFICHÉE ICI EST UN RÉSULTAT
 * ---------------------------------------------------------------------------
 * Elle n'est jamais ajoutée aux références et n'est jamais renvoyée à OpenAI.
 * « Régénérer » rejoue la requête d'origine à l'identique. « Ajouter à la
 * bibliothèque » l'enregistre dans un store séparé, sans effet sur les
 * références du Style Pack.
 * ---------------------------------------------------------------------------
 */
export function ResultCard({
  result,
  pending,
  onRegenerate,
  library,
  packId,
  packName,
  rates,
}: {
  result: GenerateSuccessResponse | null;
  pending: boolean;
  onRegenerate: () => void;
  library: ReturnType<typeof useLibrary>;
  packId: string;
  packName: string;
  rates: PricingRates | null;
}) {
  const [promptVisible, setPromptVisible] = useState(false);
  const [assetName, setAssetName] = useState("");
  const [saved, setSaved] = useState(false);

  const dataUrl = useMemo(
    () => (result ? `data:${result.image.mimeType};base64,${result.image.base64}` : null),
    [result],
  );

  // Un nouveau résultat réinitialise le formulaire d'enregistrement.
  const resultKey = result?.meta.generatedAt ?? null;
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (resultKey !== lastKey) {
    setLastKey(resultKey);
    setSaved(false);
    setAssetName(result?.request.slice(0, 60) ?? "");
  }

  if (!result || !dataUrl) {
    return (
      <Section step="3" title="Résultat">
        <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted">
          {pending
            ? "Génération en cours, cela peut prendre jusqu'à une minute…"
            : "L'asset généré apparaîtra ici."}
        </p>
      </Section>
    );
  }

  const referenceCount = result.meta.referenceCount;

  async function handleSave() {
    if (!result) return;
    const blob = await dataUrlToBlob(dataUrl!);
    const ok = await library.addAsset({
      name: assetName,
      packId,
      packName,
      categoryName: result.meta.categoryName,
      targetWidth: result.meta.targetWidth,
      targetHeight: result.meta.targetHeight,
      // Dimensions réelles du PNG enregistré : c'est la version finale.
      finalWidth: result.meta.finalWidth,
      finalHeight: result.meta.finalHeight,
      request: result.request,
      metrics: result.meta.postProcessing
        ? {
            colourCount: result.meta.postProcessing.metrics.colourCount,
            alphaLevelCount: result.meta.postProcessing.metrics.alphaLevelCount,
            semiTransparentPixels: result.meta.postProcessing.metrics.semiTransparentPixels,
            verdict: result.meta.postProcessing.metrics.verdict,
          }
        : null,
      settings: {
        size: result.meta.size,
        quality: result.meta.quality as never,
        background: result.meta.background as never,
        outputFormat: result.meta.outputFormat as never,
        model: result.meta.model,
        referenceCount: result.meta.referenceCount,
        qualityMode: result.meta.qualityMode,
        qualityModeLabel: result.meta.qualityModeLabel,
        minimalResolution: result.meta.minimalResolution,
        postProcessed: result.meta.postProcessing !== null,
      },
      usage: result.meta.usage,
      mimeType: result.image.mimeType,
      blob,
    });
    if (ok) setSaved(true);
  }

  return (
    <Section
      step="3"
      title="Résultat"
      description={`${
        result.meta.finalWidth && result.meta.finalHeight
          ? `${result.meta.finalWidth} × ${result.meta.finalHeight} px`
          : "rendu brut"
      } · ${result.meta.model} · ${referenceCount} référence${
        referenceCount > 1 ? "s" : ""
      }`}
    >
      <SpritePreview
        src={dataUrl}
        alt={`Asset généré : ${result.request}`}
        width={result.meta.finalWidth}
        height={result.meta.finalHeight}
      />

      {result.meta.postProcessing !== null ? (
        <div className="mt-3">
          <PixelMetricsPanel metrics={result.meta.postProcessing.metrics} />
        </div>
      ) : null}

      <div className="mt-3 rounded-xl bg-surface-muted p-3">
        <p className="text-xs uppercase tracking-wide text-muted">Demande utilisée</p>
        <p className="mt-1 whitespace-pre-line text-sm">{result.request}</p>
        {result.meta.categoryName ? (
          <p className="mt-2 text-xs text-muted">
            Catégorie : {result.meta.categoryName}
            {result.meta.targetWidth && result.meta.targetHeight
              ? ` · emprise cible ${result.meta.targetWidth} × ${result.meta.targetHeight} px`
              : ""}
          </p>
        ) : null}
      </div>

      <div className="mt-3">
        <UsagePanel usage={result.meta.usage} rates={rates} meta={result.meta} />
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button
          variant="primary"
          className="flex-1"
          onClick={() =>
            downloadDataUrl(
              dataUrl,
              buildAssetFilename(
                assetName || result.request,
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

      <div className="mt-3 rounded-xl border border-border p-3">
        <Field label="Nom de l'asset">
          <input
            type="text"
            value={assetName}
            onChange={(event) => setAssetName(event.target.value)}
            placeholder="Grand chêne"
            className={textInputClasses()}
            aria-label="Nom de l'asset à enregistrer"
          />
        </Field>
        <Button
          variant={saved ? "secondary" : "primary"}
          className="mt-2 w-full"
          onClick={handleSave}
          disabled={saved}
        >
          {saved ? "Ajouté à la bibliothèque ✓" : "Ajouter à la bibliothèque"}
        </Button>
        {library.error ? (
          <div className="mt-2">
            <Alert tone="error">{library.error}</Alert>
          </div>
        ) : null}
      </div>

      <p className="mt-3 text-center text-xs text-muted">
        Un asset enregistré rejoint la bibliothèque, jamais les références. Il ne sera pas
        envoyé lors des prochaines générations.
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

/** Convertit la data URL affichée en blob, pour l'enregistrer tel quel. */
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}
