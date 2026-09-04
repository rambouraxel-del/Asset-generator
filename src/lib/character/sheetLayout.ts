/**
 * Disposition et découpage d'une planche de personnage.
 *
 * La planche est une grille 2 × 2 de cellules carrées, dans cet ordre :
 *
 *     +------+------+
 *     | down |  up  |
 *     +------+------+
 *     | left | right|
 *     +------+------+
 *
 * C'est à la fois le format demandé au modèle et celui de la planche exportée,
 * ce qui évite toute conversion intermédiaire.
 */

import { CHARACTER_SHEET } from "@/lib/config";
import { composeOnCanvas, createTransparentImage, cropImage, type RgbaImage } from "@/lib/image/pixels";

/** Orientation d'une vue du personnage. */
export type Direction = "down" | "up" | "left" | "right";

export const DIRECTIONS: readonly Direction[] = ["down", "up", "left", "right"];

/** Libellés affichés dans l'interface. */
export const DIRECTION_LABELS: Record<Direction, string> = {
  down: "Face",
  up: "Dos",
  left: "Profil gauche",
  right: "Profil droit",
};

/** Suffixe de nom de fichier, conforme aux conventions de sprite sheets. */
export const DIRECTION_SUFFIX: Record<Direction, string> = {
  down: "idle_down",
  up: "idle_up",
  left: "idle_left",
  right: "idle_right",
};

/** Position d'une cellule dans la grille 2 × 2, en nombre de cellules. */
export const DIRECTION_CELL: Record<Direction, { column: number; row: number }> = {
  down: { column: 0, row: 0 },
  up: { column: 1, row: 0 },
  left: { column: 0, row: 1 },
  right: { column: 1, row: 1 },
};

/** Dimensions de la planche pour une taille de cellule donnée. */
export function sheetSize(cellSize: number = CHARACTER_SHEET.CELL_SIZE): {
  width: number;
  height: number;
} {
  return { width: cellSize * 2, height: cellSize * 2 };
}

/**
 * Extrait une cellule de la planche.
 *
 * @throws si la planche n'a pas exactement les dimensions attendues — mieux
 *         vaut échouer franchement que découper de travers.
 */
export function sliceCell(
  sheet: RgbaImage,
  direction: Direction,
  cellSize: number = CHARACTER_SHEET.CELL_SIZE,
): RgbaImage {
  const expected = sheetSize(cellSize);
  if (sheet.width !== expected.width || sheet.height !== expected.height) {
    throw new Error(
      `Planche de ${sheet.width} × ${sheet.height} px, attendu ${expected.width} × ${expected.height}.`,
    );
  }

  const cell = DIRECTION_CELL[direction];
  return cropImage(sheet, {
    left: cell.column * cellSize,
    top: cell.row * cellSize,
    width: cellSize,
    height: cellSize,
  });
}

/** Découpe les quatre cellules d'une planche. */
export function sliceSheet(
  sheet: RgbaImage,
  cellSize: number = CHARACTER_SHEET.CELL_SIZE,
): Record<Direction, RgbaImage> {
  return {
    down: sliceCell(sheet, "down", cellSize),
    up: sliceCell(sheet, "up", cellSize),
    left: sliceCell(sheet, "left", cellSize),
    right: sliceCell(sheet, "right", cellSize),
  };
}

/**
 * Assemble quatre cellules en une planche 2 × 2.
 *
 * Opération purement entière : chaque cellule est recopiée à sa place, aucun
 * rééchantillonnage n'intervient.
 */
export function assembleSheet(
  cells: Record<Direction, RgbaImage>,
  cellSize: number = CHARACTER_SHEET.CELL_SIZE,
): RgbaImage {
  const size = sheetSize(cellSize);
  const sheet = createTransparentImage(size.width, size.height);

  for (const direction of DIRECTIONS) {
    const cell = cells[direction];
    if (cell.width !== cellSize || cell.height !== cellSize) {
      throw new Error(
        `Cellule ${direction} de ${cell.width} × ${cell.height} px, attendu ${cellSize} × ${cellSize}.`,
      );
    }

    const position = DIRECTION_CELL[direction];
    const offsetX = position.column * cellSize;
    const offsetY = position.row * cellSize;

    for (let y = 0; y < cellSize; y += 1) {
      for (let x = 0; x < cellSize; x += 1) {
        const from = (y * cellSize + x) * 4;
        const to = ((offsetY + y) * size.width + offsetX + x) * 4;
        sheet.data[to] = cell.data[from];
        sheet.data[to + 1] = cell.data[from + 1];
        sheet.data[to + 2] = cell.data[from + 2];
        sheet.data[to + 3] = cell.data[from + 3];
      }
    }
  }

  return sheet;
}

/** Dépose une image sur un canvas de cellule, sans redimensionnement. */
export function padToCell(image: RgbaImage, cellSize: number): RgbaImage {
  return composeOnCanvas(image, cellSize, cellSize, "center");
}
