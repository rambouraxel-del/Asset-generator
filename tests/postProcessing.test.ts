/**
 * Chaîne de post-traitement complète, sur de vrais PNG encodés et décodés.
 *
 * C'est le test qui garantit la promesse produit : « je demande 16 × 16, je
 * reçois un PNG de 16 × 16 exploitable, sans lissage et sans asset coupé ».
 */

import { describe, expect, it } from "vitest";

import {
  decodePng,
  encodePng,
  postProcessToFinalSize,
} from "@/lib/image/postProcessing";
import { createTransparentImage, type RgbaImage } from "@/lib/image/pixels";

/** PNG de test : un disque plein centré, entouré de marges transparentes. */
function renderDisc(
  width: number,
  height: number,
  radiusRatio = 0.25,
  colour: [number, number, number] = [56, 189, 248],
): Buffer {
  const image = createTransparentImage(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * radiusRatio;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      const offset = (y * width + x) * 4;
      image.data[offset] = colour[0];
      image.data[offset + 1] = colour[1];
      image.data[offset + 2] = colour[2];
      image.data[offset + 3] = 255;
    }
  }
  return encodePng(image);
}

/** PNG de test : rectangle plein décalé, pour vérifier le recentrage. */
function renderOffsetRect(
  width: number,
  height: number,
  rect: { left: number; top: number; width: number; height: number },
): Buffer {
  const image = createTransparentImage(width, height);
  for (let y = rect.top; y < rect.top + rect.height; y += 1) {
    for (let x = rect.left; x < rect.left + rect.width; x += 1) {
      const offset = (y * width + x) * 4;
      image.data[offset] = 255;
      image.data[offset + 3] = 255;
    }
  }
  return encodePng(image);
}

function boundsOf(image: RgbaImage) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] > 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

describe("postProcessToFinalSize — dimensions finales exactes", () => {
  const sizes: Array<[number, number]> = [
    [16, 16],
    [32, 32],
    [48, 48],
    [64, 64],
    [64, 96],
    [128, 128],
  ];

  for (const [width, height] of sizes) {
    it(`livre un PNG de ${width} × ${height} px`, () => {
      const source = renderDisc(816, 816);
      const { buffer, report } = postProcessToFinalSize(source, {
        finalWidth: width,
        finalHeight: height,
      });

      const decoded = decodePng(buffer);
      expect(decoded.width).toBe(width);
      expect(decoded.height).toBe(height);
      expect(report.finalWidth).toBe(width);
      expect(report.finalHeight).toBe(height);
      expect(report.empty).toBe(false);
    });
  }

  it("gère une taille finale non multiple de 16", () => {
    const decoded = decodePng(
      postProcessToFinalSize(renderDisc(816, 816), { finalWidth: 24, finalHeight: 24 })
        .buffer,
    );
    expect(decoded.width).toBe(24);
    expect(decoded.height).toBe(24);
  });
});

describe("postProcessToFinalSize — détourage", () => {
  it("supprime les marges transparentes", () => {
    // Disque occupant la moitié du cadre : la moitié est du vide à retirer.
    const { report } = postProcessToFinalSize(renderDisc(800, 800, 0.25), {
      finalWidth: 32,
      finalHeight: 32,
    });

    expect(report.trimmed).toBe(true);
    expect(report.trimmedBounds).not.toBeNull();
    expect(report.trimmedBounds!.width).toBeLessThan(report.sourceWidth);
    // Le disque fait environ la moitié du côté.
    expect(report.trimmedBounds!.width).toBeCloseTo(400, -2);
  });

  it("recentre un asset décalé dans un coin", () => {
    const source = renderOffsetRect(800, 800, {
      left: 20,
      top: 30,
      width: 200,
      height: 200,
    });

    const { buffer } = postProcessToFinalSize(source, {
      finalWidth: 32,
      finalHeight: 32,
    });

    const decoded = decodePng(buffer);
    const bounds = boundsOf(decoded);

    // L'asset carré remplit désormais tout le canvas carré.
    expect(bounds.minX).toBe(0);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxX).toBe(31);
    expect(bounds.maxY).toBe(31);
  });

  it("ne signale aucun détourage sur une image pleine", () => {
    const image = createTransparentImage(64, 64);
    image.data.fill(255);
    const { report } = postProcessToFinalSize(encodePng(image), {
      finalWidth: 16,
      finalHeight: 16,
    });

    expect(report.trimmed).toBe(false);
    expect(report.hasTransparency).toBe(false);
  });
});

describe("postProcessToFinalSize — asset entier et non déformé", () => {
  it("n'ampute jamais l'asset", () => {
    // Rectangle très large ramené dans un carré : il doit tenir en entier.
    const source = renderOffsetRect(1200, 600, {
      left: 0,
      top: 0,
      width: 1200,
      height: 600,
    });

    const { buffer, report } = postProcessToFinalSize(source, {
      finalWidth: 32,
      finalHeight: 32,
    });

    expect(report.scaledWidth).toBeLessThanOrEqual(32);
    expect(report.scaledHeight).toBeLessThanOrEqual(32);

    const decoded = decodePng(buffer);
    const bounds = boundsOf(decoded);
    // Aucun pixel visible ne touche un bord qui indiquerait un débordement.
    expect(bounds.minX).toBeGreaterThanOrEqual(0);
    expect(bounds.maxX).toBeLessThanOrEqual(31);
    expect(bounds.minY).toBeGreaterThan(0);
    expect(bounds.maxY).toBeLessThan(31);
  });

  it("conserve les proportions de l'asset", () => {
    const source = renderOffsetRect(1200, 600, {
      left: 0,
      top: 0,
      width: 1200,
      height: 600,
    });

    const { report } = postProcessToFinalSize(source, {
      finalWidth: 64,
      finalHeight: 64,
    });

    expect(report.scaledWidth / report.scaledHeight).toBeCloseTo(2, 1);
  });

  it("place l'asset au sol avec l'ancrage bas-centre", () => {
    const source = renderOffsetRect(800, 400, {
      left: 0,
      top: 0,
      width: 800,
      height: 400,
    });

    const decoded = decodePng(
      postProcessToFinalSize(source, {
        finalWidth: 32,
        finalHeight: 32,
        anchor: "bottom-center",
      }).buffer,
    );

    expect(boundsOf(decoded).maxY).toBe(31);
  });
});

describe("postProcessToFinalSize — aucun lissage", () => {
  it("n'introduit aucune couleur absente de l'original", () => {
    const source = renderDisc(816, 816, 0.25, [56, 189, 248]);
    const decoded = decodePng(
      postProcessToFinalSize(source, { finalWidth: 16, finalHeight: 16 }).buffer,
    );

    const colours = new Set<string>();
    for (let index = 0; index < decoded.data.length; index += 4) {
      colours.add(Array.from(decoded.data.slice(index, index + 4)).join(","));
    }

    // Uniquement la couleur du disque et le transparent pur.
    expect([...colours].sort()).toEqual(["0,0,0,0", "56,189,248,255"]);
  });

  it("ne produit aucun alpha intermédiaire", () => {
    const decoded = decodePng(
      postProcessToFinalSize(renderDisc(1024, 1024), {
        finalWidth: 16,
        finalHeight: 16,
      }).buffer,
    );

    for (let index = 3; index < decoded.data.length; index += 4) {
      expect([0, 255]).toContain(decoded.data[index]);
    }
  });
});

describe("postProcessToFinalSize — cas limites", () => {
  it("livre un canvas vide si le rendu ne contient aucun pixel visible", () => {
    const empty = encodePng(createTransparentImage(816, 816));
    const { buffer, report } = postProcessToFinalSize(empty, {
      finalWidth: 16,
      finalHeight: 16,
    });

    expect(report.empty).toBe(true);
    const decoded = decodePng(buffer);
    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(16);
    expect(decoded.data.every((value) => value === 0)).toBe(true);
  });

  it("ne fait pas disparaître un asset minuscule", () => {
    const source = renderOffsetRect(816, 816, {
      left: 400,
      top: 400,
      width: 2,
      height: 2,
    });

    const decoded = decodePng(
      postProcessToFinalSize(source, { finalWidth: 16, finalHeight: 16 }).buffer,
    );

    let visible = 0;
    for (let index = 3; index < decoded.data.length; index += 4) {
      if (decoded.data[index] > 0) visible += 1;
    }
    expect(visible).toBeGreaterThan(0);
  });

  it("refuse des dimensions finales invalides", () => {
    const source = renderDisc(816, 816);
    expect(() =>
      postProcessToFinalSize(source, { finalWidth: 0, finalHeight: 16 }),
    ).toThrow();
    expect(() =>
      postProcessToFinalSize(source, { finalWidth: 16.5, finalHeight: 16 }),
    ).toThrow();
  });
});
