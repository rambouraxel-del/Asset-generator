/**
 * Nommage et assemblage des fichiers exportés d'une planche de personnage.
 *
 * Volontairement dépourvu de toute dépendance au navigateur : la construction
 * des noms et de la planche 2 × 2 est pure, donc testable sans DOM. Le
 * téléchargement lui-même reste dans `lib/client/download.ts`.
 */

import { CHARACTER_SHEET } from "@/lib/config";
import {
  DIRECTIONS,
  DIRECTION_SUFFIX,
  assembleSheet,
  type Direction,
} from "@/lib/character/sheetLayout";
import type { RgbaImage } from "@/lib/image/pixels";

/** Nom de repli quand le nom saisi ne donne aucun caractère exploitable. */
export const DEFAULT_CHARACTER_SLUG = "personnage";

/**
 * Réduit un nom libre à un identifiant de fichier sûr.
 *
 * Les accents sont décomposés puis retirés, et tout le reste devient des
 * tirets bas : `Héros du village` donne `heros_du_village`, qui se prête aux
 * conventions de nommage des sprite sheets.
 */
export function characterSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
    .replace(/_+$/g, "");

  return slug.length > 0 ? slug : DEFAULT_CHARACTER_SLUG;
}

/** `{nom}_idle_down.png` et compagnie. */
export function cellFilename(name: string, direction: Direction): string {
  return `${characterSlug(name)}_${DIRECTION_SUFFIX[direction]}.png`;
}

/** `{nom}_idle_sheet.png`. */
export function sheetFilename(name: string): string {
  return `${characterSlug(name)}_idle_sheet.png`;
}

/** Nom lisible d'une vue rangée dans la bibliothèque. */
export function cellAssetName(name: string, direction: Direction): string {
  return `${name.trim() || "Personnage"} — ${DIRECTION_SUFFIX[direction]}`;
}

/**
 * Planche 2 × 2 exportable, aux dimensions `2 × cellSize`.
 *
 * Simple recopie de pixels : la planche exportée est exactement la juxtaposition
 * des quatre vues livrées, sans rééchantillonnage ni retouche.
 */
export function buildExportSheet(
  cells: Record<Direction, RgbaImage>,
  cellSize: number = CHARACTER_SHEET.CELL_SIZE,
): RgbaImage {
  return assembleSheet(cells, cellSize);
}

/** Les quatre noms de fichiers, dans l'ordre d'affichage. */
export function allCellFilenames(name: string): Record<Direction, string> {
  const names = {} as Record<Direction, string>;
  for (const direction of DIRECTIONS) names[direction] = cellFilename(name, direction);
  return names;
}
