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

import { LOGICAL_GRID, SIZE_CONSTRAINTS } from "@/lib/config";
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

  /* ---- Grille logique (V0.2.3) ---------------------------------------- */

  /** Nombre de pixels générés par pixel final, en largeur puis en hauteur. */
  scaleX: number;
  scaleY: number;
  /** `true` si les deux facteurs sont entiers. */
  integerScale: boolean;
  /** `true` si les deux facteurs sont identiques. */
  uniformScale: boolean;
  /**
   * `true` si la résolution permet une vraie grille logique : facteurs entiers
   * ET identiques. C'est la condition d'entrée du pipeline Pixel Grid.
   */
  logicalGridReady: boolean;
  /** Surcoût par rapport à la résolution la moins chère acceptable. */
  costRatio: number;
  /** Détail du score, pour comprendre pourquoi ce candidat a été retenu. */
  score: SizeScoreBreakdown;
}

/** Candidat de résolution, avant notation. */
export interface SizeCandidate {
  width: number;
  height: number;
  area: number;
  scaleX: number;
  scaleY: number;
  integerScale: boolean;
  uniformScale: boolean;
  aspectError: number;
  costRatio: number;
}

/** Décomposition du score, pour rendre le choix explicable. */
export interface SizeScoreBreakdown {
  /** Prime liée à la qualité de la grille logique. */
  grid: number;
  /** Pénalité de coût (négative). */
  cost: number;
  /** Pénalité d'écart de rapport (négative). */
  aspect: number;
  total: number;
}

/**
 * Note un candidat de résolution.
 *
 * La grille logique domine volontairement le score : c'est l'apport de la
 * V0.2.3. Le coût et l'écart de rapport ne servent qu'à départager, et un
 * plafond de surcoût (`LOGICAL_GRID.MAX_COST_RATIO`) écarte de toute façon les
 * candidats déraisonnables avant même la notation — on ne paie pas trois fois
 * le prix pour une grille parfaite.
 */
export function scoreGenerationSize(candidate: SizeCandidate): SizeScoreBreakdown {
  const weights = LOGICAL_GRID.WEIGHTS;

  const grid =
    candidate.integerScale && candidate.uniformScale
      ? weights.UNIFORM_INTEGER
      : candidate.integerScale
        ? weights.NON_UNIFORM_INTEGER
        : Number.isInteger(candidate.scaleX) || Number.isInteger(candidate.scaleY)
          ? weights.PARTIAL_INTEGER
          : 0;

  const cost = -weights.COST * Math.max(0, candidate.costRatio - 1);
  const aspect = -weights.ASPECT * candidate.aspectError;

  return { grid, cost, aspect, total: grid + cost + aspect };
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
  if (Math.max(targetRatio, 1 / targetRatio) > SIZE_CONSTRAINTS.MAX_ASPECT_RATIO) {
    return null;
  }

  // Le suréchantillonnage ne joue que pour les assets déjà grands : pour un
  // petit asset, le plancher de pixels du modèle domine de très loin.
  const factor = SUPERSAMPLING_FACTORS[qualityMode];
  const minWidth = finalWidth * factor;
  const minHeight = finalHeight * factor;

  // Référence de coût : la plus petite résolution acceptable, c'est-à-dire le
  // choix qu'aurait fait la V0.2.2.
  const cheapest = findCheapestValid(targetRatio, minWidth, minHeight);
  if (cheapest === null) return null;

  const candidates = collectCandidates({
    finalWidth,
    finalHeight,
    targetRatio,
    minWidth,
    minHeight,
    referenceArea: cheapest.area,
    maxCostRatio: LOGICAL_GRID.MAX_COST_RATIO[qualityMode] ?? 1.6,
  });

  let best: { candidate: SizeCandidate; score: SizeScoreBreakdown } | null = null;
  for (const candidate of candidates) {
    const score = scoreGenerationSize(candidate);
    if (best === null || score.total > best.score.total) best = { candidate, score };
  }

  if (best === null) return null;

  const { candidate, score } = best;
  return {
    width: candidate.width,
    height: candidate.height,
    size: `${candidate.width}x${candidate.height}`,
    aspectRatio: candidate.width / candidate.height,
    aspectError: candidate.aspectError,
    downscaleFactor: candidate.scaleX,
    minimal: candidate.area <= cheapest.area,
    scaleX: candidate.scaleX,
    scaleY: candidate.scaleY,
    integerScale: candidate.integerScale,
    uniformScale: candidate.uniformScale,
    logicalGridReady: candidate.integerScale && candidate.uniformScale,
    costRatio: candidate.costRatio,
    score,
  };
}

/**
 * Rassemble les candidats à noter : d'une part la résolution la moins chère au
 * bon rapport (le repli sûr), d'autre part les résolutions à grille entière,
 * tant qu'elles restent sous le plafond de surcoût.
 */
function collectCandidates(input: {
  finalWidth: number;
  finalHeight: number;
  targetRatio: number;
  minWidth: number;
  minHeight: number;
  referenceArea: number;
  maxCostRatio: number;
}): SizeCandidate[] {
  const {
    finalWidth,
    finalHeight,
    targetRatio,
    minWidth,
    minHeight,
    referenceArea,
    maxCostRatio,
  } = input;

  const candidates: SizeCandidate[] = [];
  const seen = new Set<string>();

  const add = (width: number, height: number): void => {
    const key = `${width}x${height}`;
    if (seen.has(key)) return;
    if (!isValidResolution(width, height)) return;
    if (width < minWidth || height < minHeight) return;

    const ratio = width / height;
    const aspectError = Math.abs(ratio - targetRatio) / targetRatio;
    if (aspectError > MAX_ASPECT_ERROR) return;

    const area = width * height;
    const costRatio = area / referenceArea;
    // Le repli (coût 1,00) passe toujours : un choix doit rester possible.
    if (costRatio > maxCostRatio && costRatio > 1) return;

    const scaleX = width / finalWidth;
    const scaleY = height / finalHeight;

    seen.add(key);
    candidates.push({
      width,
      height,
      area,
      scaleX,
      scaleY,
      integerScale: Number.isInteger(scaleX) && Number.isInteger(scaleY),
      uniformScale: scaleX === scaleY,
      aspectError,
      costRatio,
    });
  };

  // 1. Grilles uniformes : (finalWidth × k, finalHeight × k).
  for (let k = 1; finalWidth * k <= SIZE_CONSTRAINTS.MAX_EDGE; k += 1) {
    const width = finalWidth * k;
    const height = finalHeight * k;
    if (height > SIZE_CONSTRAINTS.MAX_EDGE) break;
    if (width * height > SIZE_CONSTRAINTS.MAX_TOTAL_PIXELS) break;
    add(width, height);
  }

  // 2. Grilles entières non uniformes : facteurs différents en X et Y.
  for (let kx = 1; finalWidth * kx <= SIZE_CONSTRAINTS.MAX_EDGE; kx += 1) {
    const width = finalWidth * kx;
    for (const ky of [kx - 1, kx, kx + 1]) {
      if (ky < 1) continue;
      const height = finalHeight * ky;
      if (height > SIZE_CONSTRAINTS.MAX_EDGE) continue;
      add(width, height);
    }
  }

  // 3. Repli : la résolution la moins chère au bon rapport, sans contrainte de
  //    grille. Toujours présente, pour qu'un choix reste possible.
  const cheapest = findCheapestValid(targetRatio, minWidth, minHeight);
  if (cheapest !== null) add(cheapest.width, cheapest.height);

  return candidates;
}

/** Plus petite résolution valide respectant le rapport demandé. */
function findCheapestValid(
  targetRatio: number,
  minWidth: number,
  minHeight: number,
): { width: number; height: number; area: number } | null {
  const step = SIZE_CONSTRAINTS.MULTIPLE_OF;
  let best: { width: number; height: number; area: number } | null = null;

  for (let width = step; width <= SIZE_CONSTRAINTS.MAX_EDGE; width += step) {
    for (const height of nearbyMultiples(width / targetRatio, step)) {
      if (height <= 0 || !isValidResolution(width, height)) continue;
      if (width < minWidth || height < minHeight) continue;

      const ratio = width / height;
      if (Math.abs(ratio - targetRatio) / targetRatio > MAX_ASPECT_ERROR) continue;

      const area = width * height;
      if (best === null || area < best.area) best = { width, height, area };
    }
    if (best !== null) break;
  }

  return best;
}

/** Contraintes dures du modèle. */
function isValidResolution(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  if (width % SIZE_CONSTRAINTS.MULTIPLE_OF !== 0) return false;
  if (height % SIZE_CONSTRAINTS.MULTIPLE_OF !== 0) return false;
  if (width > SIZE_CONSTRAINTS.MAX_EDGE || height > SIZE_CONSTRAINTS.MAX_EDGE) return false;

  const total = width * height;
  if (total < SIZE_CONSTRAINTS.MIN_TOTAL_PIXELS) return false;
  if (total > SIZE_CONSTRAINTS.MAX_TOTAL_PIXELS) return false;

  const ratio = width / height;
  return Math.max(ratio, 1 / ratio) <= SIZE_CONSTRAINTS.MAX_ASPECT_RATIO;
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
