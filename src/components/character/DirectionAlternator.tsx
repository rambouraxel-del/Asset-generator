"use client";

import { useEffect, useState } from "react";

import { PREVIEW_ZOOM_FACTOR } from "@/lib/config";
import { DIRECTION_LABELS, type Direction } from "@/lib/character/sheetLayout";
import { Button } from "@/components/ui/Button";
import { Field, selectClasses } from "@/components/ui/Field";

/**
 * Comparaison de deux directions par alternance.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI ALTERNER PLUTÔT QUE JUXTAPOSER
 * ---------------------------------------------------------------------------
 * Côte à côte, un écart de deux pixels de hauteur ou une ligne de pieds
 * décalée passent inaperçus. Superposées et alternées au même endroit, les
 * mêmes différences sautent aux yeux : le personnage « saute », exactement
 * comme il le ferait en jeu au changement de direction. C'est le contrôle le
 * plus fiable, et il ne coûte rien.
 * ---------------------------------------------------------------------------
 */
export function DirectionAlternator({
  previews,
  cellSize,
  directions,
  intervalMs = 600,
}: {
  previews: Record<string, string>;
  cellSize: number;
  directions: readonly Direction[];
  intervalMs?: number;
}) {
  const [first, setFirst] = useState<Direction>(directions[0]);
  const [second, setSecond] = useState<Direction>(directions[1] ?? directions[0]);
  const [playing, setPlaying] = useState(false);
  const [showingFirst, setShowingFirst] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(
      () => setShowingFirst((current) => !current),
      intervalMs,
    );
    return () => window.clearInterval(timer);
  }, [playing, intervalMs]);

  const shown = showingFirst ? first : second;
  const source = previews[shown];
  const size = cellSize * PREVIEW_ZOOM_FACTOR;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vue A">
          <select
            value={first}
            onChange={(event) => setFirst(event.target.value as Direction)}
            className={selectClasses()}
            aria-label="Première vue à comparer"
          >
            {directions.map((direction) => (
              <option key={direction} value={direction}>
                {DIRECTION_LABELS[direction]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vue B">
          <select
            value={second}
            onChange={(event) => setSecond(event.target.value as Direction)}
            className={selectClasses()}
            aria-label="Seconde vue à comparer"
          >
            {directions.map((direction) => (
              <option key={direction} value={direction}>
                {DIRECTION_LABELS[direction]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div
        className="checkerboard flex items-center justify-center overflow-auto rounded-xl border border-border p-3"
        data-testid="alternator"
      >
        {source ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={source}
            alt={`Comparaison — ${DIRECTION_LABELS[shown]}`}
            width={size}
            height={size}
            // `maxWidth: none` : sans lui la préflight Tailwind écrase la
            // largeur sans toucher la hauteur, et la comparaison mentirait.
            style={{ width: size, height: size, maxWidth: "none", flexShrink: 0 }}
            className="[image-rendering:pixelated]"
          />
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted" role="status">
          Affiché : {DIRECTION_LABELS[shown]}
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => setShowingFirst((current) => !current)}
            disabled={playing}
          >
            Basculer
          </Button>
          <Button variant={playing ? "secondary" : "primary"} onClick={() => setPlaying((on) => !on)}>
            {playing ? "Arrêter l'alternance" : "Alterner automatiquement"}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted">
        Si le personnage « saute » entre les deux vues, c&apos;est que la taille ou la ligne
        de pieds diffère : refusez la planche et régénérez-la.
      </p>
    </div>
  );
}
