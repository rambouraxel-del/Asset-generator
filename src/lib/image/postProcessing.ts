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
 *   4. réduction au plus proche voisin, sans le moindre lissage ;
 *   5. dépôt sur un canvas transparent aux dimensions exactes ;
 *   6. ré-encodage PNG.
 *
 * Aucun appel réseau, aucun second passage par un modèle : ce traitement ne
 * consomme pas un seul jeton.
 * ---------------------------------------------------------------------------
 */

import { PNG } from "pngjs";

import {
  composeOnCanvas,
  cropImage,
  createTransparentImage,
  fitWithin,
  findVisibleBounds,
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

  // Image entièrement transparente : on livre un canvas vide plutôt que de
  // faire échouer la génération, et on le signale dans le compte rendu.
  if (bounds === null) {
    return {
      buffer: encodePng(createTransparentImage(finalWidth, finalHeight)),
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
      },
    };
  }

  const trimmed =
    bounds.width !== decoded.width || bounds.height !== decoded.height;

  const cropped = trimmed ? cropImage(decoded, bounds) : decoded;

  const fitted = fitWithin(cropped.width, cropped.height, finalWidth, finalHeight);
  const scaled = resizeNearestNeighbour(cropped, fitted.width, fitted.height);
  const composed = composeOnCanvas(
    scaled,
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
