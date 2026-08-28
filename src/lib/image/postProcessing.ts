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

import { PIXEL_CLEANUP } from "@/lib/config";
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
}

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
      },
    };
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
    options.cleanup === undefined ? defaultCleanupOptions() : options.cleanup;
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
    },
  };
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
