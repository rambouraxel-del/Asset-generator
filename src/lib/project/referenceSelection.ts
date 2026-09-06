/**
 * Sélection des références envoyées avec une génération.
 *
 * ---------------------------------------------------------------------------
 * JAMAIS TOUTE LA BIBLIOTHÈQUE
 * ---------------------------------------------------------------------------
 * Deux règles non négociables :
 *
 *   1. Seules les références EXPLICITEMENT VALIDÉES par l'utilisateur sont
 *      éligibles. Un asset généré, même réussi, ne devient jamais une
 *      référence tout seul.
 *
 *   2. La sélection automatique est PLAFONNÉE et ne renvoie jamais tout. Elle
 *      propose ; l'utilisateur voit et modifie avant de lancer.
 *
 * Chaque référence retenue arrive avec un motif lisible, pour que la
 * proposition soit vérifiable au lieu d'être subie.
 * ---------------------------------------------------------------------------
 */

import type { AssetFamily } from "@/types/project";
import type { ProjectReference } from "@/types/project";

/**
 * Nombre maximum de références proposées automatiquement.
 *
 * Bas volontairement : chaque image d'entrée est facturée et allonge l'appel.
 * L'utilisateur peut en ajouter au-delà, mais c'est alors un choix conscient.
 */
export const MAX_AUTO_SELECTED = 4;

/** Plafond dur, aligné sur la limite du fournisseur (16 images par appel). */
export const MAX_TOTAL_SELECTED = 16;

export type SelectionReason =
  | "famille"
  | "projet"
  | "épinglée"
  | "choix manuel";

export interface ReferenceCandidate {
  reference: ProjectReference;
  selected: boolean;
  reason: SelectionReason;
  /** Rang de pertinence, du plus au moins pertinent. */
  rank: number;
}

export interface SelectionInput {
  references: ProjectReference[];
  family: AssetFamily | null;
  /**
   * Sélection explicite de l'utilisateur. `null` = laisser la proposition
   * automatique décider ; un tableau (même vide) prime toujours.
   */
  manualIds?: string[] | null;
  limit?: number;
}

export interface SelectionResult {
  /** Toutes les références validées, avec leur état de sélection. */
  candidates: ReferenceCandidate[];
  /** Les seules réellement envoyées. */
  selected: ProjectReference[];
  /** `true` si le plafond a écarté des candidates pertinentes. */
  capped: boolean;
  /** Références validées disponibles mais non retenues. */
  omittedCount: number;
}

/**
 * Classe les références validées et retient les plus pertinentes.
 *
 * Ordre déterministe : famille exacte, puis références globales du projet,
 * puis, à pertinence égale, la plus ancienne d'abord — pour qu'une même
 * demande donne toujours la même sélection.
 */
export function selectReferences(input: SelectionInput): SelectionResult {
  const limit = clampLimit(input.limit ?? MAX_AUTO_SELECTED);

  // Barrière n°1 : seules les références explicitement validées entrent ici.
  const eligible = input.references.filter((reference) => reference.validated);

  const ranked = [...eligible]
    .map((reference) => ({ reference, ...rankOf(reference, input.family) }))
    .sort((a, b) => a.rank - b.rank || a.reference.createdAt - b.reference.createdAt);

  // Une sélection manuelle prime toujours, y compris pour n'envoyer aucune image.
  if (Array.isArray(input.manualIds)) {
    const wanted = new Set(input.manualIds);
    const candidates = ranked.map((entry) => ({
      ...entry,
      selected: wanted.has(entry.reference.id),
      reason: wanted.has(entry.reference.id)
        ? ("choix manuel" as SelectionReason)
        : entry.reason,
    }));
    const selected = candidates
      .filter((entry) => entry.selected)
      .slice(0, MAX_TOTAL_SELECTED)
      .map((entry) => entry.reference);

    return {
      candidates,
      selected,
      capped: candidates.filter((entry) => entry.selected).length > MAX_TOTAL_SELECTED,
      omittedCount: candidates.length - selected.length,
    };
  }

  const keep = ranked.slice(0, limit);
  const keepIds = new Set(keep.map((entry) => entry.reference.id));

  const candidates: ReferenceCandidate[] = ranked.map((entry) => ({
    ...entry,
    selected: keepIds.has(entry.reference.id),
  }));

  return {
    candidates,
    selected: keep.map((entry) => entry.reference),
    capped: ranked.length > limit,
    omittedCount: ranked.length - keep.length,
  };
}

/**
 * Pertinence d'une référence pour une famille donnée.
 *
 * Une référence épinglée passe devant tout : c'est le moyen pour
 * l'utilisateur de dire « celle-ci, toujours ».
 */
function rankOf(
  reference: ProjectReference,
  family: AssetFamily | null,
): { rank: number; reason: SelectionReason } {
  if (reference.pinned) return { rank: 0, reason: "épinglée" };
  if (family !== null && reference.families.includes(family)) {
    return { rank: 1, reason: "famille" };
  }
  // Une référence sans famille vaut pour tout le projet.
  if (reference.families.length === 0) return { rank: 2, reason: "projet" };
  return { rank: 3, reason: "projet" };
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 0) return 0;
  return Math.min(Math.floor(limit), MAX_TOTAL_SELECTED);
}
