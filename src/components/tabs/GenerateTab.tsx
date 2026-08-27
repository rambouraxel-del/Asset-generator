"use client";

import { useState } from "react";

import {
  BACKGROUND_MODES,
  IMAGE_QUALITIES,
  LIMITS,
  OUTPUT_FORMATS,
} from "@/lib/config";
import { buildGenerationRequest } from "@/lib/generation/payload";
import type { PricingRates } from "@/lib/pricing";
import { validateImageSize } from "@/lib/validation/imageSize";
import { useAppState } from "@/hooks/useAppState";
import type { useGeneration } from "@/hooks/useGeneration";
import type { useLibrary } from "@/hooks/useLibrary";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field, selectClasses, textareaClasses } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";
import { SizeSelector } from "@/components/SizeSelector";
import { ResultCard } from "@/components/ResultCard";

const QUALITY_LABELS: Record<string, string> = {
  auto: "Auto",
  low: "Basse (rapide)",
  medium: "Moyenne",
  high: "Haute",
};

const BACKGROUND_LABELS: Record<string, string> = {
  transparent: "Transparent",
  opaque: "Opaque",
  auto: "Auto",
};

const FORMAT_LABELS: Record<string, string> = {
  png: "PNG",
  webp: "WebP",
  jpeg: "JPEG (opaque)",
};

/**
 * Onglet Générer.
 *
 * ---------------------------------------------------------------------------
 * AUCUNE MÉMOIRE ENTRE LES GÉNÉRATIONS
 * ---------------------------------------------------------------------------
 * Le clic sur « Générer » construit un instantané via `buildGenerationRequest`,
 * à partir du seul état courant : pack actif, catégorie choisie, références
 * activées, demande saisie. Ni le résultat précédent ni la bibliothèque
 * n'entrent dans cette construction.
 * ---------------------------------------------------------------------------
 */
export function GenerateTab({
  generation,
  library,
  rates,
}: {
  generation: ReturnType<typeof useGeneration>;
  library: ReturnType<typeof useLibrary>;
  rates: PricingRates | null;
}) {
  const state = useAppState();
  const [request, setRequest] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");

  const pack = state.activePack;
  if (pack === null) return null;

  const category = pack.categories.find((entry) => entry.id === categoryId) ?? null;
  const sizeValidation = validateImageSize(state.settings.size);
  const blocked = resolveBlockingReason({
    request,
    contextLength: pack.context.length,
    enabledBytes: state.enabledBytes,
    enabledCount: state.enabledReferences.length,
    sizeValid: sizeValidation.ok,
  });

  async function handleGenerate() {
    if (blocked !== null || pack === null) return;

    // Instantané autonome : rien d'autre que l'état courant n'y entre.
    await generation.run(
      buildGenerationRequest({
        pack,
        category,
        request,
        settings: state.settings,
        references: state.enabledReferences,
      }),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Section
        step="1"
        title="Demande"
        description={`Pack « ${pack.name} » · ${state.enabledReferences.length} référence${
          state.enabledReferences.length > 1 ? "s" : ""
        } active${state.enabledReferences.length > 1 ? "s" : ""}.`}
      >
        <Field label="Décris l'asset à créer">
          <textarea
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            rows={3}
            maxLength={LIMITS.REQUEST_MAX_CHARS}
            placeholder="Un grand chêne, environ deux fois la hauteur d'un humain."
            className={textareaClasses()}
            aria-label="Décris l'asset à créer"
          />
        </Field>

        <div className="mt-3">
          <Field
            label="Catégorie"
            hint={describeCategory(category)}
          >
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className={selectClasses()}
              aria-label="Catégorie d'asset"
            >
              <option value="">Aucune catégorie</option>
              {pack.categories.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section step="2" title="Réglages de sortie">
        <SizeSelector
          value={state.settings.size}
          onChange={(size) => state.updateSettings({ size })}
        />

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Qualité">
            <select
              value={state.settings.quality}
              onChange={(event) =>
                state.updateSettings({
                  quality: event.target.value as typeof state.settings.quality,
                })
              }
              className={selectClasses()}
              aria-label="Qualité"
            >
              {IMAGE_QUALITIES.map((quality) => (
                <option key={quality} value={quality}>
                  {QUALITY_LABELS[quality]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Fond">
            <select
              value={state.settings.background}
              onChange={(event) =>
                state.updateSettings({
                  background: event.target.value as typeof state.settings.background,
                })
              }
              className={selectClasses()}
              aria-label="Fond"
            >
              {BACKGROUND_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {BACKGROUND_LABELS[mode]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Format">
            <select
              value={state.settings.outputFormat}
              onChange={(event) =>
                state.updateSettings({
                  outputFormat: event.target.value as typeof state.settings.outputFormat,
                })
              }
              className={selectClasses()}
              aria-label="Format"
            >
              {OUTPUT_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {FORMAT_LABELS[format]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {state.settings.background === "transparent" &&
        state.settings.outputFormat === "jpeg" ? (
          <div className="mt-3">
            <Alert tone="warning">
              Le format JPEG ne gère pas la transparence : choisissez PNG ou WebP pour un
              fond transparent.
            </Alert>
          </div>
        ) : null}

        {generation.error ? (
          <div className="mt-3">
            <Alert tone="error">{generation.error}</Alert>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-2">
          <Button
            variant="primary"
            className="w-full"
            onClick={handleGenerate}
            disabled={generation.pending || blocked !== null}
          >
            {generation.pending ? "Génération en cours…" : "Générer"}
          </Button>
          {generation.pending ? (
            <Button variant="ghost" className="w-full" onClick={generation.cancel}>
              Annuler
            </Button>
          ) : null}
          <p className="text-center text-xs text-muted">{blocked ?? "Prêt à générer."}</p>
        </div>
      </Section>

      <ResultCard
        result={generation.result}
        pending={generation.pending}
        onRegenerate={generation.regenerate}
        library={library}
        packId={pack.id}
        packName={pack.name}
        rates={rates}
      />
    </div>
  );
}

function describeCategory(category: { targetWidth: number | null; targetHeight: number | null } | null): string {
  if (category === null) return "Aucune contrainte de taille ne sera ajoutée au prompt.";
  if (category.targetWidth !== null && category.targetHeight !== null) {
    return `Emprise cible ajoutée au prompt : ${category.targetWidth} × ${category.targetHeight} px.`;
  }
  return "Cette catégorie n'impose pas de dimensions.";
}

/**
 * Motif bloquant la génération, ou `null` si tout est prêt.
 * Duplique volontairement les règles serveur pour un retour immédiat ;
 * le serveur reste la source de vérité.
 */
function resolveBlockingReason(input: {
  request: string;
  contextLength: number;
  enabledBytes: number;
  enabledCount: number;
  sizeValid: boolean;
}): string | null {
  if (input.request.trim().length === 0) {
    return "Décrivez l'asset à créer pour activer la génération.";
  }
  if (!input.sizeValid) {
    return "Corrigez la résolution de génération.";
  }
  if (input.contextLength > LIMITS.CONTEXT_MAX_CHARS) {
    return "Le contexte du Style Pack dépasse la longueur maximale autorisée.";
  }
  if (input.enabledCount > LIMITS.MAX_REFERENCES) {
    return `Trop de références actives (maximum ${LIMITS.MAX_REFERENCES}).`;
  }
  if (input.enabledBytes > LIMITS.MAX_TOTAL_BYTES) {
    return "Les références actives pèsent trop lourd au total.";
  }
  return null;
}
