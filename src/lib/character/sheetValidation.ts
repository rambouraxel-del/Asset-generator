/**
 * Contrôle de cohérence d'une planche de personnage.
 *
 * L'utilisateur doit pouvoir juger d'un coup d'œil si les quatre vues
 * s'alignent réellement, et refuser la planche sinon. Les mesures sont donc
 * exposées telles quelles, avec un statut par direction.
 */

import { CHARACTER_SHEET } from "@/lib/config";
import type { SheetGeometry } from "@/lib/character/cellAlignment";
import type { Direction } from "@/lib/character/sheetLayout";
import { findVisibleBounds, type Bounds, type RgbaImage } from "@/lib/image/pixels";

export interface CellMetrics {
  canvasWidth: number;
  canvasHeight: number;
  /** Boîte utile, `null` si la cellule est vide. */
  bounds: Bounds | null;
  /** Centre horizontal de la boîte utile. */
  centreX: number | null;
  /** Ligne du bas des pieds. */
  feetY: number | null;
  /** Hauteur visuelle du personnage. */
  visualHeight: number | null;
  colourCount: number;
  alphaLevelCount: number;
  visiblePixels: number;
  /** Pixels ni opaques ni totalement transparents. Doit valoir 0. */
  semiTransparentPixels: number;
  /** `true` si l'alpha ne prend que les valeurs 0 et 255. */
  binaryAlpha: boolean;
}

/**
 * Statut d'une cellule.
 *
 *   ok      — hauteur à ±1 px et pieds parfaitement alignés ;
 *   warning — écart de hauteur de 2 px ;
 *   error   — écart supérieur à 2 px, pieds décalés, ou alpha partiel.
 */
export type CellStatus = "ok" | "warning" | "error";

export interface CellValidation {
  direction: Direction;
  metrics: CellMetrics;
  status: CellStatus;
  /** Motifs lisibles expliquant un statut dégradé. */
  issues: string[];
  /** Écart de hauteur par rapport à la cible, `null` si la cellule est vide. */
  heightDelta: number | null;
  /** Décalage horizontal par rapport au centre visé. */
  centreOffset: number | null;
}

export const STATUS_LABELS: Record<CellStatus, string> = {
  ok: "Aligné",
  warning: "À vérifier",
  error: "Non conforme",
};

/** Mesures brutes d'une cellule. */
export function measureCell(cell: RgbaImage): CellMetrics {
  const colours = new Set<number>();
  const alphaLevels = new Set<number>();
  let visiblePixels = 0;
  let semiTransparentPixels = 0;
  let binaryAlpha = true;

  for (let offset = 0; offset < cell.data.length; offset += 4) {
    const alpha = cell.data[offset + 3];
    alphaLevels.add(alpha);
    if (alpha !== 0 && alpha !== 255) {
      binaryAlpha = false;
      semiTransparentPixels += 1;
    }
    if (alpha === 0) continue;

    visiblePixels += 1;
    colours.add((cell.data[offset] << 16) | (cell.data[offset + 1] << 8) | cell.data[offset + 2]);
  }

  const bounds = findVisibleBounds(cell);

  return {
    canvasWidth: cell.width,
    canvasHeight: cell.height,
    bounds,
    centreX: bounds === null ? null : bounds.left + (bounds.width - 1) / 2,
    feetY: bounds === null ? null : bounds.top + bounds.height - 1,
    visualHeight: bounds === null ? null : bounds.height,
    colourCount: colours.size,
    alphaLevelCount: alphaLevels.size,
    visiblePixels,
    semiTransparentPixels,
    binaryAlpha,
  };
}

/** Mesure une cellule et la confronte à la géométrie cible. */
export function validateCell(
  direction: Direction,
  cell: RgbaImage,
  geometry: SheetGeometry,
): CellValidation {
  const metrics = measureCell(cell);
  const issues: string[] = [];

  if (metrics.bounds === null) {
    return {
      direction,
      metrics,
      status: "error",
      issues: ["Cellule vide : aucun pixel visible."],
      heightDelta: null,
      centreOffset: null,
    };
  }

  if (metrics.canvasWidth !== geometry.cellSize || metrics.canvasHeight !== geometry.cellSize) {
    issues.push(
      `Canevas de ${metrics.canvasWidth} × ${metrics.canvasHeight} px au lieu de ${geometry.cellSize} × ${geometry.cellSize}.`,
    );
  }

  const heightDelta = (metrics.visualHeight ?? 0) - geometry.visualHeight;
  const centreOffset = (metrics.centreX ?? 0) - geometry.centreX;

  if (!metrics.binaryAlpha) {
    issues.push("Transparence partielle : l'alpha n'est pas strictement 0 ou 255.");
  }

  if (metrics.feetY !== geometry.feetY) {
    issues.push(
      `Pieds à Y=${metrics.feetY} au lieu de Y=${geometry.feetY}.`,
    );
  }

  const absoluteDelta = Math.abs(heightDelta);
  if (absoluteDelta > CHARACTER_SHEET.STATUS_THRESHOLDS.WARNING) {
    issues.push(
      `Hauteur de ${metrics.visualHeight} px au lieu de ${geometry.visualHeight} px (écart de ${absoluteDelta} px).`,
    );
  } else if (absoluteDelta === CHARACTER_SHEET.STATUS_THRESHOLDS.WARNING) {
    issues.push(`Hauteur écartée de ${absoluteDelta} px de la cible.`);
  }

  // Le centre n'entre pas dans le statut : une largeur impaire ne peut pas
  // tomber exactement sur un demi-pixel. On le signale sans dégrader.
  if (Math.abs(centreOffset) > 0.5) {
    issues.push(`Centre horizontal à X=${metrics.centreX} au lieu de X=${geometry.centreX}.`);
  }

  return {
    direction,
    metrics,
    status: resolveStatus({
      absoluteDelta,
      feetAligned: metrics.feetY === geometry.feetY,
      binaryAlpha: metrics.binaryAlpha,
      canvasOk:
        metrics.canvasWidth === geometry.cellSize &&
        metrics.canvasHeight === geometry.cellSize,
    }),
    issues,
    heightDelta,
    centreOffset,
  };
}

function resolveStatus(input: {
  absoluteDelta: number;
  feetAligned: boolean;
  binaryAlpha: boolean;
  canvasOk: boolean;
}): CellStatus {
  if (
    !input.canvasOk ||
    !input.binaryAlpha ||
    !input.feetAligned ||
    input.absoluteDelta > CHARACTER_SHEET.STATUS_THRESHOLDS.WARNING
  ) {
    return "error";
  }
  if (input.absoluteDelta === CHARACTER_SHEET.STATUS_THRESHOLDS.WARNING) return "warning";
  return "ok";
}

/** Statut global : le pire des quatre. */
export function overallStatus(validations: CellValidation[]): CellStatus {
  if (validations.some((entry) => entry.status === "error")) return "error";
  if (validations.some((entry) => entry.status === "warning")) return "warning";
  return "ok";
}
