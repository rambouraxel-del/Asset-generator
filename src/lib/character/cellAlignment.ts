/**
 * Alignement d'une cellule de personnage.
 *
 * ---------------------------------------------------------------------------
 * LE PROBLÈME TRAITÉ
 * ---------------------------------------------------------------------------
 * Même générées ensemble, les vues d'un personnage ne tombent pas exactement
 * à la même échelle ni sur la même ligne de sol. Relevé sur des cellules de
 * 48 × 48 : face 20 × 44 pieds à Y=45, dos 16 × 42 pieds à Y=44, profil
 * 16 × 40 pieds à Y=43. En jeu, le personnage « saute » à chaque changement
 * de direction.
 *
 * La normalisation ci-dessous remet chaque vue sur la même hauteur visuelle,
 * le même centre horizontal et la même ligne de pieds — sans jamais lisser :
 * seul le plus proche voisin est employé, et uniquement si l'écart de hauteur
 * le justifie.
 * ---------------------------------------------------------------------------
 */

import { CHARACTER_SHEET } from "@/lib/config";
import {
  extractPalette,
  mapImageToPalette,
  type Rgb,
} from "@/lib/image/paletteQuantization";
import {
  createTransparentImage,
  cropImage,
  findVisibleBounds,
  resizeNearestNeighbour,
  type Bounds,
  type RgbaImage,
} from "@/lib/image/pixels";

/**
 * Géométrie que toutes les cellules doivent respecter.
 *
 * `feetY` et `visualHeight` sont dérivés du MAÎTRE, pas de constantes : le
 * maître est exporté tel quel, bit pour bit, donc c'est à lui que les autres
 * vues doivent s'aligner. Les valeurs de `CHARACTER_SHEET.TARGET` servent de
 * référence standard, et l'écart éventuel du maître est signalé plutôt que
 * corrigé en silence.
 */
export interface SheetGeometry {
  cellSize: number;
  /** Centre horizontal visé, (cellSize − 1) / 2. */
  centreX: number;
  /** Ligne du bas des pieds, reprise du maître. */
  feetY: number;
  /** Hauteur visuelle visée, reprise du maître. */
  visualHeight: number;
  /** `true` si le maître respecte la ligne de pieds standard. */
  matchesStandardFeetLine: boolean;
}

export class CharacterCellError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CharacterCellError";
  }
}

/**
 * Déduit la géométrie cible du sprite maître.
 *
 * @throws si le maître n'a pas les dimensions d'une cellule, ou s'il est vide :
 *         sans référence exploitable, aligner n'aurait aucun sens.
 */
export function deriveGeometryFromMaster(
  master: RgbaImage,
  cellSize: number = CHARACTER_SHEET.CELL_SIZE,
): SheetGeometry {
  if (master.width !== cellSize || master.height !== cellSize) {
    throw new CharacterCellError(
      `Le sprite maître fait ${master.width} × ${master.height} px, or une cellule fait ${cellSize} × ${cellSize} px.`,
    );
  }

  const bounds = findVisibleBounds(master);
  if (bounds === null) {
    throw new CharacterCellError("Le sprite maître ne contient aucun pixel visible.");
  }

  const feetY = bounds.top + bounds.height - 1;

  return {
    cellSize,
    centreX: (cellSize - 1) / 2,
    feetY,
    visualHeight: bounds.height,
    matchesStandardFeetLine: feetY === CHARACTER_SHEET.TARGET.FEET_Y,
  };
}

export interface CellAlignmentOptions {
  /** Palette du maître ; les couleurs y sont rapprochées si elle est fournie. */
  masterPalette?: Rgb[] | null;
}

export interface CellAlignmentReport {
  /** Boîte utile avant alignement. */
  sourceBounds: Bounds | null;
  /** `true` si un redimensionnement a été appliqué. */
  resized: boolean;
  /** Dimensions retenues après redimensionnement éventuel. */
  alignedWidth: number;
  alignedHeight: number;
  /** Déplacement appliqué pour recentrer et poser les pieds. */
  offsetX: number;
  offsetY: number;
  /** Pixels dont la couleur a été rapprochée de la palette maître. */
  recolouredPixels: number;
  /** Pixels dont l'alpha a été forcé à 0 ou 255. */
  binarisedPixels: number;
}

/**
 * Normalise une cellule sur la géométrie cible.
 *
 * Enchaînement : détourage, redimensionnement conditionnel au plus proche
 * voisin, dépôt sur un canvas exact, transparence binaire, puis rapprochement
 * de palette. L'ordre compte : binariser avant le rapprochement évite de
 * faire entrer dans le calcul de couleur des pixels voués à disparaître.
 *
 * @throws si la cellule est vide — le cas doit être signalé à l'utilisateur,
 *         pas masqué par un canvas transparent.
 */
export function alignCell(
  cell: RgbaImage,
  geometry: SheetGeometry,
  options: CellAlignmentOptions = {},
): { image: RgbaImage; report: CellAlignmentReport } {
  const bounds = findVisibleBounds(cell);
  if (bounds === null) {
    throw new CharacterCellError("La cellule générée est vide.");
  }

  const cropped = cropImage(cell, bounds);

  // Redimensionnement uniquement si l'écart le justifie : corriger un seul
  // pixel de hauteur abîmerait la silhouette plus qu'il ne l'alignerait.
  const heightDelta = Math.abs(bounds.height - geometry.visualHeight);
  const mustResize = heightDelta > CHARACTER_SHEET.HEIGHT_TOLERANCE;

  const alignedHeight = mustResize ? geometry.visualHeight : bounds.height;
  const alignedWidth = mustResize
    ? Math.max(1, Math.round((bounds.width * geometry.visualHeight) / bounds.height))
    : bounds.width;

  const scaled = mustResize
    ? resizeNearestNeighbour(cropped, alignedWidth, alignedHeight)
    : cropped;

  /*
   * Placement. Le centre horizontal vise `geometry.centreX` : une largeur
   * paire s'y centre exactement, une largeur impaire tombe au demi-pixel près,
   * et l'on choisit alors le décalage vers la gauche pour rester déterministe.
   * La ligne de pieds, elle, est respectée exactement.
   */
  const offsetX = Math.floor((geometry.cellSize - alignedWidth) / 2);
  const offsetY = geometry.feetY - (alignedHeight - 1);

  const canvas = createTransparentImage(geometry.cellSize, geometry.cellSize);
  for (let y = 0; y < alignedHeight; y += 1) {
    const targetY = offsetY + y;
    if (targetY < 0 || targetY >= geometry.cellSize) continue;
    for (let x = 0; x < alignedWidth; x += 1) {
      const targetX = offsetX + x;
      if (targetX < 0 || targetX >= geometry.cellSize) continue;
      const from = (y * alignedWidth + x) * 4;
      const to = (targetY * geometry.cellSize + targetX) * 4;
      canvas.data[to] = scaled.data[from];
      canvas.data[to + 1] = scaled.data[from + 1];
      canvas.data[to + 2] = scaled.data[from + 2];
      canvas.data[to + 3] = scaled.data[from + 3];
    }
  }

  const binarised = binariseAlpha(canvas);

  const recoloured =
    options.masterPalette && options.masterPalette.length > 0
      ? mapImageToPalette(binarised.image, options.masterPalette)
      : { image: binarised.image, changedPixels: 0 };

  return {
    image: recoloured.image,
    report: {
      sourceBounds: bounds,
      resized: mustResize,
      alignedWidth,
      alignedHeight,
      offsetX,
      offsetY,
      recolouredPixels: recoloured.changedPixels,
      binarisedPixels: binarised.changedPixels,
    },
  };
}

/**
 * Force une transparence strictement binaire : 0 ou 255, jamais entre.
 *
 * Le nettoyage pixel de la chaîne principale le fait déjà, mais une cellule
 * peut être découpée d'une source externe (sprite maître importé). On ne prend
 * donc pas le risque de laisser passer un demi-pixel.
 */
export function binariseAlpha(
  image: RgbaImage,
  threshold: number = CHARACTER_SHEET.ALPHA_THRESHOLD,
): { image: RgbaImage; changedPixels: number } {
  const data = new Uint8Array(image.data);
  let changedPixels = 0;

  for (let offset = 3; offset < data.length; offset += 4) {
    const alpha = data[offset];
    if (alpha === 0 || alpha === 255) continue;

    changedPixels += 1;
    if (alpha >= threshold) {
      data[offset] = 255;
    } else {
      // Un pixel effacé perd aussi sa couleur : pas de teinte fantôme.
      data[offset - 3] = 0;
      data[offset - 2] = 0;
      data[offset - 1] = 0;
      data[offset] = 0;
    }
  }

  return { image: { width: image.width, height: image.height, data }, changedPixels };
}

/**
 * Miroir horizontal exact.
 *
 * Chaque pixel est recopié tel quel à sa colonne symétrique : aucune
 * interpolation n'est possible, et appliquer deux fois la fonction redonne
 * exactement l'image d'origine.
 */
export function mirrorHorizontally(image: RgbaImage): RgbaImage {
  const result = createTransparentImage(image.width, image.height);

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const from = (y * image.width + x) * 4;
      const to = (y * image.width + (image.width - 1 - x)) * 4;
      result.data[to] = image.data[from];
      result.data[to + 1] = image.data[from + 1];
      result.data[to + 2] = image.data[from + 2];
      result.data[to + 3] = image.data[from + 3];
    }
  }

  return result;
}

/** Palette du sprite maître, à imposer aux autres vues. */
export function masterPaletteOf(master: RgbaImage): Rgb[] {
  return extractPalette(master);
}
