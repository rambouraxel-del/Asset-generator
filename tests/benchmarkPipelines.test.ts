/**
 * Comparatif obligatoire — Nettoyage classique contre Grille logique.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE TEST EXISTE
 * ---------------------------------------------------------------------------
 * La grille logique ne doit pas remplacer la chaîne V0.2.2 sur la foi d'une
 * intuition. Ce comparatif mesure les deux pipelines sur trois sources
 * synthétiques couvrant les comportements réels du modèle, et vérifie que la
 * grille apporte vraiment quelque chose LÀ OÙ ELLE EST CENSÉE LE FAIRE, sans
 * régresser ailleurs.
 *
 * Le rapport chiffré est écrit dans `benchmark-pipelines.txt` à la racine, pour
 * pouvoir être relu sans relancer la suite.
 * ---------------------------------------------------------------------------
 */

import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { analysePixels } from "@/lib/image/pixelMetrics";
import { createTransparentImage, type RgbaImage } from "@/lib/image/pixels";
import {
  decodePng,
  encodePng,
  postProcessToFinalSize,
  type PixelPipeline,
} from "@/lib/image/postProcessing";

/* -------------------------------------------------------------------------- */
/* Sources synthétiques                                                       */
/* -------------------------------------------------------------------------- */

function seeded(seed: number): () => number {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
}

/** A — le modèle RESPECTE la grille : blocs parfaitement uniformes. */
function gridRespecting(final: number, scale: number): RgbaImage {
  const size = final * scale;
  const image = createTransparentImage(size, size);
  const random = seeded(1);

  for (let by = 0; by < final; by += 1) {
    for (let bx = 0; bx < final; bx += 1) {
      const inside = Math.hypot(bx - final / 2 + 0.5, by - final / 2 + 0.5) < final * 0.4;
      const r = inside ? Math.floor(random() * 4) * 60 + 20 : 0;
      const g = inside ? Math.floor(random() * 4) * 50 + 30 : 0;
      const b = inside ? Math.floor(random() * 4) * 55 + 25 : 0;
      const a = inside ? 255 : 0;
      for (let y = by * scale; y < (by + 1) * scale; y += 1) {
        for (let x = bx * scale; x < (bx + 1) * scale; x += 1) {
          const offset = (y * size + x) * 4;
          image.data[offset] = r;
          image.data[offset + 1] = g;
          image.data[offset + 2] = b;
          image.data[offset + 3] = a;
        }
      }
    }
  }
  return image;
}

/** B — grille respectée mais texturée : le modèle a ajouté du grain. */
function gridWithTexture(final: number, scale: number, amplitude: number): RgbaImage {
  const image = gridRespecting(final, scale);
  const random = seeded(7);
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3] === 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      image.data[index + channel] = Math.max(
        0,
        Math.min(
          255,
          image.data[index + channel] + Math.round((random() - 0.5) * 2 * amplitude),
        ),
      );
    }
  }
  return image;
}

/** C — le modèle IGNORE la grille : illustration lisse et anti-aliasée. */
function smoothIllustration(size: number): RgbaImage {
  const image = createTransparentImage(size, size);
  const centre = size / 2;
  const radius = size * 0.35;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
      const coverage = Math.max(0, Math.min(1, (radius - distance) / 2));
      if (coverage <= 0) continue;
      const t = distance / radius;
      const offset = (y * size + x) * 4;
      image.data[offset] = Math.round(40 + 150 * (1 - t) + 20 * Math.sin(x / 9));
      image.data[offset + 1] = Math.round(90 + 120 * (1 - t));
      image.data[offset + 2] = Math.round(160 + 80 * t);
      image.data[offset + 3] = Math.round(255 * coverage);
    }
  }
  return image;
}

/* -------------------------------------------------------------------------- */
/* Mesures                                                                    */
/* -------------------------------------------------------------------------- */

interface Measurement {
  colours: number;
  density: number;
  alphaLevels: number;
  semiTransparent: number;
  coverage: number;
  fidelity: number | null;
  pipeline: string;
}

function run(source: RgbaImage, final: number, pipeline: PixelPipeline): Measurement {
  const { buffer, report } = postProcessToFinalSize(encodePng(source), {
    finalWidth: final,
    finalHeight: final,
    pipeline,
  });
  const metrics = analysePixels(decodePng(buffer));
  return {
    colours: metrics.colourCount,
    density: metrics.colourDensity,
    alphaLevels: metrics.alphaLevelCount,
    semiTransparent: metrics.semiTransparentPixels,
    coverage: metrics.coverage,
    fidelity: report.grid?.stats.fidelity ?? null,
    pipeline: report.pipeline,
  };
}

/** Fidélité de silhouette : part de pixels dont la visibilité concorde. */
function silhouetteAgreement(source: RgbaImage, final: number, pipeline: PixelPipeline) {
  const { buffer } = postProcessToFinalSize(encodePng(source), {
    finalWidth: final,
    finalHeight: final,
    pipeline,
  });
  const sprite = decodePng(buffer);

  const scale = source.width / final;
  let agree = 0;

  for (let y = 0; y < final; y += 1) {
    for (let x = 0; x < final; x += 1) {
      // Couverture réelle du bloc source correspondant.
      let visible = 0;
      let total = 0;
      for (let sy = Math.floor(y * scale); sy < Math.floor((y + 1) * scale); sy += 1) {
        for (let sx = Math.floor(x * scale); sx < Math.floor((x + 1) * scale); sx += 1) {
          total += 1;
          if (source.data[(sy * source.width + sx) * 4 + 3] > 127) visible += 1;
        }
      }
      const expected = total > 0 && visible / total > 0.5;
      const actual = sprite.data[(y * final + x) * 4 + 3] > 0;
      if (expected === actual) agree += 1;
    }
  }

  return agree / (final * final);
}

/* -------------------------------------------------------------------------- */
/* Comparatif                                                                 */
/* -------------------------------------------------------------------------- */

const FINAL = 64;
const SCALE = 13; // 64 × 13 = 832, la résolution retenue pour un 64 × 64.

const SOURCES: Array<{ name: string; image: RgbaImage; gridExpected: boolean }> = [
  { name: "A · grille respectée", image: gridRespecting(FINAL, SCALE), gridExpected: true },
  {
    name: "B · grille texturée ±20",
    image: gridWithTexture(FINAL, SCALE, 20),
    gridExpected: true,
  },
  {
    name: "C · illustration lisse",
    image: smoothIllustration(FINAL * SCALE),
    gridExpected: false,
  },
];

describe("Comparatif Classic vs Logical Grid", () => {
  const report: string[] = [
    "COMPARATIF DES PIPELINES — sprite final 64 × 64, source 832 × 832 (×13)",
    "",
  ];

  it("produit un rapport chiffré exploitable", () => {
    for (const source of SOURCES) {
      const classic = run(source.image, FINAL, "classic");
      const grid = run(source.image, FINAL, "grid");

      report.push(source.name);
      report.push(
        `  classic  couleurs ${String(classic.colours).padStart(3)}  densité ${classic.density.toFixed(3)}  alphas ${classic.alphaLevels}  semi-transp ${String(classic.semiTransparent).padStart(3)}  silhouette ${(silhouetteAgreement(source.image, FINAL, "classic") * 100).toFixed(1)}%`,
      );
      report.push(
        `  grid     couleurs ${String(grid.colours).padStart(3)}  densité ${grid.density.toFixed(3)}  alphas ${grid.alphaLevels}  semi-transp ${String(grid.semiTransparent).padStart(3)}  silhouette ${(silhouetteAgreement(source.image, FINAL, "grid") * 100).toFixed(1)}%  fidélité ${grid.fidelity === null ? "—" : `${Math.round(grid.fidelity * 100)}%`}`,
      );
      report.push("");
    }

    writeFileSync("benchmark-pipelines.txt", report.join("\n"));
    expect(report.length).toBeGreaterThan(3);
  });

  it("la grille reproduit fidèlement la silhouette voulue", () => {
    // Sur une source qui respecte la grille, chaque bloc devient exactement le
    // pixel prévu : la silhouette doit être reproduite sans écart.
    for (const source of SOURCES.filter((entry) => entry.gridExpected)) {
      const agreement = silhouetteAgreement(source.image, FINAL, "grid");
      expect(agreement, source.name).toBeGreaterThan(0.99);
    }
  });

  it("la grille fait au moins aussi bien que le classique sur la silhouette", () => {
    for (const source of SOURCES) {
      const classic = silhouetteAgreement(source.image, FINAL, "classic");
      const grid = silhouetteAgreement(source.image, FINAL, "grid");
      // Tolérance d'un pixel sur 64 × 64 pour les arrondis de bord.
      expect(grid, source.name).toBeGreaterThanOrEqual(classic - 1 / (FINAL * FINAL));
    }
  });

  it("la grille détecte le respect ou non de la consigne", () => {
    const respected = run(SOURCES[0].image, FINAL, "grid");
    const ignored = run(SOURCES[2].image, FINAL, "grid");

    expect(respected.fidelity).toBe(1);
    expect(ignored.fidelity).toBeLessThan(0.6);
  });

  it("aucun pipeline ne laisse passer de semi-transparence ni de palette débridée", () => {
    // Le nettoyage V0.2.2 s'applique dans les deux cas : c'est la garantie
    // acquise qu'on ne veut surtout pas perdre.
    for (const source of SOURCES) {
      for (const pipeline of ["classic", "grid"] as const) {
        const measure = run(source.image, FINAL, pipeline);
        expect(measure.semiTransparent, `${source.name} / ${pipeline}`).toBe(0);
        expect(measure.alphaLevels, `${source.name} / ${pipeline}`).toBeLessThanOrEqual(2);
        expect(measure.colours, `${source.name} / ${pipeline}`).toBeLessThanOrEqual(32);
      }
    }
  });

  it("la grille préserve les aplats voulus par le modèle", () => {
    /*
     * Sur une source qui respecte la grille, la couverture doit correspondre à
     * ce que le modèle a dessiné. Le pipeline classique, lui, détoure puis
     * remet à l'échelle : il remplit le canvas et perd la position voulue.
     */
    const grid = run(SOURCES[0].image, FINAL, "grid");
    const classic = run(SOURCES[0].image, FINAL, "classic");

    // Le disque occupe environ 50 % de la grille (rayon 0,4 du côté).
    expect(grid.coverage).toBeGreaterThan(0.4);
    expect(grid.coverage).toBeLessThan(0.6);
    // Le classique agrandit l'asset jusqu'aux bords : couverture plus élevée.
    expect(classic.coverage).toBeGreaterThan(grid.coverage);
  });
});
