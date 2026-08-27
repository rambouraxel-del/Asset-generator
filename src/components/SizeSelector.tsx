"use client";

import { IMAGE_SIZE_PRESETS, SIZE_CONSTRAINTS } from "@/lib/config";
import { isPreset, validateImageSize } from "@/lib/validation/imageSize";
import { Field, selectClasses, textInputClasses } from "@/components/ui/Field";

const PRESET_LABELS: Record<string, string> = {
  auto: "Auto",
  "1024x1024": "Carré — 1024 × 1024",
  "1024x1536": "Portrait — 1024 × 1536",
  "1536x1024": "Paysage — 1536 × 1024",
};

const CUSTOM = "__custom__";

/**
 * Choix de la résolution envoyée à l'API : presets ou saisie libre.
 *
 * La validation applique les contraintes réelles de `gpt-image-2`
 * (voir `lib/validation/imageSize.ts`) et explique précisément le refus.
 */
export function SizeSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const custom = !isPreset(value);
  const validation = validateImageSize(value);
  const error = !validation.ok ? validation.message : null;

  return (
    <div className="flex flex-col gap-2">
      <Field label="Résolution de génération">
        <select
          value={custom ? CUSTOM : value}
          onChange={(event) => {
            const next = event.target.value;
            // Passer en personnalisé pré-remplit avec une valeur valide.
            onChange(next === CUSTOM ? "1536x864" : next);
          }}
          className={selectClasses()}
          aria-label="Résolution de génération"
        >
          {IMAGE_SIZE_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {PRESET_LABELS[preset] ?? preset}
            </option>
          ))}
          <option value={CUSTOM}>Personnalisé…</option>
        </select>
      </Field>

      {custom ? (
        <Field
          label="Largeur × hauteur"
          error={error}
          hint={`Multiples de ${SIZE_CONSTRAINTS.MULTIPLE_OF}, côté max ${SIZE_CONSTRAINTS.MAX_EDGE} px, rapport max ${SIZE_CONSTRAINTS.MAX_ASPECT_RATIO}:1.`}
        >
          <input
            type="text"
            inputMode="text"
            value={value}
            placeholder="1536x864"
            onChange={(event) => onChange(event.target.value)}
            className={textInputClasses(error !== null)}
            aria-label="Résolution personnalisée"
            aria-invalid={error !== null}
          />
        </Field>
      ) : null}

      {validation.ok && validation.kind === "explicit" && validation.value.experimental ? (
        <p className="text-xs text-muted">
          Résolution acceptée, mais signalée comme expérimentale par OpenAI au-delà de
          2560 × 1440.
        </p>
      ) : null}
    </div>
  );
}
