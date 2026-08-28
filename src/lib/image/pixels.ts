/**
 * Opérations pixel de base sur des images RGBA.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI DU CODE MAISON PLUTÔT QU'UNE BIBLIOTHÈQUE D'IMAGE
 * ---------------------------------------------------------------------------
 * La contrainte « jamais de lissage, jamais d'anti-aliasing » est le cœur de la
 * V0.2.1. Un redimensionnement écrit ici est vérifiable ligne à ligne : chaque
 * pixel de sortie est la COPIE EXACTE d'un pixel d'entrée, jamais une moyenne.
 * Aucune option d'interpolation ne peut être activée par mégarde lors d'une
 * mise à jour de dépendance.
 *
 * Ce module ne connaît ni PNG ni encodage : il ne manipule que des tampons
 * RGBA. Il est donc utilisable et testable sans le moindre fichier image.
 * ---------------------------------------------------------------------------
 */

/** Image en mémoire : 4 octets par pixel (rouge, vert, bleu, alpha). */
export interface RgbaImage {
  width: number;
  height: number;
  /** Longueur attendue : width × height × 4. */
  data: Uint8Array;
}

/** Rectangle inclusif à gauche/en haut, exclusif à droite/en bas. */
export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Position de l'asset dans le canvas final. */
export type Anchor = "center" | "bottom-center";

export function createTransparentImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/**
 * Rectangle englobant les pixels visibles.
 *
 * `alphaThreshold` est la valeur d'alpha en dessous de laquelle un pixel est
 * considéré comme vide. À 0, seuls les pixels totalement transparents sont
 * ignorés — c'est le réglage conservateur, qui ne rogne jamais un contour
 * légèrement translucide.
 *
 * Renvoie `null` si l'image est entièrement transparente.
 */
export function findVisibleBounds(image: RgbaImage, alphaThreshold = 0): Bounds | null {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < image.height; y += 1) {
    const rowStart = y * image.width * 4;
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.data[rowStart + x * 4 + 3];
      if (alpha > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;

  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Découpe un rectangle. Les zones hors image sont laissées transparentes. */
export function cropImage(image: RgbaImage, bounds: Bounds): RgbaImage {
  const result = createTransparentImage(bounds.width, bounds.height);

  for (let y = 0; y < bounds.height; y += 1) {
    const sourceY = bounds.top + y;
    if (sourceY < 0 || sourceY >= image.height) continue;

    for (let x = 0; x < bounds.width; x += 1) {
      const sourceX = bounds.left + x;
      if (sourceX < 0 || sourceX >= image.width) continue;

      const from = (sourceY * image.width + sourceX) * 4;
      const to = (y * bounds.width + x) * 4;
      result.data[to] = image.data[from];
      result.data[to + 1] = image.data[from + 1];
      result.data[to + 2] = image.data[from + 2];
      result.data[to + 3] = image.data[from + 3];
    }
  }

  return result;
}

/**
 * Redimensionnement au plus proche voisin, avec échantillonnage au centre du
 * pixel de destination.
 *
 * Chaque pixel de sortie reçoit les quatre octets d'UN pixel d'entrée, copiés
 * tels quels. Aucune moyenne, aucun mélange, aucune valeur intermédiaire n'est
 * jamais calculée : le résultat ne peut pas contenir de couleur absente de
 * l'image d'origine. C'est ce qui préserve les aplats du pixel art.
 */
export function resizeNearestNeighbour(
  image: RgbaImage,
  targetWidth: number,
  targetHeight: number,
): RgbaImage {
  if (targetWidth <= 0 || targetHeight <= 0) {
    throw new Error("Les dimensions cibles doivent être strictement positives.");
  }

  const result = createTransparentImage(targetWidth, targetHeight);

  for (let y = 0; y < targetHeight; y += 1) {
    // +0.5 : on échantillonne au centre du pixel de destination, ce qui évite
    // le décalage d'un demi-pixel d'un simple `floor(y * ratio)`.
    const sourceY = Math.min(
      image.height - 1,
      Math.floor(((y + 0.5) * image.height) / targetHeight),
    );

    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(
        image.width - 1,
        Math.floor(((x + 0.5) * image.width) / targetWidth),
      );

      const from = (sourceY * image.width + sourceX) * 4;
      const to = (y * targetWidth + x) * 4;
      result.data[to] = image.data[from];
      result.data[to + 1] = image.data[from + 1];
      result.data[to + 2] = image.data[from + 2];
      result.data[to + 3] = image.data[from + 3];
    }
  }

  return result;
}

/**
 * Dépose l'image sur un canvas transparent aux dimensions exactes demandées.
 *
 * L'ancrage `bottom-center` sert aux objets posés au sol (arbre, personnage,
 * bâtiment) : leur base doit toucher le bas de l'emprise. Il est disponible
 * dans le moteur et testé, mais la V0.2.1 n'expose que `center` dans
 * l'interface, pour ne pas alourdir l'écran de génération.
 */
export function composeOnCanvas(
  image: RgbaImage,
  canvasWidth: number,
  canvasHeight: number,
  anchor: Anchor = "center",
): RgbaImage {
  const canvas = createTransparentImage(canvasWidth, canvasHeight);

  const offsetX = Math.floor((canvasWidth - image.width) / 2);
  const offsetY =
    anchor === "bottom-center"
      ? canvasHeight - image.height
      : Math.floor((canvasHeight - image.height) / 2);

  for (let y = 0; y < image.height; y += 1) {
    const targetY = offsetY + y;
    if (targetY < 0 || targetY >= canvasHeight) continue;

    for (let x = 0; x < image.width; x += 1) {
      const targetX = offsetX + x;
      if (targetX < 0 || targetX >= canvasWidth) continue;

      const from = (y * image.width + x) * 4;
      const to = (targetY * canvasWidth + targetX) * 4;
      canvas.data[to] = image.data[from];
      canvas.data[to + 1] = image.data[from + 1];
      canvas.data[to + 2] = image.data[from + 2];
      canvas.data[to + 3] = image.data[from + 3];
    }
  }

  return canvas;
}

/**
 * Dimensions d'un asset ramené dans une emprise, en conservant ses proportions.
 *
 * Le facteur retenu est le plus petit des deux rapports : l'asset tient donc
 * toujours entièrement dans le canvas, sans jamais être coupé ni déformé.
 * Chaque côté vaut au minimum 1 pixel — un asset ne disparaît jamais.
 */
export function fitWithin(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
): { width: number; height: number; scale: number } {
  const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);

  return {
    width: Math.max(1, Math.min(boxWidth, Math.round(sourceWidth * scale))),
    height: Math.max(1, Math.min(boxHeight, Math.round(sourceHeight * scale))),
    scale,
  };
}
