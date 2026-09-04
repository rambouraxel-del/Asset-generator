"use client";

import { STATUS_LABELS, type CellStatus } from "@/lib/character/sheetValidation";
import type { SheetCellResponse } from "@/types/api";

/**
 * Contrôle de conformité des quatre vues.
 *
 * Les mesures sont affichées telles quelles, sans arrondi flatteur : c'est sur
 * elles que l'utilisateur décide d'accepter ou de refuser la planche.
 *
 *   vert   — hauteur à ±1 px et pieds parfaitement alignés ;
 *   orange — écart de hauteur de 2 px ;
 *   rouge  — écart supérieur à 2 px, pieds décalés, ou alpha partiel.
 */
const STATUS_CLASSES: Record<CellStatus, string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-500",
  error: "border-danger/40 bg-danger-surface text-danger",
};

export function SheetValidationTable({
  cells,
  geometry,
}: {
  cells: SheetCellResponse[];
  geometry: { cellSize: number; centreX: number; feetY: number; visualHeight: number };
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">
        Cible reprise du maître : hauteur {geometry.visualHeight} px, pieds à Y=
        {geometry.feetY}, centre à X={geometry.centreX}.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left text-xs">
          <thead>
            <tr className="text-muted">
              <th scope="col" className="py-1 pr-3 font-medium">Vue</th>
              <th scope="col" className="py-1 pr-3 font-medium">Canevas</th>
              <th scope="col" className="py-1 pr-3 font-medium">Boîte utile</th>
              <th scope="col" className="py-1 pr-3 font-medium">Centre X</th>
              <th scope="col" className="py-1 pr-3 font-medium">Pieds Y</th>
              <th scope="col" className="py-1 pr-3 font-medium">Hauteur</th>
              <th scope="col" className="py-1 pr-3 font-medium">Couleurs</th>
              <th scope="col" className="py-1 pr-3 font-medium">Alpha</th>
              <th scope="col" className="py-1 pr-3 font-medium">Pixels</th>
              <th scope="col" className="py-1 font-medium">État</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((cell) => {
              const metrics = cell.validation.metrics;
              return (
                <tr key={cell.direction} className="border-t border-border align-top">
                  <th scope="row" className="py-2 pr-3 font-medium">
                    {cell.label}
                    <span className="block font-normal text-muted">{cell.origin}</span>
                  </th>
                  <td className="py-2 pr-3">
                    {metrics.canvasWidth} × {metrics.canvasHeight}
                  </td>
                  <td className="py-2 pr-3">
                    {metrics.bounds
                      ? `${metrics.bounds.width} × ${metrics.bounds.height}`
                      : "—"}
                  </td>
                  <td className="py-2 pr-3">{metrics.centreX ?? "—"}</td>
                  <td className="py-2 pr-3">{metrics.feetY ?? "—"}</td>
                  <td className="py-2 pr-3">{metrics.visualHeight ?? "—"}</td>
                  <td className="py-2 pr-3">{metrics.colourCount}</td>
                  <td className="py-2 pr-3">
                    {metrics.alphaLevelCount}
                    {metrics.binaryAlpha ? "" : " ⚠"}
                  </td>
                  <td className="py-2 pr-3">{metrics.visiblePixels}</td>
                  <td className="py-2">
                    <span
                      className={`inline-block rounded-lg border px-2 py-0.5 ${STATUS_CLASSES[cell.validation.status]}`}
                    >
                      {STATUS_LABELS[cell.validation.status]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {cells.some((cell) => cell.validation.issues.length > 0) ? (
        <ul className="flex flex-col gap-1 text-xs text-muted">
          {cells.flatMap((cell) =>
            cell.validation.issues.map((issue) => (
              <li key={`${cell.direction}-${issue}`}>
                <span className="font-medium text-foreground">{cell.label}</span> — {issue}
              </li>
            )),
          )}
        </ul>
      ) : null}
    </div>
  );
}
