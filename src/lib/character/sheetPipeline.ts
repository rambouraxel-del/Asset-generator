/**
 * Chaîne serveur d'une planche de personnage : du rendu du modèle aux quatre
 * vues normalisées.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI UNE CHAÎNE DISTINCTE DU POST-TRAITEMENT HABITUEL
 * ---------------------------------------------------------------------------
 * `postProcessToFinalSize` commence par rogner les marges transparentes puis
 * recentre le sprite. C'est exactement ce qu'il faut pour un asset isolé, et
 * exactement ce qu'il ne faut pas ici : rogner une planche 2 × 2 déplace les
 * frontières de cellules, et tout le découpage part de travers.
 *
 * La chaîne ci-dessous ne rogne donc JAMAIS et ne recentre JAMAIS la planche.
 * Elle lit l'image entière bloc par bloc, découpe les quatre quarts, puis
 * confie le recadrage — cellule par cellule — à `alignCell`, seul endroit où
 * il a un sens.
 * ---------------------------------------------------------------------------
 */

import { CHARACTER_SHEET } from "@/lib/config";
import {
  buildCharacterSheet,
  prepareMaster,
  type PreparedMaster,
  type SheetCell,
} from "@/lib/character/characterSheet";
import { CharacterCellError, type SheetGeometry } from "@/lib/character/cellAlignment";
import { buildExportSheet } from "@/lib/character/sheetExport";
import { sheetSize, type Direction } from "@/lib/character/sheetLayout";
import {
  downscaleLogicalGrid,
  type BlockCoherenceStats,
  type BlockMethod,
} from "@/lib/image/logicalGrid";
import {
  applyPixelCleanup,
  defaultCleanupOptions,
  type PixelCleanupReport,
} from "@/lib/image/pixelCleanup";
import { decodePng, encodePng } from "@/lib/image/postProcessing";
import { resizeNearestNeighbour, type RgbaImage } from "@/lib/image/pixels";

export interface SheetPipelineInput {
  /** PNG du sprite maître, aux dimensions exactes d'une cellule. */
  masterPng: Buffer;
  masterDirection: Direction;
  /** PNG brut renvoyé par le modèle, censé représenter la planche 2 × 2. */
  generatedPng: Buffer;
  generateRightSeparately?: boolean;
  matchMasterPalette?: boolean;
  cellSize?: number;
  blockMethod?: BlockMethod;
}

export interface SheetPipelineReport {
  /** Dimensions du rendu brut du modèle. */
  sourceWidth: number;
  sourceHeight: number;
  /** Dimensions de la planche après réduction. */
  sheetWidth: number;
  sheetHeight: number;
  /** Facteurs de réduction réellement appliqués. */
  scaleX: number;
  scaleY: number;
  /** `true` si les deux facteurs sont entiers et identiques. */
  logicalGridClean: boolean;
  blockMethod: BlockMethod;
  gridStats: BlockCoherenceStats;
  cleanup: PixelCleanupReport;
  /**
   * Pixels semi-transparents relevés DANS LE MAÎTRE. Signalés, jamais corrigés :
   * le maître ressort identique au pixel près.
   */
  masterSemiTransparentPixels: number;
}

export interface SheetPipelineResult {
  geometry: SheetGeometry;
  cells: Record<Direction, SheetCell>;
  /** Planche 2 × 2 assemblée à partir des quatre vues livrées. */
  sheet: RgbaImage;
  generatedDirections: Direction[];
  notices: string[];
  report: SheetPipelineReport;
}

/**
 * Décode et vérifie le sprite maître.
 *
 * @throws {CharacterCellError} si le PNG est illisible ou n'a pas les
 *         dimensions d'une cellule.
 */
export function decodeMaster(
  masterPng: Buffer,
  cellSize: number = CHARACTER_SHEET.CELL_SIZE,
): PreparedMaster {
  let decoded: RgbaImage;
  try {
    decoded = decodePng(masterPng);
  } catch (error) {
    throw new CharacterCellError(
      `Le sprite maître n'a pas pu être décodé : ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return prepareMaster(decoded, cellSize);
}

/**
 * Agrandit le maître pour l'envoyer au modèle.
 *
 * Une image de 48 × 48 px transmise telle quelle est trop petite pour que le
 * modèle en lise l'identité graphique. L'agrandissement est un plus proche
 * voisin à facteur entier : chaque pixel devient un carré plein, aucun flou
 * n'est introduit, et le modèle voit exactement la même silhouette.
 */
export function upscaleMasterForModel(master: RgbaImage, scale: number): Buffer {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new CharacterCellError("Le facteur d'agrandissement du maître doit être un entier positif.");
  }
  const enlarged = resizeNearestNeighbour(
    master,
    master.width * scale,
    master.height * scale,
  );
  return encodePng(enlarged);
}

/**
 * Réduit le rendu du modèle à la planche finale, découpe et normalise.
 *
 * Aucun recadrage global : les quatre quarts de l'image restent les quatre
 * quarts, quoi qu'ait produit le modèle.
 */
export function runSheetPipeline(input: SheetPipelineInput): SheetPipelineResult {
  const cellSize = input.cellSize ?? CHARACTER_SHEET.CELL_SIZE;
  const target = sheetSize(cellSize);

  const master = decodeMaster(input.masterPng, cellSize);

  let raw: RgbaImage;
  try {
    raw = decodePng(input.generatedPng);
  } catch (error) {
    throw new CharacterCellError(
      `La planche générée n'a pas pu être décodée : ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (raw.width < target.width || raw.height < target.height) {
    throw new CharacterCellError(
      `La planche générée fait ${raw.width} × ${raw.height} px, soit moins que les ${target.width} × ${target.height} px attendus.`,
    );
  }

  // Lecture bloc par bloc sur l'image ENTIÈRE : les bornes de bloc restent
  // celles de la grille, et chaque quart source devient exactement un quart
  // de la planche réduite.
  const reduced = downscaleLogicalGrid(raw, {
    finalWidth: target.width,
    finalHeight: target.height,
    method: input.blockMethod,
  });

  /*
   * Nettoyage commun aux quatre vues, appliqué avant le découpage : une seule
   * palette pour toute la planche, ce qui est précisément ce qu'on veut d'un
   * personnage vu sous quatre angles. Ce traitement est strictement local à
   * chaque pixel — il ne déplace rien et ne peut donc pas décaler le découpage.
   */
  const cleaned = applyPixelCleanup(
    reduced.image,
    defaultCleanupOptions({ width: target.width, height: target.height }),
  );

  const built = buildCharacterSheet({
    master: master.image,
    masterDirection: input.masterDirection,
    generatedSheet: cleaned.image,
    generateRightSeparately: input.generateRightSeparately,
    matchMasterPalette: input.matchMasterPalette,
    cellSize,
  });

  const images = {} as Record<Direction, RgbaImage>;
  for (const [direction, cell] of Object.entries(built.cells)) {
    images[direction as Direction] = cell.image;
  }

  const notices = [...built.notices];
  if (master.semiTransparentPixels > 0) {
    notices.push(
      `Le sprite maître contient ${master.semiTransparentPixels} pixel(s) semi-transparent(s). Il est livré tel quel, sans correction : nettoyez-le en amont si vous voulez une transparence strictement binaire sur les quatre vues.`,
    );
  }

  return {
    geometry: built.geometry,
    cells: built.cells,
    sheet: buildExportSheet(images, cellSize),
    generatedDirections: built.generatedDirections,
    notices,
    report: {
      sourceWidth: raw.width,
      sourceHeight: raw.height,
      sheetWidth: target.width,
      sheetHeight: target.height,
      scaleX: reduced.scaleX,
      scaleY: reduced.scaleY,
      logicalGridClean:
        Number.isInteger(reduced.scaleX) &&
        Number.isInteger(reduced.scaleY) &&
        reduced.scaleX === reduced.scaleY,
      blockMethod: reduced.method,
      gridStats: reduced.stats,
      cleanup: cleaned.report,
      masterSemiTransparentPixels: master.semiTransparentPixels,
    },
  };
}

/** Encode une image en PNG base64, prête à traverser la réponse JSON. */
export function toBase64Png(image: RgbaImage): string {
  return encodePng(image).toString("base64");
}
