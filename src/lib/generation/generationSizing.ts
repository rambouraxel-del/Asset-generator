/**
 * Choix automatique de la résolution envoyée à GPT-Image-2.
 *
 * ---------------------------------------------------------------------------
 * DEUX TAILLES, À NE JAMAIS CONFONDRE
 * ---------------------------------------------------------------------------
 *   TAILLE FINALE       — ce que l'utilisateur veut livrer au jeu (16 × 16…).
 *   RÉSOLUTION GPT      — ce qui est réellement demandé au modèle.
 *
 * Le modèle refuse les très petites images : il impose un minimum d'environ
 * 655 360 pixels au total (voir `SIZE_CONSTRAINTS`). Un asset de 16 × 16 px ne
 * peut donc pas être généré directement. Ce module calcule la plus petite
 * résolution acceptable respectant le rapport demandé, et le post-traitement
 * local ramène ensuite l'image à la taille finale exacte, sans coût de jetons
 * supplémentaire.
 *
 * Objectif de la fonction : SOBRIÉTÉ. À rapport égal, on prend toujours la
 * résolution la moins coûteuse qui satisfasse les contraintes.
 * ---------------------------------------------------------------------------
 */

import { SIZE_CONSTRAINTS } from "@/lib/config";
import {
  SUPERSAMPLING_FACTORS,
  type ResolvedQualityMode,
} from "@/lib/generation/qualityMode";
import type { AssetCategory } from "@/types/domain";

export interface GenerationSizeChoice {
  width: number;
  height: number;
  /** Forme canonique passée au paramètre `size` de l'API. */
  size: string;
  /** Rapport largeur/hauteur réellement obtenu. */
  aspectRatio: number;
  /** Écart relatif au rapport demandé, entre 0 et 1. */
  aspectError: number;
  /** Facteur de réduction appliqué ensuite (résolution GPT → taille finale). */
  downscaleFactor: number;
  /** `true` si aucune résolution valide plus petite n'existait. */
  minimal: boolean;
}

/**
 * Écart de rapport toléré. Les côtés devant être des multiples de 16, un
 * rapport exact n'est pas toujours atteignable : on accepte un léger écart
 * plutôt que de gonfler la résolution pour rien. Le post-traitement corrige
 * de toute façon le cadrage final.
 */
const MAX_ASPECT_ERROR = 0.02;

/**
 * Choisit la résolution de génération pour une taille finale donnée.
 *
 * @param finalWidth   Largeur finale voulue de l'asset, en pixels.
 * @param finalHeight  Hauteur finale voulue de l'asset, en pixels.
 * @param qualityMode  Mode résolu (« auto » doit déjà avoir été tranché).
 * @param category     Catégorie de l'asset. Non utilisée aujourd'hui : elle est
 *                     présente pour permettre plus tard des profils par type
 *                     d'asset (une tuile de terrain n'a pas les mêmes besoins
 *                     qu'un personnage) sans changer la signature ni les
 *                     appelants.
 *
 * @returns La résolution retenue, ou `null` si aucune ne satisfait les
 *          contraintes du modèle — cas qui ne devrait pas se produire pour un
 *          rapport compris entre 1:3 et 3:1.
 */
export function chooseGenerationSize(
  finalWidth: number,
  finalHeight: number,
  qualityMode: ResolvedQualityMode,
  category?: AssetCategory | null,
): GenerationSizeChoice | null {
  void category; // Réservé aux profils par catégorie (V0.3).

  if (!Number.isFinite(finalWidth) || !Number.isFinite(finalHeight)) return null;
  if (finalWidth <= 0 || finalHeight <= 0) return null;

  const targetRatio = finalWidth / finalHeight;

  // Un rapport hors des limites du modèle n'est pas rattrapable.
  if (
    Math.max(targetRatio, 1 / targetRatio) >
    SIZE_CONSTRAINTS.MAX_ASPECT_RATIO
  ) {
    return null;
  }

  // Le suréchantillonnage ne joue que pour les assets déjà grands : pour un
  // petit asset, le plancher de pixels du modèle domine de très loin.
  const factor = SUPERSAMPLING_FACTORS[qualityMode];
  const minWidth = finalWidth * factor;
  const minHeight = finalHeight * factor;

  const step = SIZE_CONSTRAINTS.MULTIPLE_OF;
  let best: GenerationSizeChoice | null = null;

  for (let width = step; width <= SIZE_CONSTRAINTS.MAX_EDGE; width += step) {
    // Hauteur idéale pour ce rapport, ramenée au multiple de 16 le plus proche.
    const idealHeight = width / targetRatio;
    for (const height of nearbyMultiples(idealHeight, step)) {
      if (height <= 0 || height > SIZE_CONSTRAINTS.MAX_EDGE) continue;
      if (width < minWidth || height < minHeight) continue;

      const totalPixels = width * height;
      if (totalPixels < SIZE_CONSTRAINTS.MIN_TOTAL_PIXELS) continue;
      if (totalPixels > SIZE_CONSTRAINTS.MAX_TOTAL_PIXELS) continue;

      const ratio = width / height;
      if (Math.max(ratio, 1 / ratio) > SIZE_CONSTRAINTS.MAX_ASPECT_RATIO) continue;

      const aspectError = Math.abs(ratio - targetRatio) / targetRatio;
      if (aspectError > MAX_ASPECT_ERROR) continue;

      const candidate: GenerationSizeChoice = {
        width,
        height,
        size: `${width}x${height}`,
        aspectRatio: ratio,
        aspectError,
        downscaleFactor: width / finalWidth,
        minimal: true,
      };

      if (isBetter(candidate, best)) best = candidate;
    }

    // Les largeurs croissent : dès qu'une solution existe, toute solution
    // ultérieure sera plus grande. On s'arrête au premier palier concluant.
    if (best !== null) break;
  }

  return best;
}

/**
 * Compare deux candidats : d'abord le coût (nombre de pixels), puis la
 * fidélité au rapport demandé.
 */
function isBetter(
  candidate: GenerationSizeChoice,
  current: GenerationSizeChoice | null,
): boolean {
  if (current === null) return true;

  const candidateArea = candidate.width * candidate.height;
  const currentArea = current.width * current.height;
  if (candidateArea !== currentArea) return candidateArea < currentArea;

  return candidate.aspectError < current.aspectError;
}

/** Multiples de `step` encadrant une valeur, du plus proche au plus éloigné. */
function nearbyMultiples(value: number, step: number): number[] {
  const lower = Math.floor(value / step) * step;
  const upper = lower + step;
  return value - lower <= upper - value ? [lower, upper] : [upper, lower];
}

/**
 * Résolution de repli lorsque aucune taille finale n'est demandée : on
 * respecte alors le choix manuel de l'utilisateur, comportement hérité de la
 * V0.2 et volontairement conservé.
 */
export function describeGenerationSize(choice: GenerationSizeChoice): string {
  return `${choice.width} × ${choice.height}`;
}
