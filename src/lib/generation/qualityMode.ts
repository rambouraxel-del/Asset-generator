/**
 * Modes de qualité et politique de consommation.
 *
 * ---------------------------------------------------------------------------
 * PRINCIPE
 * ---------------------------------------------------------------------------
 * Un asset final de 16 × 16 px n'a aucun intérêt à être rendu en qualité haute :
 * l'immense majorité du détail sera perdue au redimensionnement. Le mode
 * « Auto » applique donc une règle simple et prévisible, fondée sur la taille
 * finale demandée. L'utilisateur peut toujours forcer un mode.
 * ---------------------------------------------------------------------------
 */

import type { ImageQuality } from "@/lib/config";

export const QUALITY_MODES = ["auto", "eco", "standard", "high"] as const;
export type QualityMode = (typeof QUALITY_MODES)[number];

export const QUALITY_MODE_LABELS: Record<QualityMode, string> = {
  auto: "Auto",
  eco: "Éco",
  standard: "Standard",
  high: "Haute qualité",
};

/**
 * Seuils du mode « Auto », exprimés sur le plus grand côté de l'asset FINAL.
 * Regroupés ici pour rester ajustables d'un seul endroit.
 */
export const AUTO_QUALITY_THRESHOLDS = {
  /** Jusqu'à ce côté, le détail supplémentaire serait perdu : qualité basse. */
  ECO_MAX_EDGE: 32,
  /** Jusqu'à ce côté, qualité moyenne. Au-delà, qualité haute. */
  STANDARD_MAX_EDGE: 96,
} as const;

/**
 * Facteur de suréchantillonnage visé par mode.
 *
 * Générer plus grand que la taille finale donne au modèle de la marge pour
 * dessiner un contour propre avant réduction. Au-delà d'un certain point le
 * gain devient nul et le coût augmente, d'où des facteurs volontairement
 * modestes. Ils n'ont d'effet que sur les assets déjà grands : pour un 16 × 16,
 * la résolution minimale du modèle domine largement (voir `generationSizing`).
 */
export const SUPERSAMPLING_FACTORS: Record<Exclude<QualityMode, "auto">, number> = {
  eco: 1,
  standard: 2,
  high: 3,
};

/** Mode effectivement appliqué une fois « Auto » résolu. */
export type ResolvedQualityMode = Exclude<QualityMode, "auto">;

/**
 * Résout « Auto » en un mode concret à partir de la taille finale.
 * Les autres modes sont renvoyés tels quels.
 */
export function resolveQualityMode(
  mode: QualityMode,
  finalWidth: number | null,
  finalHeight: number | null,
): ResolvedQualityMode {
  if (mode !== "auto") return mode;

  // Sans taille finale connue, on ne peut rien déduire : réglage médian.
  if (finalWidth === null || finalHeight === null) return "standard";

  const longestEdge = Math.max(finalWidth, finalHeight);
  if (longestEdge <= AUTO_QUALITY_THRESHOLDS.ECO_MAX_EDGE) return "eco";
  if (longestEdge <= AUTO_QUALITY_THRESHOLDS.STANDARD_MAX_EDGE) return "standard";
  return "high";
}

/** Paramètre `quality` envoyé à l'API pour un mode résolu. */
export function apiQualityFor(mode: ResolvedQualityMode): ImageQuality {
  switch (mode) {
    case "eco":
      return "low";
    case "standard":
      return "medium";
    case "high":
      return "high";
  }
}

/** Phrase courte expliquant le mode retenu, affichée dans l'interface. */
export function describeQualityMode(
  requested: QualityMode,
  resolved: ResolvedQualityMode,
): string {
  const resolvedLabel = QUALITY_MODE_LABELS[resolved].toLowerCase();
  return requested === "auto"
    ? `Auto (${resolvedLabel})`
    : QUALITY_MODE_LABELS[requested];
}
