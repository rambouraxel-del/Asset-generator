"use client";

import {
  BACKGROUND_MODES,
  IMAGE_QUALITIES,
  IMAGE_SIZES,
  LIMITS,
  OUTPUT_FORMATS,
} from "@/lib/config";
import type { GenerationSettings } from "@/lib/storage/context";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Section";

const SIZE_LABELS: Record<string, string> = {
  auto: "Auto",
  "1024x1024": "Carré 1024",
  "1024x1536": "Portrait",
  "1536x1024": "Paysage",
};

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
 * Section C — Demande ponctuelle et lancement de la génération.
 */
export function GenerationSection({
  request,
  onRequestChange,
  settings,
  onSettingsChange,
  enabledCount,
  pending,
  error,
  disabledReason,
  onGenerate,
  onCancel,
}: {
  request: string;
  onRequestChange: (value: string) => void;
  settings: GenerationSettings;
  onSettingsChange: (patch: Partial<GenerationSettings>) => void;
  enabledCount: number;
  pending: boolean;
  error: string | null;
  disabledReason: string | null;
  onGenerate: () => void;
  onCancel: () => void;
}) {
  const transparencyIgnored =
    settings.background === "transparent" && settings.outputFormat === "jpeg";

  return (
    <Section
      step="C"
      title="Génération"
      description="Chaque génération est indépendante : rien des générations précédentes n'est envoyé."
    >
      <label htmlFor="asset-request" className="mb-1 block text-sm font-medium">
        Décris l&apos;asset à créer
      </label>
      <textarea
        id="asset-request"
        value={request}
        onChange={(event) => onRequestChange(event.target.value)}
        rows={3}
        maxLength={LIMITS.REQUEST_MAX_CHARS}
        placeholder="Un grand chêne, environ deux fois la hauteur d'un humain."
        className="w-full resize-y rounded-xl border border-border bg-surface-muted p-3 leading-relaxed outline-none focus-visible:border-accent"
      />

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SettingSelect
          label="Taille"
          value={settings.size}
          options={IMAGE_SIZES}
          labels={SIZE_LABELS}
          onChange={(size) => onSettingsChange({ size: size as GenerationSettings["size"] })}
        />
        <SettingSelect
          label="Qualité"
          value={settings.quality}
          options={IMAGE_QUALITIES}
          labels={QUALITY_LABELS}
          onChange={(quality) =>
            onSettingsChange({ quality: quality as GenerationSettings["quality"] })
          }
        />
        <SettingSelect
          label="Fond"
          value={settings.background}
          options={BACKGROUND_MODES}
          labels={BACKGROUND_LABELS}
          onChange={(background) =>
            onSettingsChange({ background: background as GenerationSettings["background"] })
          }
        />
        <SettingSelect
          label="Format"
          value={settings.outputFormat}
          options={OUTPUT_FORMATS}
          labels={FORMAT_LABELS}
          onChange={(outputFormat) =>
            onSettingsChange({
              outputFormat: outputFormat as GenerationSettings["outputFormat"],
            })
          }
        />
      </div>

      {transparencyIgnored ? (
        <div className="mt-3">
          <Alert tone="warning">
            Le format JPEG ne gère pas la transparence : choisissez PNG ou WebP pour un
            fond transparent.
          </Alert>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2">
        <Button
          variant="primary"
          onClick={onGenerate}
          disabled={pending || disabledReason !== null}
          className="w-full"
        >
          {pending ? "Génération en cours…" : "Générer"}
        </Button>
        {pending ? (
          <Button variant="ghost" onClick={onCancel} className="w-full">
            Annuler
          </Button>
        ) : null}
        <p className="text-center text-xs text-muted">
          {disabledReason ?? describePayload(enabledCount)}
        </p>
      </div>
    </Section>
  );
}

/** Résume ce qui partira à l'API, pour que l'envoi reste explicite. */
function describePayload(enabledCount: number): string {
  if (enabledCount === 0) {
    return "Le contexte et la demande seront envoyés, sans référence.";
  }
  if (enabledCount === 1) {
    return "1 référence sera envoyée avec le contexte et la demande.";
  }
  return `${enabledCount} références seront envoyées avec le contexte et la demande.`;
}

function SettingSelect({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  labels: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-xl border border-border bg-surface-muted px-2 text-foreground outline-none focus-visible:border-accent"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}
