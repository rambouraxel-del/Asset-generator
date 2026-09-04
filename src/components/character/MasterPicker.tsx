"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { CHARACTER_SHEET } from "@/lib/config";
import { AppError, userMessageFor } from "@/lib/errors";
import { readMasterSprite, type MasterSprite } from "@/lib/client/masterSprite";
import { DIRECTIONS, DIRECTION_LABELS, type Direction } from "@/lib/character/sheetLayout";
import type { useLibrary } from "@/hooks/useLibrary";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field, selectClasses } from "@/components/ui/Field";

/**
 * Choix du sprite maître : import d'un PNG ou reprise d'un asset de la
 * bibliothèque.
 *
 * ---------------------------------------------------------------------------
 * CHOISIR DANS LA BIBLIOTHÈQUE RESTE UN ACTE EXPLICITE
 * ---------------------------------------------------------------------------
 * La bibliothèque n'est jamais parcourue automatiquement et son contenu n'est
 * jamais transmis en bloc. Seul l'asset que l'utilisateur désigne ici part avec
 * la requête, dans un champ dédié — il ne devient pas pour autant une référence
 * de style et ne sera pas rejoué lors des générations suivantes.
 * ---------------------------------------------------------------------------
 */
export function MasterPicker({
  master,
  onMasterChange,
  masterDirection,
  onDirectionChange,
  library,
  disabled,
}: {
  master: MasterSprite | null;
  onMasterChange: (master: MasterSprite | null) => void;
  masterDirection: Direction;
  onDirectionChange: (direction: Direction) => void;
  library: ReturnType<typeof useLibrary>;
  disabled: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /*
   * L'aperçu est DÉRIVÉ du maître, jamais stocké à côté. Le maître survit au
   * démontage de ce composant (il vit dans le hook) : une URL mémorisée ici
   * serait révoquée au démontage et l'aperçu reviendrait cassé.
   */
  const previewUrl = useMemo(
    () => (master === null ? null : URL.createObjectURL(master.blob)),
    [master],
  );
  useEffect(
    () => () => {
      if (previewUrl !== null) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const cellSize = CHARACTER_SHEET.CELL_SIZE;

  // Seuls les assets aux dimensions d'une cellule peuvent servir de maître.
  const eligible = library.assets.filter(
    (asset) => asset.finalWidth === cellSize && asset.finalHeight === cellSize,
  );

  async function adopt(blob: Blob, name: string, source: MasterSprite["source"]) {
    setError(null);
    try {
      onMasterChange(await readMasterSprite(blob, name, source, cellSize));
    } catch (cause) {
      onMasterChange(null);
      setError(cause instanceof AppError ? cause.message : userMessageFor("UNKNOWN"));
    }
  }

  function clear() {
    setError(null);
    onMasterChange(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Sprite maître"
        hint={`PNG de ${cellSize} × ${cellSize} px exactement. Il sera livré tel quel, sans retouche.`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void adopt(file, file.name, "import");
          }}
          className="min-h-11 w-full rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm"
          aria-label="Importer le sprite maître"
        />
      </Field>

      {eligible.length > 0 ? (
        <Field
          label="…ou reprendre un asset de la bibliothèque"
          hint={`${eligible.length} asset${eligible.length > 1 ? "s" : ""} de ${cellSize} × ${cellSize} px disponible${eligible.length > 1 ? "s" : ""}.`}
        >
          <select
            value=""
            disabled={disabled}
            onChange={(event) => {
              const asset = eligible.find((entry) => entry.id === event.target.value);
              if (asset) void adopt(asset.blob, `${asset.name}.png`, "bibliothèque");
              event.target.value = "";
            }}
            className={selectClasses()}
            aria-label="Choisir un maître dans la bibliothèque"
          >
            <option value="">Choisir un asset…</option>
            {eligible.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}

      {master !== null && previewUrl !== null ? (
        <div className="flex items-center gap-3 rounded-xl border border-border p-3">
          <div className="checkerboard shrink-0 rounded-lg border border-border p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Sprite maître"
              width={master.width * 2}
              height={master.height * 2}
              style={{ width: master.width * 2, height: master.height * 2, maxWidth: "none" }}
              className="[image-rendering:pixelated]"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{master.name}</p>
            <p className="text-xs text-muted">
              {master.width} × {master.height} px · {master.source}
            </p>
          </div>
          <Button variant="ghost" onClick={clear} disabled={disabled}>
            Retirer
          </Button>
        </div>
      ) : null}

      <Field
        label="Ce maître représente…"
        hint="La vue correspondante reprend le maître à l'identique ; les autres sont générées."
      >
        <select
          value={masterDirection}
          disabled={disabled}
          onChange={(event) => onDirectionChange(event.target.value as Direction)}
          className={selectClasses()}
          aria-label="Orientation du sprite maître"
        >
          {DIRECTIONS.map((direction) => (
            <option key={direction} value={direction}>
              {DIRECTION_LABELS[direction]}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
