/**
 * Réduction de palette par découpage médian (« median cut »).
 *
 * ---------------------------------------------------------------------------
 * CE QUE CETTE ÉTAPE CORRIGE
 * ---------------------------------------------------------------------------
 * Un sprite issu d'une illustration réduite compte des centaines de couleurs :
 * mesuré sur un rendu lisse ramené en 64 × 64, plus de 1300 couleurs pour
 * 3200 pixels visibles — soit une teinte différente presque tous les deux
 * pixels. L'œil lit cela comme une photo miniature, pas comme un sprite.
 *
 * Le découpage médian construit une palette ADAPTÉE à l'image : on place tous
 * les pixels visibles dans une boîte RVB, on coupe récursivement la boîte la
 * plus étendue en deux moitiés de population égale, et chaque boîte finale
 * donne une couleur (sa moyenne). C'est l'algorithme classique de
 * quantification : déterministe, sans dépendance, et il conserve les teintes
 * dominantes au lieu de les écraser sur une grille fixe.
 *
 * Aucun tramage (dithering) n'est appliqué : le tramage sert à simuler des
 * teintes absentes, ce qui produit exactement le bruit que l'on cherche à
 * supprimer.
 * ---------------------------------------------------------------------------
 */

import { ADAPTIVE_PALETTE } from "@/lib/config";
import type { RgbaImage } from "@/lib/image/pixels";

/**
 * Plafond de couleurs adapté à la taille finale du sprite.
 *
 * Un 16 × 16 n'a qu'environ 200 pixels visibles : lui laisser 32 couleurs
 * produit un rendu inutilement riche — c'est la limite relevée en V0.2.2, où
 * un 16 × 16 ressortait « acceptable » plutôt que « propre ». La table
 * `ADAPTIVE_PALETTE` est interpolée linéairement sur le plus grand côté, et
 * extrapolée en palier au-delà des bornes.
 */
export function maxColoursForFinalSize(width: number, height: number): number {
  const edge = Math.max(width, height);
  const table = ADAPTIVE_PALETTE;

  if (edge <= table[0].edge) return table[0].colours;
  const last = table[table.length - 1];
  if (edge >= last.edge) return last.colours;

  for (let index = 1; index < table.length; index += 1) {
    const previous = table[index - 1];
    const current = table[index];
    if (edge > current.edge) continue;

    const ratio = (edge - previous.edge) / (current.edge - previous.edge);
    return Math.round(previous.colours + ratio * (current.colours - previous.colours));
  }

  return last.colours;
}

export interface QuantizationOptions {
  /** Nombre maximal de couleurs conservées. */
  maxColours: number;
  /**
   * En dessous de ce nombre de couleurs présentes, l'image est déjà propre :
   * la quantification est inutile et ne ferait que dégrader les teintes.
   */
  skipBelowColours: number;
}

export interface QuantizationReport {
  /** Couleurs distinctes avant traitement. */
  coloursBefore: number;
  /** Couleurs distinctes après traitement. */
  coloursAfter: number;
  /** `true` si l'image était déjà assez propre pour être laissée intacte. */
  skipped: boolean;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Réduit la palette des pixels visibles. Les pixels transparents ne
 * participent ni au calcul ni au résultat.
 */
export function quantizePalette(
  image: RgbaImage,
  options: QuantizationOptions,
): { image: RgbaImage; report: QuantizationReport } {
  const pixels: Rgb[] = [];
  const offsets: number[] = [];

  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] === 0) continue;
    pixels.push({
      r: image.data[offset],
      g: image.data[offset + 1],
      b: image.data[offset + 2],
    });
    offsets.push(offset);
  }

  const coloursBefore = countColours(pixels);

  if (pixels.length === 0 || coloursBefore <= Math.max(options.skipBelowColours, options.maxColours)) {
    return {
      image,
      report: { coloursBefore, coloursAfter: coloursBefore, skipped: true },
    };
  }

  const palette = buildPalette(pixels, options.maxColours);
  const data = new Uint8Array(image.data);

  for (let index = 0; index < pixels.length; index += 1) {
    const nearest = nearestColour(pixels[index], palette);
    const offset = offsets[index];
    data[offset] = nearest.r;
    data[offset + 1] = nearest.g;
    data[offset + 2] = nearest.b;
  }

  const result: RgbaImage = { width: image.width, height: image.height, data };

  return {
    image: result,
    report: {
      coloursBefore,
      coloursAfter: countVisibleColours(result),
      skipped: false,
    },
  };
}

/** Construit la palette par découpages médians successifs. */
function buildPalette(pixels: Rgb[], maxColours: number): Rgb[] {
  let boxes: Rgb[][] = [pixels];

  while (boxes.length < maxColours) {
    // On coupe toujours la boîte la plus étendue : c'est elle qui contient les
    // teintes les plus mal représentées par une couleur moyenne unique.
    let targetIndex = -1;
    let largestRange = 0;

    for (let index = 0; index < boxes.length; index += 1) {
      if (boxes[index].length < 2) continue;
      const range = boxRange(boxes[index]);
      if (range.size > largestRange) {
        largestRange = range.size;
        targetIndex = index;
      }
    }

    // Toutes les boîtes sont uniformes : inutile de continuer à découper.
    if (targetIndex === -1 || largestRange === 0) break;

    const box = boxes[targetIndex];
    const { channel } = boxRange(box);
    const sorted = [...box].sort((a, b) => a[channel] - b[channel]);
    const middle = Math.floor(sorted.length / 2);

    boxes = [
      ...boxes.slice(0, targetIndex),
      sorted.slice(0, middle),
      sorted.slice(middle),
      ...boxes.slice(targetIndex + 1),
    ];
  }

  return boxes.filter((box) => box.length > 0).map(averageColour);
}

/** Canal le plus étendu d'une boîte, et l'amplitude correspondante. */
function boxRange(box: Rgb[]): { channel: keyof Rgb; size: number } {
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;

  for (const pixel of box) {
    if (pixel.r < minR) minR = pixel.r;
    if (pixel.r > maxR) maxR = pixel.r;
    if (pixel.g < minG) minG = pixel.g;
    if (pixel.g > maxG) maxG = pixel.g;
    if (pixel.b < minB) minB = pixel.b;
    if (pixel.b > maxB) maxB = pixel.b;
  }

  const rangeR = maxR - minR;
  const rangeG = maxG - minG;
  const rangeB = maxB - minB;

  if (rangeR >= rangeG && rangeR >= rangeB) return { channel: "r", size: rangeR };
  if (rangeG >= rangeB) return { channel: "g", size: rangeG };
  return { channel: "b", size: rangeB };
}

function averageColour(box: Rgb[]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const pixel of box) {
    r += pixel.r;
    g += pixel.g;
    b += pixel.b;
  }
  return {
    r: Math.round(r / box.length),
    g: Math.round(g / box.length),
    b: Math.round(b / box.length),
  };
}

/** Couleur de palette la plus proche, au carré de la distance euclidienne. */
function nearestColour(pixel: Rgb, palette: Rgb[]): Rgb {
  let best = palette[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of palette) {
    const dr = pixel.r - candidate.r;
    const dg = pixel.g - candidate.g;
    const db = pixel.b - candidate.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best;
}

function countColours(pixels: Rgb[]): number {
  const seen = new Set<number>();
  for (const pixel of pixels) seen.add((pixel.r << 16) | (pixel.g << 8) | pixel.b);
  return seen.size;
}

/** Couleurs distinctes parmi les pixels visibles d'une image. */
export function countVisibleColours(image: RgbaImage): number {
  const seen = new Set<number>();
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3] === 0) continue;
    seen.add(
      (image.data[offset] << 16) | (image.data[offset + 1] << 8) | image.data[offset + 2],
    );
  }
  return seen.size;
}
