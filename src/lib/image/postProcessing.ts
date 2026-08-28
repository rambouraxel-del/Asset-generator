/**
 * Post-traitement local d'un asset généré.
 *
 * ---------------------------------------------------------------------------
 * LE CŒUR DE LA V0.2.1
 * ---------------------------------------------------------------------------
 * GPT-Image-2 ne sait pas produire une image de 16 × 16 px. On génère donc plus
 * grand, puis on ramène le résultat à la taille finale exacte ICI, en local :
 *
 *   1. décodage du PNG renvoyé par l'API ;
 *   2. détection des marges transparentes ;
 *   3. recadrage sur l'asset seul ;
 *   4. réduction à la taille de l'asset ;
 *   5. NETTOYAGE PIXEL — alpha, palette, pixels isolés (V0.2.2) ;
 *   6. dépôt sur un canvas transparent aux dimensions exactes ;
 *   7. mesure de la qualité pixel-art obtenue ;
 *   8. ré-encodage PNG.
 *
 * L'étape 5 est ce qui distingue un vrai sprite d'un simple fichier à la bonne
 * dimension : sans elle, la sortie garde les centaines de teintes et les bords
 * anti-aliasés de l'illustration d'origine.
 *
 * Aucun appel réseau, aucun second passage par un modèle : ce traitement ne
 * consomme pas un seul jeton.
 * ---------------------------------------------------------------------------
 */

import { PNG } from "pngjs";

import { LOGICAL_GRID, PIXEL_CLEANUP } from "@/lib/config";
import {
  downscaleLogicalGrid,
  type BlockCoherenceStats,
  type BlockMethod,
} from "@/lib/image/logicalGrid";
import {
  applyPixelCleanup,
  defaultCleanupOptions,
  type PixelCleanupOptions,
  type PixelCleanupReport,
} from "@/lib/image/pixelCleanup";
import { analysePixels, type PixelMetrics } from "@/lib/image/pixelMetrics";
import {
  composeOnCanvas,
  cropImage,
  createTransparentImage,
  fitWithin,
  findVisibleBounds,
  resizeAreaAverage,
  resizeNearestNeighbour,
  type Anchor,
  type Bounds,
  type RgbaImage,
} from "@/lib/image/pixels";

export interface PostProcessOptions {
  /** Dimensions exactes du PNG livré. */
  finalWidth: number;
  finalHeight: number;
  /** Placement de l'asset dans le canvas final. */
  anchor?: Anchor;
  /**
   * Alpha en dessous duquel un pixel est considéré comme vide lors du
   * recadrage. 0 par défaut : seuls les pixels totalement transparents sont
   * rognés, ce qui ne mange jamais un contour translucide.
   */
  alphaThreshold?: number;
  /**
   * Méthode de réduction. `area` par défaut (voir `PIXEL_CLEANUP`) ;
   * `nearest` conserve le comportement strict de la V0.2.1.
   */
  downscaleMethod?: "area" | "nearest";
  /** Réglages du nettoyage pixel. `null` désactive complètement la chaîne. */
  cleanup?: PixelCleanupOptions | null;

  /* ---- Grille logique (V0.2.3) ---------------------------------------- */

  /**
   * Pipeline demandé. `grid` lit l'image bloc par bloc sur une grille logique ;
   * `classic` reprend la chaîne V0.2.2. Le mode `grid` retombe automatiquement
   * sur `classic` si les conditions de grille ne sont pas réunies.
   */
  pipeline?: PixelPipeline;
  /** Méthode de lecture d'un bloc vers un pixel. */
  blockMethod?: BlockMethod;
  /** Recentre le sprite final par translation entière. */
  recentre?: boolean;
}

export type PixelPipeline = "grid" | "classic";

/** Raison pour laquelle le mode grille n'a pas pu s'appliquer. */
export type FallbackReason =
  | "pipeline-classique"
  | "grille-non-entiere"
  | "dimensions-inattendues"
  /** La grille a produit un sprite vide : asset plus petit qu'un bloc. */
  | "sprite-vide-en-grille";

/** Compte rendu du traitement, remonté à l'interface et à la bibliothèque. */
export interface PostProcessReport {
  sourceWidth: number;
  sourceHeight: number;
  /** `true` si l'image comportait au moins un pixel non opaque. */
  hasTransparency: boolean;
  /** Rectangle utile détecté, ou `null` si l'image était entièrement vide. */
  trimmedBounds: Bounds | null;
  /** `true` si des marges transparentes ont effectivement été retirées. */
  trimmed: boolean;
  /** Dimensions de l'asset après réduction, avant dépôt sur le canvas. */
  scaledWidth: number;
  scaledHeight: number;
  finalWidth: number;
  finalHeight: number;
  /** Facteur de réduction appliqué à l'asset recadré. */
  scale: number;
  /** `true` si le PNG reçu ne contenait aucun pixel visible. */
  empty: boolean;
  /** Méthode de réduction réellement employée. */
  downscaleMethod: "area" | "nearest";
  /** Compte rendu du nettoyage pixel, `null` si la chaîne est désactivée. */
  cleanup: PixelCleanupReport | null;
  /** Mesures de qualité pixel-art du sprite livré. */
  metrics: PixelMetrics;

  /* ---- Grille logique (V0.2.3) ---------------------------------------- */

  /** Pipeline réellement appliqué. */
  pipeline: PixelPipeline;
  /** Pourquoi le mode grille n'a pas été appliqué, `null` s'il l'a été. */
  fallbackReason: FallbackReason | null;
  /** Détail de la grille logique, `null` en pipeline classique. */
  grid: {
    scaleX: number;
    scaleY: number;
    method: BlockMethod;
    stats: BlockCoherenceStats;
  } | null;
}

export interface PostProcessResult {
  /** PNG final, exactement aux dimensions demandées. */
  buffer: Buffer;
  report: PostProcessReport;
}

/**
 * Ramène un PNG généré à la taille finale exacte demandée.
 *
 * L'asset est toujours entièrement visible : le facteur de réduction est le
 * plus petit des deux rapports, donc rien n'est jamais coupé, et les
 * proportions de l'objet sont conservées.
 */
export function postProcessToFinalSize(
  pngBuffer: Buffer,
  options: PostProcessOptions,
): PostProcessResult {
  const { finalWidth, finalHeight } = options;

  if (!Number.isInteger(finalWidth) || !Number.isInteger(finalHeight)) {
    throw new Error("Les dimensions finales doivent être des entiers.");
  }
  if (finalWidth <= 0 || finalHeight <= 0) {
    throw new Error("Les dimensions finales doivent être strictement positives.");
  }

  const decoded = decodePng(pngBuffer);
  const hasTransparency = containsTransparency(decoded);
  const bounds = findVisibleBounds(decoded, options.alphaThreshold ?? 0);

  const method = options.downscaleMethod ?? PIXEL_CLEANUP.DOWNSCALE_METHOD;
  const requestedPipeline = options.pipeline ?? "grid";

  // Image entièrement transparente : on livre un canvas vide plutôt que de
  // faire échouer la génération, et on le signale dans le compte rendu.
  if (bounds === null) {
    const empty = createTransparentImage(finalWidth, finalHeight);
    return {
      buffer: encodePng(empty),
      report: {
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
        hasTransparency,
        trimmedBounds: null,
        trimmed: false,
        scaledWidth: 0,
        scaledHeight: 0,
        finalWidth,
        finalHeight,
        scale: 0,
        empty: true,
        downscaleMethod: method,
        cleanup: null,
        metrics: analysePixels(empty),
        pipeline: "classic",
        fallbackReason: "dimensions-inattendues",
        grid: null,
      },
    };
  }

  /*
   * Mode grille : la source doit valoir exactement finalWidth × k et
   * finalHeight × k, avec k entier et identique sur les deux axes. C'est la
   * résolution choisie par `chooseGenerationSize` quand `logicalGridReady` est
   * vrai. Aucun recadrage préalable : il décalerait toutes les bornes de bloc.
   */
  const gridEligibility = evaluateGridEligibility(
    decoded,
    finalWidth,
    finalHeight,
    requestedPipeline,
  );

  if (gridEligibility.eligible) {
    const gridResult = runGridPipeline(decoded, {
      finalWidth,
      finalHeight,
      hasTransparency,
      bounds,
      blockMethod: options.blockMethod,
      cleanupOptions:
        options.cleanup === undefined
          ? defaultCleanupOptions({ width: finalWidth, height: finalHeight })
          : options.cleanup,
      recentre: options.recentre ?? LOGICAL_GRID.RECENTRE_FINAL,
      anchor: options.anchor ?? "center",
    });

    /*
     * Filet de sécurité : un asset plus petit qu'un bloc se dilue dans la
     * moyenne d'alpha et disparaît complètement. Mesuré : un motif de 2 × 2
     * pixels dans une source de 816 × 816 ramenée en 16 × 16 (blocs de 51 × 51)
     * donne un sprite entièrement vide. Le pipeline classique, lui, détoure
     * puis agrandit et le conserve. On repasse donc en classique plutôt que de
     * livrer un fichier vide.
     */
    if (gridResult.report.metrics.visiblePixels > 0) {
      return gridResult;
    }
  }

  const trimmed =
    bounds.width !== decoded.width || bounds.height !== decoded.height;

  const cropped = trimmed ? cropImage(decoded, bounds) : decoded;

  const fitted = fitWithin(cropped.width, cropped.height, finalWidth, finalHeight);

  const scaled =
    method === "area"
      ? resizeAreaAverage(cropped, fitted.width, fitted.height)
      : resizeNearestNeighbour(cropped, fitted.width, fitted.height);

  // Nettoyage pixel sur la petite image : c'est là qu'il est pertinent et bon
  // marché, et c'est lui qui supprime les valeurs intermédiaires introduites
  // par la moyenne de zone.
  const cleanupOptions =
    options.cleanup === undefined
      ? defaultCleanupOptions({ width: finalWidth, height: finalHeight })
      : options.cleanup;
  const cleaned =
    cleanupOptions === null
      ? { image: scaled, report: null }
      : applyPixelCleanup(scaled, cleanupOptions);

  // Le dépôt sur le canvas est une simple recopie de pixels : aucune
  // interpolation ne peut s'y glisser.
  const composed = composeOnCanvas(
    cleaned.image,
    finalWidth,
    finalHeight,
    options.anchor ?? "center",
  );

  return {
    buffer: encodePng(composed),
    report: {
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      hasTransparency,
      trimmedBounds: bounds,
      trimmed,
      scaledWidth: fitted.width,
      scaledHeight: fitted.height,
      finalWidth,
      finalHeight,
      scale: fitted.scale,
      empty: false,
      downscaleMethod: method,
      cleanup: cleaned.report,
      metrics: analysePixels(composed),
      pipeline: "classic",
      fallbackReason: gridEligibility.eligible
        ? "sprite-vide-en-grille"
        : gridEligibility.reason,
      grid: null,
    },
  };
}

/**
 * Le mode grille est-il applicable à cette image ?
 *
 * Trois conditions, toutes nécessaires : le pipeline demandé, un facteur
 * entier sur chaque axe, et un facteur identique en X et Y. Sans cela, la
 * lecture bloc par bloc n'aurait pas de sens et on repasse en classique.
 */
function evaluateGridEligibility(
  image: RgbaImage,
  finalWidth: number,
  finalHeight: number,
  pipeline: PixelPipeline,
): { eligible: true; reason: null } | { eligible: false; reason: FallbackReason } {
  if (pipeline === "classic") {
    return { eligible: false, reason: "pipeline-classique" };
  }

  const scaleX = image.width / finalWidth;
  const scaleY = image.height / finalHeight;

  if (!Number.isInteger(scaleX) || !Number.isInteger(scaleY)) {
    return { eligible: false, reason: "grille-non-entiere" };
  }
  if (scaleX !== scaleY) {
    return { eligible: false, reason: "grille-non-entiere" };
  }
  if (scaleX < 1) {
    return { eligible: false, reason: "dimensions-inattendues" };
  }

  return { eligible: true, reason: null };
}

/**
 * Pipeline grille logique.
 *
 * La lecture bloc par bloc produit directement les dimensions finales : ni
 * recadrage, ni mise à l'échelle, ni centrage ne sont nécessaires. Le
 * recentrage éventuel intervient APRÈS, sur le sprite final, par translation
 * entière de pixels déjà calculés — il ne peut donc pas altérer la grille.
 */
function runGridPipeline(
  decoded: RgbaImage,
  input: {
    finalWidth: number;
    finalHeight: number;
    hasTransparency: boolean;
    bounds: Bounds | null;
    blockMethod: BlockMethod | undefined;
    cleanupOptions: PixelCleanupOptions | null;
    recentre: boolean;
    anchor: Anchor;
  },
): PostProcessResult {
  const { finalWidth, finalHeight } = input;

  const grid = downscaleLogicalGrid(decoded, {
    finalWidth,
    finalHeight,
    method: input.blockMethod,
  });

  const cleaned =
    input.cleanupOptions === null
      ? { image: grid.image, report: null }
      : applyPixelCleanup(grid.image, input.cleanupOptions);

  const framed = input.recentre
    ? recentreOnCanvas(cleaned.image, finalWidth, finalHeight, input.anchor)
    : cleaned.image;

  return {
    buffer: encodePng(framed),
    report: {
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      hasTransparency: input.hasTransparency,
      trimmedBounds: input.bounds,
      // La grille ne recadre jamais la source : c'est ce qui préserve l'alignement.
      trimmed: false,
      scaledWidth: finalWidth,
      scaledHeight: finalHeight,
      finalWidth,
      finalHeight,
      scale: 1 / grid.scaleX,
      empty: false,
      downscaleMethod: "area",
      cleanup: cleaned.report,
      metrics: analysePixels(framed),
      pipeline: "grid",
      fallbackReason: null,
      grid: {
        scaleX: grid.scaleX,
        scaleY: grid.scaleY,
        method: grid.method,
        stats: grid.stats,
      },
    },
  };
}

/**
 * Recentre le sprite dans son canvas par translation entière.
 *
 * Opération purement entière sur des pixels déjà calculés : aucun
 * rééchantillonnage, aucune interpolation, et donc aucun effet sur la grille.
 * Sert uniquement à corriger un sprite que le modèle aurait dessiné décentré.
 */
function recentreOnCanvas(
  image: RgbaImage,
  width: number,
  height: number,
  anchor: Anchor,
): RgbaImage {
  const bounds = findVisibleBounds(image);
  if (bounds === null) return image;

  const alreadyCentred =
    bounds.left === Math.floor((width - bounds.width) / 2) &&
    (anchor === "center"
      ? bounds.top === Math.floor((height - bounds.height) / 2)
      : bounds.top + bounds.height === height);
  if (alreadyCentred) return image;

  return composeOnCanvas(cropImage(image, bounds), width, height, anchor);
}

/** Décode un PNG en RGBA. pngjs normalise toujours vers 4 octets par pixel. */
export function decodePng(buffer: Buffer): RgbaImage {
  const png = PNG.sync.read(buffer);
  return {
    width: png.width,
    height: png.height,
    data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length),
  };
}

/** Encode une image RGBA en PNG sans perte. */
export function encodePng(image: RgbaImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length);
  return PNG.sync.write(png);
}

function containsTransparency(image: RgbaImage): boolean {
  for (let index = 3; index < image.data.length; index += 4) {
    if (image.data[index] < 255) return true;
  }
  return false;
}
