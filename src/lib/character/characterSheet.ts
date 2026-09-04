/**
 * Assemblage d'une planche de personnage à partir du rendu du modèle.
 *
 * ---------------------------------------------------------------------------
 * DEUX GARANTIES
 * ---------------------------------------------------------------------------
 * 1. LE MAÎTRE N'EST JAMAIS RÉÉCRIT. Sa direction reprend ses octets d'origine,
 *    tels quels. La cellule que le modèle a produite pour cette direction est
 *    volontairement écartée : elle n'a servi qu'à donner au modèle le contexte
 *    des autres vues.
 *
 * 2. LE PROFIL DROIT EST UN MIROIR EXACT du profil gauche, sauf demande
 *    explicite de le générer séparément. Aucune interpolation ne peut s'y
 *    glisser, et miroir de miroir redonne l'original au bit près.
 * ---------------------------------------------------------------------------
 */

import { CHARACTER_SHEET } from "@/lib/config";
import {
  alignCell,
  binariseAlpha,
  deriveGeometryFromMaster,
  masterPaletteOf,
  mirrorHorizontally,
  CharacterCellError,
  type CellAlignmentReport,
  type SheetGeometry,
} from "@/lib/character/cellAlignment";
import {
  DIRECTIONS,
  sliceSheet,
  type Direction,
} from "@/lib/character/sheetLayout";
import {
  validateCell,
  type CellValidation,
} from "@/lib/character/sheetValidation";
import type { RgbaImage } from "@/lib/image/pixels";

/** Provenance d'une cellule, affichée à l'utilisateur. */
export type CellOrigin = "maître" | "générée" | "miroir";

export interface SheetCell {
  direction: Direction;
  image: RgbaImage;
  origin: CellOrigin;
  /** `null` pour le maître, qui n'est jamais retraité. */
  alignment: CellAlignmentReport | null;
  validation: CellValidation;
}

export interface BuildSheetOptions {
  /** Sprite maître, aux dimensions exactes d'une cellule. */
  master: RgbaImage;
  /** Direction que représente le maître. */
  masterDirection: Direction;
  /** Planche rendue par le modèle, aux dimensions de la grille 2 × 2. */
  generatedSheet: RgbaImage;
  /** Génère le profil droit au lieu de le déduire par miroir. */
  generateRightSeparately?: boolean;
  /** Rapproche la palette des vues de celle du maître. */
  matchMasterPalette?: boolean;
  cellSize?: number;
}

export interface CharacterSheetResult {
  geometry: SheetGeometry;
  cells: Record<Direction, SheetCell>;
  /** Directions effectivement produites par le modèle. */
  generatedDirections: Direction[];
  /** Avertissements de portée générale, non bloquants. */
  notices: string[];
}

/**
 * Construit les quatre vues normalisées.
 *
 * @throws {CharacterCellError} si le maître est inexploitable ou si une
 *         cellule attendue est vide — l'utilisateur doit pouvoir refuser la
 *         planche en connaissance de cause plutôt que recevoir un trou.
 */
export function buildCharacterSheet(options: BuildSheetOptions): CharacterSheetResult {
  const cellSize = options.cellSize ?? CHARACTER_SHEET.CELL_SIZE;
  const geometry = deriveGeometryFromMaster(options.master, cellSize);
  const notices: string[] = [];

  if (!geometry.matchesStandardFeetLine) {
    notices.push(
      `Le sprite maître a ses pieds à Y=${geometry.feetY} au lieu de la ligne standard Y=${CHARACTER_SHEET.TARGET.FEET_Y}. Les autres vues ont été alignées sur le maître, qui reste la référence.`,
    );
  }

  const matchPalette = options.matchMasterPalette ?? CHARACTER_SHEET.MATCH_MASTER_PALETTE;
  const masterPalette = matchPalette ? masterPaletteOf(options.master) : null;

  const generated = sliceSheet(options.generatedSheet, cellSize);
  const useMirror = !options.generateRightSeparately;

  /*
   * Quel profil est déduit de l'autre ?
   *
   * Normalement le droit découle du gauche. Mais si le MAÎTRE est le profil
   * droit, c'est le gauche qui doit en découler : le miroir du maître est
   * exact au pixel près, là où une vue générée ne le serait pas. Dans les deux
   * cas la source du miroir est celle des deux vues qu'on tient pour sûre.
   */
  const mirrorTarget: Direction | null = useMirror
    ? options.masterDirection === "right"
      ? "left"
      : "right"
    : null;
  const mirrorSource: Direction = mirrorTarget === "left" ? "right" : "left";

  const cells = {} as Record<Direction, SheetCell>;
  const generatedDirections: Direction[] = [];

  for (const direction of DIRECTIONS) {
    // 1. La direction du maître reprend le maître, sans retouche.
    if (direction === options.masterDirection) {
      cells[direction] = {
        direction,
        image: options.master,
        origin: "maître",
        alignment: null,
        validation: validateCell(direction, options.master, geometry),
      };
      continue;
    }

    // 2. Le profil déduit n'est pas généré : il attend son miroir.
    if (direction === mirrorTarget) continue;

    try {
      const aligned = alignCell(generated[direction], geometry, {
        masterPalette,
      });
      generatedDirections.push(direction);
      cells[direction] = {
        direction,
        image: aligned.image,
        origin: "générée",
        alignment: aligned.report,
        validation: validateCell(direction, aligned.image, geometry),
      };
    } catch (error) {
      throw new CharacterCellError(
        `Direction « ${direction} » : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 3. Miroir, une fois la vue source arrêtée.
  if (mirrorTarget !== null) {
    const source = cells[mirrorSource];
    if (source === undefined) {
      throw new CharacterCellError(
        `Le profil ${mirrorSource === "left" ? "gauche" : "droit"} est manquant : impossible d'en déduire l'autre par miroir.`,
      );
    }
    const mirrored = mirrorHorizontally(source.image);
    cells[mirrorTarget] = {
      direction: mirrorTarget,
      image: mirrored,
      origin: "miroir",
      alignment: null,
      validation: validateCell(mirrorTarget, mirrored, geometry),
    };
  }

  const missing = DIRECTIONS.filter((direction) => cells[direction] === undefined);
  if (missing.length > 0) {
    throw new CharacterCellError(
      `Planche incomplète : direction(s) manquante(s) ${missing.join(", ")}.`,
    );
  }

  return { geometry, cells, generatedDirections, notices };
}

export interface PrepareMasterOptions {
  /**
   * Impose une transparence binaire au maître. `false` par défaut, et c'est
   * volontaire : le maître doit ressortir strictement identique, pixel pour
   * pixel. Un maître à transparence partielle est donc SIGNALÉ, jamais corrigé
   * en douce — l'utilisateur voit sa cellule passer au rouge et décide.
   */
  binarise?: boolean;
}

export interface PreparedMaster {
  image: RgbaImage;
  /** Pixels ni totalement opaques ni totalement transparents dans le maître. */
  semiTransparentPixels: number;
  /** Pixels réellement modifiés. Toujours 0 sans `binarise`. */
  adjustedPixels: number;
}

/**
 * Vérifie un sprite maître importé.
 *
 * Par défaut, RIEN n'est modifié : le maître est la référence de la planche et
 * son export doit rester identique au pixel près. La transparence partielle
 * est comptée pour pouvoir être signalée.
 *
 * @throws {CharacterCellError} si les dimensions ne sont pas celles d'une cellule.
 */
export function prepareMaster(
  master: RgbaImage,
  cellSize: number = CHARACTER_SHEET.CELL_SIZE,
  options: PrepareMasterOptions = {},
): PreparedMaster {
  if (master.width !== cellSize || master.height !== cellSize) {
    throw new CharacterCellError(
      `Le sprite maître fait ${master.width} × ${master.height} px, or une cellule fait ${cellSize} × ${cellSize} px.`,
    );
  }

  let semiTransparentPixels = 0;
  for (let offset = 3; offset < master.data.length; offset += 4) {
    const alpha = master.data[offset];
    if (alpha !== 0 && alpha !== 255) semiTransparentPixels += 1;
  }

  if (options.binarise !== true) {
    return { image: master, semiTransparentPixels, adjustedPixels: 0 };
  }

  const binarised = binariseAlpha(master);
  return {
    image: binarised.image,
    semiTransparentPixels,
    adjustedPixels: binarised.changedPixels,
  };
}
