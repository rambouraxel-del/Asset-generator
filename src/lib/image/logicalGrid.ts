/**
 * Réduction par grille logique — cœur de la V0.2.3.
 *
 * ---------------------------------------------------------------------------
 * CHANGEMENT DE PHILOSOPHIE
 * ---------------------------------------------------------------------------
 * Jusqu'ici on laissait le modèle dessiner librement en haute résolution, puis
 * on rattrapait le tir par un rééchantillonnage qui devait deviner. La grille
 * logique inverse la logique : le prompt demande au modèle de composer un
 * sprite de N × M pixels dont chaque pixel est un BLOC uniforme dans l'image
 * générée, et la réduction devient une simple lecture bloc par bloc.
 *
 *   sprite logique 64 × 64
 *      ↓ (le modèle agrandit chaque pixel en bloc de 13 × 13)
 *   image générée 832 × 832
 *      ↓ (lecture bloc par bloc, ici)
 *   sprite final 64 × 64
 *
 * ---------------------------------------------------------------------------
 * GARANTIE D'ÉTANCHÉITÉ DES BLOCS
 * ---------------------------------------------------------------------------
 * Les bornes de bloc sont calculées par division exacte : le bloc de sortie
 * (x, y) lit strictement la zone [x·sx, (x+1)·sx) × [y·sy, (y+1)·sy). Les
 * blocs pavent la source sans se chevaucher ni laisser de trou. Un pixel
 * source ne peut donc JAMAIS influencer un pixel final voisin — propriété
 * vérifiée par test.
 *
 * ---------------------------------------------------------------------------
 * ALIGNEMENT : AUCUN RECADRAGE AVANT LA GRILLE
 * ---------------------------------------------------------------------------
 * Un recadrage sur le contenu utile décalerait toutes les bornes de bloc et
 * détruirait la grille. En mode grille, la source est donc lue TELLE QUELLE :
 * comme la résolution a été choisie pour valoir exactement finalWidth × k, la
 * lecture bloc par bloc produit directement les dimensions finales, sans crop,
 * sans mise à l'échelle, sans centrage. Le recentrage éventuel a lieu APRÈS,
 * au niveau du sprite final, par translation entière de pixels déjà calculés :
 * il ne peut donc pas altérer la grille.
 * ---------------------------------------------------------------------------
 */

import { LOGICAL_GRID } from "@/lib/config";
import { createTransparentImage, type RgbaImage } from "@/lib/image/pixels";

/** Méthode de réduction d'un bloc vers un pixel unique. */
export type BlockMethod = "dominant" | "premultipliedMean" | "median";

export interface LogicalGridOptions {
  finalWidth: number;
  finalHeight: number;
  method?: BlockMethod;
}

export interface BlockCoherenceStats {
  /** Blocs de la grille, soit finalWidth × finalHeight. */
  totalBlocks: number;
  /** Blocs contenant au moins un pixel visible. */
  nonEmptyBlocks: number;
  /** Blocs suffisamment homogènes pour être considérés comme un pixel logique. */
  coherentBlocks: number;
  /**
   * Part de blocs cohérents parmi les blocs non vides, entre 0 et 1.
   * C'est la mesure du respect réel de la consigne de grille par le modèle.
   */
  fidelity: number;
  /** Écart moyen de couleur à l'intérieur d'un bloc, sur 255. */
  meanDeviation: number;
  /** Contraste moyen entre blocs voisins, sur 255. */
  meanNeighbourContrast: number;
}

export interface LogicalGridResult {
  image: RgbaImage;
  scaleX: number;
  scaleY: number;
  method: BlockMethod;
  stats: BlockCoherenceStats;
}

/**
 * Réduit une image en lisant un pixel final par bloc source.
 *
 * @param image        Image générée, idéalement de finalWidth·k × finalHeight·k.
 * @param options      Dimensions finales et méthode de lecture de bloc.
 */
export function downscaleLogicalGrid(
  image: RgbaImage,
  options: LogicalGridOptions,
): LogicalGridResult {
  const { finalWidth, finalHeight } = options;
  const method = options.method ?? LOGICAL_GRID.BLOCK_METHOD;

  if (finalWidth <= 0 || finalHeight <= 0) {
    throw new Error("Les dimensions finales doivent être strictement positives.");
  }

  const scaleX = image.width / finalWidth;
  const scaleY = image.height / finalHeight;
  const result = createTransparentImage(finalWidth, finalHeight);

  /*
   * Deux passes sont nécessaires : la cohérence d'un bloc se juge par rapport
   * au contraste avec ses voisins, qu'on ne connaît qu'une fois toutes les
   * moyennes calculées.
   */
  const blocks: Array<BlockSample | null> = new Array(finalWidth * finalHeight).fill(null);

  for (let y = 0; y < finalHeight; y += 1) {
    // Bornes exactes : le bloc suivant reprend là où celui-ci s'arrête.
    const top = Math.floor(y * scaleY);
    const bottom = Math.max(top + 1, Math.floor((y + 1) * scaleY));

    for (let x = 0; x < finalWidth; x += 1) {
      const left = Math.floor(x * scaleX);
      const right = Math.max(left + 1, Math.floor((x + 1) * scaleX));

      const block = readBlock(image, left, top, right, bottom);
      blocks[y * finalWidth + x] = block;
      if (block.visibleCount === 0) continue;

      const colour = resolveBlockColour(block, method);
      const offset = (y * finalWidth + x) * 4;
      result.data[offset] = colour.r;
      result.data[offset + 1] = colour.g;
      result.data[offset + 2] = colour.b;
      result.data[offset + 3] = colour.a;
    }
  }

  const stats = measureCoherence(blocks, finalWidth, finalHeight);

  return {
    image: result,
    scaleX,
    scaleY,
    method,
    stats,
  };
}

/**
 * Juge chaque bloc et agrège la fidélité de grille.
 *
 * Un bloc est cohérent si son écart interne reste sous la tolérance absolue
 * ET s'il est plat DEVANT le contraste qui le sépare de ses voisins. Un aplat
 * entouré d'aplats identiques (contraste nul) reste cohérent grâce au plancher
 * `FLAT_EPSILON` : une grande zone unie est du pixel art parfaitement valide.
 */
function measureCoherence(
  blocks: Array<BlockSample | null>,
  width: number,
  height: number,
): BlockCoherenceStats {
  const tolerance = LOGICAL_GRID.BLOCK_COHERENCE;

  let nonEmptyBlocks = 0;
  let coherentBlocks = 0;
  let deviationSum = 0;
  let contrastSum = 0;
  let contrastCount = 0;

  const meanAt = (x: number, y: number): BlockSample | null => {
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const block = blocks[y * width + x];
    return block !== null && block.visibleCount > 0 ? block : null;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const block = meanAt(x, y);
      if (block === null) continue;

      nonEmptyBlocks += 1;
      deviationSum += block.deviation;

      let contrast = 0;
      let neighbours = 0;
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const neighbour = meanAt(x + dx, y + dy);
        if (neighbour === null) continue;
        contrast +=
          (Math.abs(block.meanR - neighbour.meanR) +
            Math.abs(block.meanG - neighbour.meanG) +
            Math.abs(block.meanB - neighbour.meanB)) /
          3;
        neighbours += 1;
      }

      const meanContrast = neighbours === 0 ? 0 : contrast / neighbours;
      contrastSum += meanContrast;
      contrastCount += 1;

      const allowed = Math.max(
        tolerance.FLAT_EPSILON,
        meanContrast * tolerance.RELATIVE_FACTOR,
      );
      if (block.deviation <= tolerance.ABSOLUTE_TOLERANCE && block.deviation <= allowed) {
        coherentBlocks += 1;
      }
    }
  }

  return {
    totalBlocks: width * height,
    nonEmptyBlocks,
    coherentBlocks,
    fidelity: nonEmptyBlocks === 0 ? 0 : coherentBlocks / nonEmptyBlocks,
    meanDeviation: nonEmptyBlocks === 0 ? 0 : deviationSum / nonEmptyBlocks,
    meanNeighbourContrast: contrastCount === 0 ? 0 : contrastSum / contrastCount,
  };
}

/** Contenu d'un bloc, réduit aux grandeurs utiles. */
interface BlockSample {
  /** Composantes des pixels visibles uniquement. */
  reds: number[];
  greens: number[];
  blues: number[];
  /** Somme de l'alpha sur TOUS les pixels du bloc (visibles ou non). */
  alphaSum: number;
  totalCount: number;
  visibleCount: number;
  /** Moyenne pondérée par l'alpha (prémultipliée) des pixels visibles. */
  meanR: number;
  meanG: number;
  meanB: number;
  /** Écart moyen absolu à la moyenne, moyenné sur les trois canaux. */
  deviation: number;
  /** Occurrences par seau de couleur, pour la méthode dominante. */
  buckets: Map<number, { count: number; r: number; g: number; b: number }>;
}

/** Taille de seau pour la couleur dominante : 32 niveaux par canal. */
const BUCKET_SHIFT = 3;

function readBlock(
  image: RgbaImage,
  left: number,
  top: number,
  right: number,
  bottom: number,
): BlockSample {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();

  let alphaSum = 0;
  let totalCount = 0;
  let weightedR = 0;
  let weightedG = 0;
  let weightedB = 0;
  let alphaWeight = 0;

  for (let y = top; y < bottom && y < image.height; y += 1) {
    for (let x = left; x < right && x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const alpha = image.data[offset + 3];
      alphaSum += alpha;
      totalCount += 1;
      if (alpha === 0) continue;

      const r = image.data[offset];
      const g = image.data[offset + 1];
      const b = image.data[offset + 2];

      reds.push(r);
      greens.push(g);
      blues.push(b);

      // Pondération par l'alpha : un pixel presque transparent ne doit pas
      // peser autant qu'un pixel plein dans la couleur du bloc.
      weightedR += r * alpha;
      weightedG += g * alpha;
      weightedB += b * alpha;
      alphaWeight += alpha;

      const key =
        ((r >> BUCKET_SHIFT) << 10) | ((g >> BUCKET_SHIFT) << 5) | (b >> BUCKET_SHIFT);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.count += 1;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
      } else {
        buckets.set(key, { count: 1, r, g, b });
      }
    }
  }

  const visibleCount = reds.length;
  const meanR = alphaWeight === 0 ? 0 : weightedR / alphaWeight;
  const meanG = alphaWeight === 0 ? 0 : weightedG / alphaWeight;
  const meanB = alphaWeight === 0 ? 0 : weightedB / alphaWeight;

  let deviation = 0;
  for (let index = 0; index < visibleCount; index += 1) {
    deviation +=
      (Math.abs(reds[index] - meanR) +
        Math.abs(greens[index] - meanG) +
        Math.abs(blues[index] - meanB)) /
      3;
  }

  return {
    reds,
    greens,
    blues,
    alphaSum,
    totalCount,
    visibleCount,
    meanR,
    meanG,
    meanB,
    deviation: visibleCount === 0 ? 0 : deviation / visibleCount,
    buckets,
  };
}

interface BlockColour {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Couleur retenue pour un bloc.
 *
 * L'alpha est toujours la couverture moyenne du bloc : c'est la seule valeur
 * qui a un sens géométrique, et le nettoyage alpha la ramènera ensuite sur un
 * palier franc. Seule la couleur dépend de la méthode.
 */
function resolveBlockColour(block: BlockSample, method: BlockMethod): BlockColour {
  const alpha = Math.round(block.alphaSum / Math.max(1, block.totalCount));

  switch (method) {
    case "premultipliedMean":
      return {
        r: Math.round(block.meanR),
        g: Math.round(block.meanG),
        b: Math.round(block.meanB),
        a: alpha,
      };

    case "median":
      return {
        r: medianOf(block.reds),
        g: medianOf(block.greens),
        b: medianOf(block.blues),
        a: alpha,
      };

    case "dominant": {
      // Le seau le plus peuplé, puis la moyenne exacte de ce seau. Le
      // regroupement évite qu'un dégradé ne donne des occurrences toutes
      // égales à 1, ce qui rendrait la « dominante » arbitraire.
      let best: { count: number; r: number; g: number; b: number } | null = null;
      for (const bucket of block.buckets.values()) {
        if (best === null || bucket.count > best.count) best = bucket;
      }
      if (best === null) {
        return { r: 0, g: 0, b: 0, a: alpha };
      }
      return {
        r: Math.round(best.r / best.count),
        g: Math.round(best.g / best.count),
        b: Math.round(best.b / best.count),
        a: alpha,
      };
    }
  }
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

/** Libellé de fidélité affiché à l'utilisateur. */
export function describeFidelity(fidelity: number): "bonne" | "moyenne" | "faible" {
  if (fidelity >= LOGICAL_GRID.FIDELITY_THRESHOLDS.GOOD) return "bonne";
  if (fidelity >= LOGICAL_GRID.FIDELITY_THRESHOLDS.FAIR) return "moyenne";
  return "faible";
}
