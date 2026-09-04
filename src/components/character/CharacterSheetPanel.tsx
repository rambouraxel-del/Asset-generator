"use client";

import { useState } from "react";

import { CHARACTER_SHEET, LIMITS } from "@/lib/config";
import { downloadDataUrl } from "@/lib/client/download";
import { buildSheetRequest } from "@/lib/generation/sheetPayload";
import {
  cellAssetName,
  cellFilename,
  sheetFilename,
} from "@/lib/character/sheetExport";
import { DIRECTIONS, type Direction } from "@/lib/character/sheetLayout";
import { STATUS_LABELS } from "@/lib/character/sheetValidation";
import { useAppState } from "@/hooks/useAppState";
import type { useCharacterSheet } from "@/hooks/useCharacterSheet";
import type { useLibrary } from "@/hooks/useLibrary";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field, textInputClasses, textareaClasses } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";
import { SpritePreview } from "@/components/SpritePreview";
import { UsagePanel } from "@/components/UsagePanel";
import { MasterPicker } from "@/components/character/MasterPicker";
import { DirectionAlternator } from "@/components/character/DirectionAlternator";
import { SheetValidationTable } from "@/components/character/SheetValidationTable";
import type { PricingRates } from "@/lib/pricing";

/**
 * Mode « Planche de personnage ».
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE MODE RÉSOUT
 * ---------------------------------------------------------------------------
 * Générées séparément, les orientations d'un même personnage ne gardent ni la
 * même taille ni la même ligne de pieds : relevé en production sur des cellules
 * de 48 × 48, face 20 × 44 pieds à Y=45, dos 16 × 42 pieds à Y=44, profil
 * 16 × 40 pieds à Y=43. En jeu, le personnage « saute » à chaque changement de
 * direction.
 *
 * Les trois vues sont donc demandées EN UNE SEULE PLANCHE, puis normalisées
 * localement sur la géométrie du maître. Le profil droit est un miroir exact du
 * gauche, ce qui le rend cohérent par construction.
 * ---------------------------------------------------------------------------
 */
export function CharacterSheetPanel({
  sheet,
  library,
  rates,
}: {
  sheet: ReturnType<typeof useCharacterSheet>;
  library: ReturnType<typeof useLibrary>;
  rates: PricingRates | null;
}) {
  const state = useAppState();
  /*
   * Le brouillon (maître compris) vit dans le hook, pas ici : ce panneau est
   * démonté dès qu'on change d'onglet ou de mode, et l'utilisateur perdrait son
   * sprite maître à chaque passage par la bibliothèque.
   */
  const {
    characterName,
    request,
    master,
    masterDirection,
    generateRightSeparately,
    matchMasterPalette,
  } = sheet.draft;
  const [savedToLibrary, setSavedToLibrary] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);

  const pack = state.activePack;
  if (pack === null) return null;

  const cellSize = CHARACTER_SHEET.CELL_SIZE;
  const result = sheet.result;
  const previews = sheet.previews;

  const blocked = resolveBlockingReason({
    request,
    hasMaster: master !== null,
    enabledCount: state.enabledReferences.length,
    enabledBytes: state.enabledBytes,
  });

  async function handleGenerate() {
    if (blocked !== null || master === null || pack === null) return;
    setSavedToLibrary(false);

    await sheet.run(
      buildSheetRequest({
        pack,
        category: null,
        request,
        characterName,
        master: master.blob,
        masterName: master.name,
        masterDirection,
        generateRightSeparately,
        matchMasterPalette,
        qualityMode: state.settings.qualityMode,
        references: state.enabledReferences,
      }),
    );
  }

  function downloadCell(direction: Direction) {
    if (result === null) return;
    const cell = result.cells.find((entry) => entry.direction === direction);
    if (!cell) return;
    downloadDataUrl(
      `data:image/png;base64,${cell.base64}`,
      cellFilename(characterName || request, direction),
    );
  }

  function downloadAll() {
    for (const direction of DIRECTIONS) downloadCell(direction);
  }

  function downloadSheet() {
    if (result === null) return;
    downloadDataUrl(
      `data:image/png;base64,${result.sheet.base64}`,
      sheetFilename(characterName || request),
    );
  }

  async function addAllToLibrary() {
    if (result === null || pack === null) return;

    for (const cell of result.cells) {
      const blob = await base64ToPngBlob(cell.base64);
      const ok = await library.addAsset({
        name: cellAssetName(characterName || result.request, cell.direction),
        packId: pack.id,
        packName: pack.name,
        categoryName: null,
        targetWidth: cellSize,
        targetHeight: cellSize,
        finalWidth: cellSize,
        finalHeight: cellSize,
        request: result.request,
        metrics: {
          colourCount: cell.validation.metrics.colourCount,
          alphaLevelCount: cell.validation.metrics.alphaLevelCount,
          semiTransparentPixels: cell.validation.metrics.semiTransparentPixels,
          verdict: `${STATUS_LABELS[cell.validation.status]} (${cell.origin})`,
          pipeline: "grid",
          gridScale: result.meta.grid.scaleX,
          gridFidelity: result.meta.grid.fidelity,
          blockMethod: result.meta.grid.method,
          fallbackReason: null,
        },
        settings: {
          size: result.meta.generationSize,
          quality: result.meta.quality as never,
          background: "transparent",
          outputFormat: "png",
          model: result.meta.model,
          referenceCount: result.meta.referenceCount,
          qualityMode: result.meta.qualityMode,
          qualityModeLabel: result.meta.qualityModeLabel,
          minimalResolution: false,
          postProcessed: true,
        },
        // L'usage n'est comptabilisé qu'une fois, sur la première vue : les
        // quatre viennent d'un seul appel API.
        usage: cell.direction === "down" ? result.meta.usage : null,
        mimeType: "image/png",
        blob,
      });
      if (!ok) return;
    }

    setSavedToLibrary(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <Section
        step="1"
        title="Personnage"
        description={`Pack « ${pack.name} » · cellules de ${cellSize} × ${cellSize} px.`}
      >
        <Field
          label="Nom du personnage"
          hint="Sert à nommer les fichiers exportés."
        >
          <input
            type="text"
            value={characterName}
            onChange={(event) => sheet.updateDraft({ characterName: event.target.value })}
            placeholder="Héros"
            className={textInputClasses()}
            aria-label="Nom du personnage"
          />
        </Field>

        <div className="mt-3">
          <Field label="Décris le personnage">
            <textarea
              value={request}
              onChange={(event) => sheet.updateDraft({ request: event.target.value })}
              rows={3}
              maxLength={LIMITS.REQUEST_MAX_CHARS}
              placeholder="Un jeune héros en tunique verte, cheveux bruns courts."
              className={textareaClasses()}
              aria-label="Décris le personnage"
            />
          </Field>
        </div>
      </Section>

      <Section
        step="2"
        title="Sprite maître"
        description="La vue déjà validée, sur laquelle les trois autres seront alignées."
      >
        <MasterPicker
          master={master}
          onMasterChange={(next) => sheet.updateDraft({ master: next })}
          masterDirection={masterDirection}
          onDirectionChange={(direction) => sheet.updateDraft({ masterDirection: direction })}
          library={library}
          disabled={sheet.pending}
        />
      </Section>

      <Section step="3" title="Options de planche">
        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={!generateRightSeparately}
              onChange={(event) => sheet.updateDraft({ generateRightSeparately: !event.target.checked })}
              className="mt-1 size-4"
            />
            <span>
              Profil droit par miroir exact du gauche
              <span className="block text-xs text-muted">
                Recommandé : le miroir est pixel à pixel, donc cohérent par construction.
                Décochez pour le faire générer séparément (asymétries, arme portée d&apos;un
                seul côté…).
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={matchMasterPalette}
              onChange={(event) => sheet.updateDraft({ matchMasterPalette: event.target.checked })}
              className="mt-1 size-4"
            />
            <span>
              Rapprocher les palettes de celle du maître
              <span className="block text-xs text-muted">
                Chaque couleur générée est ramenée à la teinte la plus proche du maître.
                Le maître, lui, n&apos;est jamais modifié.
              </span>
            </span>
          </label>
        </div>

        {sheet.error ? (
          <div className="mt-3">
            <Alert tone="error">{sheet.error}</Alert>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-2">
          <Button
            variant="primary"
            className="w-full"
            onClick={handleGenerate}
            disabled={sheet.pending || blocked !== null}
            aria-label="Générer la planche de personnage"
          >
            {sheet.pending ? "Génération en cours…" : "Générer la planche"}
          </Button>
          {sheet.pending ? (
            <Button variant="ghost" className="w-full" onClick={sheet.cancel}>
              Annuler
            </Button>
          ) : null}
          <p className="text-center text-xs text-muted">
            {blocked ?? "Les trois vues seront demandées en une seule planche."}
          </p>
        </div>
      </Section>

      {result === null || previews === null ? (
        <Section step="4" title="Planche">
          <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted">
            {sheet.pending
              ? "Génération en cours, cela peut prendre jusqu'à une minute…"
              : "Les quatre vues normalisées apparaîtront ici."}
          </p>
        </Section>
      ) : (
        <>
          <Section
            step="4"
            title="Contrôle"
            description={`${result.meta.model} · grille ×${result.meta.grid.scaleX} · fidélité ${Math.round(result.meta.grid.fidelity * 100)} %`}
          >
            {result.notices.map((notice) => (
              <div key={notice} className="mb-2">
                <Alert tone="warning">{notice}</Alert>
              </div>
            ))}

            {result.meta.overallStatus !== "ok" ? (
              <div className="mb-3">
                <Alert tone={result.meta.overallStatus === "error" ? "error" : "warning"}>
                  {result.meta.overallStatus === "error"
                    ? "Au moins une vue n'est pas conforme. Refusez la planche et régénérez-la."
                    : "Une vue s'écarte de 2 px de la hauteur cible. À vérifier à l'alternance."}
                </Alert>
              </div>
            ) : null}

            <SheetValidationTable cells={result.cells} geometry={result.meta.geometry} />

            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">Comparer par alternance</h3>
              <DirectionAlternator
                previews={previews.cells}
                cellSize={cellSize}
                directions={DIRECTIONS}
              />
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={sheet.regenerate}
                disabled={sheet.pending}
              >
                Régénérer
              </Button>
              <Button variant="danger" className="flex-1" onClick={sheet.reject}>
                Refuser cette planche
              </Button>
            </div>
            <p className="mt-2 text-center text-xs text-muted">
              Refuser efface la planche affichée. Le sprite maître reste intact : il
              n&apos;est jamais remplacé par une vue générée.
            </p>
          </Section>

          <Section step="5" title="Vues">
            <div className="flex flex-col gap-6">
              {result.cells.map((cell) => (
                <figure key={cell.direction} className="flex flex-col gap-2">
                  <figcaption className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{cell.label}</span>
                    <span className="text-xs text-muted">
                      {cell.origin} · {STATUS_LABELS[cell.validation.status]}
                    </span>
                  </figcaption>
                  <SpritePreview
                    src={previews.cells[cell.direction]}
                    alt={`${cell.label} — ${result.request}`}
                    width={cellSize}
                    height={cellSize}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => downloadCell(cell.direction)}
                  >
                    Télécharger {cellFilename(characterName || result.request, cell.direction)}
                  </Button>
                </figure>
              ))}
            </div>
          </Section>

          <Section
            step="6"
            title="Export"
            description={`Planche 2 × 2 de ${result.sheet.width} × ${result.sheet.height} px.`}
          >
            <div className="checkerboard mb-3 flex items-center justify-center overflow-auto rounded-xl border border-border p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previews.sheet}
                alt="Planche 2 × 2"
                width={result.sheet.width * 4}
                height={result.sheet.height * 4}
                style={{
                  width: result.sheet.width * 4,
                  height: result.sheet.height * 4,
                  maxWidth: "none",
                  flexShrink: 0,
                }}
                className="[image-rendering:pixelated]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Button variant="primary" onClick={downloadAll}>
                Télécharger les 4 PNG
              </Button>
              <Button variant="secondary" onClick={downloadSheet}>
                Télécharger la planche {result.sheet.width} × {result.sheet.height}
              </Button>
              <Button
                variant={savedToLibrary ? "secondary" : "primary"}
                onClick={addAllToLibrary}
                disabled={savedToLibrary}
              >
                {savedToLibrary
                  ? "Les 4 vues sont dans la bibliothèque ✓"
                  : "Ajouter les 4 vues à la bibliothèque"}
              </Button>
              {library.error ? <Alert tone="error">{library.error}</Alert> : null}
            </div>

            <div className="mt-3">
              <UsagePanel usage={result.meta.usage} rates={rates} />
            </div>

            <div className="mt-3">
              <button
                type="button"
                onClick={() => setPromptVisible((visible) => !visible)}
                className="text-xs text-muted underline underline-offset-2"
              >
                {promptVisible ? "Masquer" : "Voir"} le prompt envoyé
              </button>
              {promptVisible ? (
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-muted p-3 text-xs leading-relaxed">
                  {result.prompt}
                </pre>
              ) : null}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

/** Motif bloquant la génération, ou `null` si tout est prêt. */
function resolveBlockingReason(input: {
  request: string;
  hasMaster: boolean;
  enabledCount: number;
  enabledBytes: number;
}): string | null {
  if (!input.hasMaster) {
    return "Importez un sprite maître ou choisissez-en un dans la bibliothèque.";
  }
  if (input.request.trim().length === 0) {
    return "Décrivez le personnage pour activer la génération.";
  }
  // Une place du lot d'images est réservée au maître.
  if (input.enabledCount > LIMITS.MAX_REFERENCES - 1) {
    return `Trop de références actives (maximum ${LIMITS.MAX_REFERENCES - 1} avec un sprite maître).`;
  }
  if (input.enabledBytes > LIMITS.MAX_TOTAL_BYTES) {
    return "Les références actives pèsent trop lourd au total.";
  }
  return null;
}

async function base64ToPngBlob(base64: string): Promise<Blob> {
  const response = await fetch(`data:image/png;base64,${base64}`);
  return response.blob();
}
