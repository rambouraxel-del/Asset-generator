"use client";

import { FINAL_SIZE_PRESETS } from "@/lib/config";
import { chooseGenerationSize } from "@/lib/generation/generationSizing";
import {
  QUALITY_MODES,
  QUALITY_MODE_LABELS,
  describeQualityMode,
  resolveQualityMode,
  type QualityMode,
} from "@/lib/generation/qualityMode";
import type { GenerationSettings } from "@/lib/generation/payload";
import { validateFinalSize } from "@/lib/validation/finalSize";
import { Alert } from "@/components/ui/Alert";
import { Field, selectClasses, textInputClasses } from "@/components/ui/Field";

const CUSTOM = "__custom__";
const RAW = "__raw__";

/**
 * Régime de taille choisi.
 *
 * Il ne peut pas être déduit des seules dimensions : une saisie libre peut
 * tomber pile sur un preset (32 × 32 par exemple), et le sélecteur retomberait
 * alors sur le preset en faisant disparaître le champ sous les doigts de
 * l'utilisateur. Le mode est donc porté par l'appelant, qui s'en sert aussi
 * pour décider si la génération peut démarrer.
 */
export type FinalSizeMode = "preset" | "custom" | "raw";

/** Mode initial déduit des réglages enregistrés. */
export function initialFinalSizeMode(
  finalSizeEnabled: boolean,
  width: number,
  height: number,
): FinalSizeMode {
  if (!finalSizeEnabled) return "raw";
  const matchesPreset = FINAL_SIZE_PRESETS.some(
    (preset) => preset.width === width && preset.height === height,
  );
  return matchesPreset ? "preset" : "custom";
}

/**
 * Choix de la taille finale de l'asset et du mode qualité.
 *
 * L'écran affiche systématiquement la résolution que le modèle recevra, pour
 * que l'utilisateur comprenne pourquoi il obtient un 16 × 16 alors que GPT a
 * travaillé en 816 × 816.
 */
export function FinalSizeSelector({
  settings,
  mode,
  onModeChange,
  customValue,
  onCustomValueChange,
  onChange,
}: {
  settings: GenerationSettings;
  mode: FinalSizeMode;
  onModeChange: (mode: FinalSizeMode) => void;
  /** Saisie libre en cours, conservée telle quelle pendant la frappe. */
  customValue: string;
  onCustomValueChange: (value: string) => void;
  onChange: (patch: Partial<GenerationSettings>) => void;
}) {
  const current = `${settings.finalWidth}x${settings.finalHeight}`;
  const selectValue = mode === "raw" ? RAW : mode === "custom" ? CUSTOM : current;
  const customValidation = validateFinalSize(customValue);
  const customError = mode === "custom" && !customValidation.ok ? customValidation.message : null;

  return (
    <div className="flex flex-col gap-3">
      <Field label="Taille finale de l'asset">
        <select
          value={selectValue}
          onChange={(event) => {
            const next = event.target.value;
            if (next === RAW) {
              onModeChange("raw");
              onChange({ finalSizeEnabled: false });
              return;
            }
            if (next === CUSTOM) {
              onModeChange("custom");
              onCustomValueChange(current);
              onChange({ finalSizeEnabled: true });
              return;
            }
            onModeChange("preset");
            const [width, height] = next.split("x").map(Number);
            onChange({ finalSizeEnabled: true, finalWidth: width, finalHeight: height });
          }}
          className={selectClasses()}
          aria-label="Taille finale de l'asset"
        >
          {FINAL_SIZE_PRESETS.map((preset) => (
            <option key={`${preset.width}x${preset.height}`} value={`${preset.width}x${preset.height}`}>
              {preset.width} × {preset.height} px
            </option>
          ))}
          <option value={CUSTOM}>Personnalisé…</option>
          <option value={RAW}>Aucune — livrer le rendu brut</option>
        </select>
      </Field>

      {selectValue === CUSTOM ? (
        <Field
          label="Largeur × hauteur finales"
          error={customError}
          hint="Dimensions du PNG livré. Aucune contrainte de multiple : 24x24 est accepté."
        >
          <input
            type="text"
            value={customValue}
            placeholder="24x24"
            onChange={(event) => {
              const next = event.target.value;
              onCustomValueChange(next);
              const validation = validateFinalSize(next);
              if (validation.ok) {
                onChange({
                  finalSizeEnabled: true,
                  finalWidth: validation.width,
                  finalHeight: validation.height,
                });
              }
            }}
            className={textInputClasses(customError !== null)}
            aria-label="Taille finale personnalisée"
            aria-invalid={customError !== null}
          />
        </Field>
      ) : null}

      {settings.finalSizeEnabled ? (
        <>
          <Field label="Qualité">
            <select
              value={settings.qualityMode}
              onChange={(event) =>
                onChange({ qualityMode: event.target.value as QualityMode })
              }
              className={selectClasses()}
              aria-label="Mode qualité"
            >
              {QUALITY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {QUALITY_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </Field>

          {customError === null ? <GenerationPlan settings={settings} /> : null}
        </>
      ) : (
        <Alert tone="info">
          Le rendu brut de GPT-Image-2 sera livré tel quel, sans post-traitement.
          Réglez la résolution et la qualité ci-dessous.
        </Alert>
      )}
    </div>
  );
}

/**
 * Récapitulatif de ce qui va réellement se passer.
 *
 * Le même calcul que le serveur est rejoué ici pour un affichage immédiat ;
 * le serveur reste la source de vérité.
 */
function GenerationPlan({ settings }: { settings: GenerationSettings }) {
  const resolved = resolveQualityMode(
    settings.qualityMode as QualityMode,
    settings.finalWidth,
    settings.finalHeight,
  );
  const choice = chooseGenerationSize(settings.finalWidth, settings.finalHeight, resolved);

  if (choice === null) {
    return (
      <Alert tone="error">
        Aucune résolution de génération ne correspond à cette taille finale.
        Rapprochez les deux côtés l&apos;un de l&apos;autre.
      </Alert>
    );
  }

  return (
    <div className="rounded-xl bg-surface-muted p-3 text-sm">
      <Row label="Taille finale" value={`${settings.finalWidth} × ${settings.finalHeight} px`} />
      <Row label="Résolution de génération" value={`${choice.width} × ${choice.height} px`} />
      <Row
        label="Qualité"
        value={describeQualityMode(settings.qualityMode as QualityMode, resolved)}
      />
      <p className="mt-2 text-xs text-muted">
        GPT-Image-2 ne sait pas générer d&apos;aussi petites images : l&apos;asset est
        rendu en {choice.width} × {choice.height}, puis réduit localement
        (÷ {formatFactor(choice.downscaleFactor)}) sans lissage. Ce post-traitement
        ne consomme aucun jeton.
      </p>
    </div>
  );
}

/** « 51 » plutôt que « 51.000 », « 10,5 » quand la réduction n'est pas entière. */
function formatFactor(factor: number): string {
  return Number.isInteger(factor)
    ? String(factor)
    : factor.toFixed(1).replace(".", ",");
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
