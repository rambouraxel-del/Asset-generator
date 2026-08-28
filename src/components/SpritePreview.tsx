"use client";

import { PREVIEW_ZOOM_FACTOR } from "@/lib/config";

/**
 * Double aperçu d'un sprite : taille native et zoom.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI DEUX APERÇUS
 * ---------------------------------------------------------------------------
 * L'aperçu 1:1 montre ce que le jeu affichera réellement. Le zoom, lui, est le
 * seul moyen de juger la qualité pixel-art : si le sprite est propre, on doit y
 * voir des carrés nets ; s'il reste une illustration réduite, le zoom révèle
 * immédiatement les bords flous et les teintes baveuses.
 *
 * `image-rendering: pixelated` est indispensable : sans lui le navigateur
 * interpole en agrandissant, et l'aperçu mentirait sur ce qui a été produit —
 * un sprite parfaitement net paraîtrait flou.
 * ---------------------------------------------------------------------------
 */
export function SpritePreview({
  src,
  alt,
  width,
  height,
  zoom = PREVIEW_ZOOM_FACTOR,
}: {
  src: string;
  alt: string;
  /** Dimensions natives du sprite, `null` pour un rendu brut non post-traité. */
  width: number | null;
  height: number | null;
  zoom?: number;
}) {
  // Sans dimensions connues (rendu brut), un seul aperçu ajusté à la largeur.
  if (width === null || height === null) {
    return (
      <div className="checkerboard flex items-center justify-center rounded-xl border border-border p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="max-h-[55vh] w-auto max-w-full object-contain [image-rendering:pixelated]"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <figure className="flex flex-col gap-1">
        <div
          className="checkerboard flex items-center justify-center overflow-auto rounded-xl border border-border p-3"
          data-testid="preview-zoom"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={`${alt} — agrandi ${zoom} fois`}
            width={width * zoom}
            height={height * zoom}
            /*
             * `maxWidth: none` est indispensable : la préflight Tailwind impose
             * `img { max-width: 100% }`, ce qui écrasait la largeur sans toucher
             * à la hauteur — un sprite carré s'affichait alors en 298 × 512,
             * donc déformé. L'agrandissement reste exactement ×N et c'est le
             * conteneur qui défile sur écran étroit : un aperçu à faire défiler
             * vaut mieux qu'un aperçu qui ment sur les proportions.
             */
            style={{
              width: width * zoom,
              height: height * zoom,
              maxWidth: "none",
              flexShrink: 0,
            }}
            className="[image-rendering:pixelated]"
          />
        </div>
        <figcaption className="text-center text-xs text-muted">
          Aperçu ×{zoom} — chaque carré est un pixel du sprite
        </figcaption>
      </figure>

      <figure className="flex flex-col gap-1">
        <div
          className="checkerboard flex items-center justify-center rounded-xl border border-border p-3"
          data-testid="preview-native"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={`${alt} — taille réelle`}
            width={width}
            height={height}
            style={{ width, height }}
            className="[image-rendering:pixelated]"
          />
        </div>
        <figcaption className="text-center text-xs text-muted">
          Aperçu 1:1 — {width} × {height} px, taille réelle dans le jeu
        </figcaption>
      </figure>
    </div>
  );
}
