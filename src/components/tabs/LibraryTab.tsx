"use client";

import { useState } from "react";

import {
  buildAssetFilename,
  downloadDataUrl,
  extensionForMimeType,
} from "@/lib/client/download";
import { NAME_LIMITS } from "@/lib/config";
import type { useLibrary } from "@/hooks/useLibrary";
import type { GeneratedAsset } from "@/types/domain";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { textInputClasses } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";
import { SpritePreview } from "@/components/SpritePreview";

/**
 * Onglet Bibliothèque — assets générés.
 *
 * ---------------------------------------------------------------------------
 * CONSULTATION SEULE, CÔTÉ SORTIE
 * ---------------------------------------------------------------------------
 * Ce composant n'offre aucun moyen de renvoyer un asset vers la génération :
 * pas de « réutiliser comme référence », pas de sélection exportable vers le
 * Style Pack. C'est délibéré.
 * ---------------------------------------------------------------------------
 */
export function LibraryTab({ library }: { library: ReturnType<typeof useLibrary> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = library.assets.find((asset) => asset.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Section
        step="•"
        title="Bibliothèque"
        description="Assets générés et enregistrés dans ce navigateur."
        action={<span className="text-xs text-muted">{library.assets.length}</span>}
      >
        {library.error ? <Alert tone="error">{library.error}</Alert> : null}

        {library.loading ? (
          <p className="text-sm text-muted">Chargement…</p>
        ) : library.assets.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-sm text-muted">
            Aucun asset enregistré. Après une génération, utilisez « Ajouter à la
            bibliothèque ».
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {library.assets.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(asset.id)}
                  className="flex w-full flex-col gap-2 rounded-xl border border-border p-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {/* Aperçu depuis un blob local : `next/image` n'apporte rien ici. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={library.previews[asset.id]}
                    alt={asset.name}
                    /*
                     * `pixelated` : sans cela le navigateur lisse un 16 × 16
                     * agrandi et l'aperçu ne ressemble plus à l'asset livré.
                     */
                    className="checkerboard aspect-square w-full rounded-lg object-contain [image-rendering:pixelated]"
                  />
                  <span className="truncate text-xs font-medium">{asset.name}</span>
                  <span className="truncate text-[11px] text-muted">
                    {asset.finalWidth && asset.finalHeight
                      ? `${asset.finalWidth} × ${asset.finalHeight} px`
                      : formatDate(asset.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {selected ? (
        <AssetDetail
          asset={selected}
          previewUrl={library.previews[selected.id]}
          onRename={(name) => library.renameAsset(selected.id, name)}
          onDelete={() => {
            library.removeAsset(selected.id);
            setSelectedId(null);
          }}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}

function AssetDetail({
  asset,
  previewUrl,
  onRename,
  onDelete,
  onClose,
}: {
  asset: GeneratedAsset;
  previewUrl: string;
  onRename: (name: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Section
      step="•"
      title="Aperçu"
      action={
        <Button variant="ghost" onClick={onClose} aria-label="Fermer l'aperçu">
          Fermer
        </Button>
      }
    >
      {/* Consultation détaillée : aperçu natif ET zoom, comme après génération. */}
      <SpritePreview
        src={previewUrl}
        alt={asset.name}
        width={asset.finalWidth ?? null}
        height={asset.finalHeight ?? null}
      />

      <div className="mt-3">
        <input
          type="text"
          value={asset.name}
          maxLength={NAME_LIMITS.ASSET_NAME_MAX_CHARS}
          onChange={(event) => onRename(event.target.value)}
          className={textInputClasses()}
          aria-label="Renommer l'asset"
        />
      </div>

      <dl className="mt-3 flex flex-col gap-1 rounded-xl bg-surface-muted p-3 text-sm">
        <Row label="Date" value={formatDate(asset.createdAt)} />
        <Row label="Style Pack" value={asset.packName} />
        <Row label="Catégorie" value={asset.categoryName ?? "—"} />
        <Row
          label="Taille finale livrée"
          value={
            asset.finalWidth && asset.finalHeight
              ? `${asset.finalWidth} × ${asset.finalHeight} px`
              : "rendu brut"
          }
        />
        <Row
          label="Emprise cible (catégorie)"
          value={
            asset.targetWidth && asset.targetHeight
              ? `${asset.targetWidth} × ${asset.targetHeight} px`
              : "—"
          }
        />
        <Row label="Résolution de génération" value={formatSize(asset.settings.size)} />
        <Row
          label="Qualité"
          value={asset.settings.qualityModeLabel ?? asset.settings.quality}
        />
        <Row
          label="Post-traitement"
          value={asset.settings.postProcessed ? "nettoyage pixel-art" : "aucun"}
        />
        {asset.metrics ? (
          <>
            <Row
              label="Mode pixel art"
              value={
                asset.metrics.pipeline === "grid" ? "grille native" : "nettoyage classique"
              }
            />
            {asset.metrics.gridScale ? (
              <Row label="Grille logique" value={`×${asset.metrics.gridScale}`} />
            ) : null}
            {asset.metrics.gridFidelity !== null &&
            asset.metrics.gridFidelity !== undefined ? (
              <Row
                label="Fidélité de grille"
                value={`${Math.round(asset.metrics.gridFidelity * 100)} %`}
              />
            ) : null}
            {asset.metrics.blockMethod ? (
              <Row label="Lecture de bloc" value={asset.metrics.blockMethod} />
            ) : null}
            {asset.metrics.fallbackReason ? (
              <Row label="Repli" value={asset.metrics.fallbackReason} />
            ) : null}
            <Row label="Couleurs" value={String(asset.metrics.colourCount)} />
            <Row label="Niveaux d'alpha" value={String(asset.metrics.alphaLevelCount)} />
            <Row label="Qualité pixel-art" value={asset.metrics.verdict} />
          </>
        ) : null}
        <Row label="Fond" value={asset.settings.background} />
        <Row label="Format" value={asset.settings.outputFormat} />
        <Row label="Modèle" value={asset.settings.model} />
        <Row label="Références utilisées" value={String(asset.settings.referenceCount)} />
        <Row
          label="Jetons (total)"
          value={
            asset.usage?.totalTokens != null
              ? asset.usage.totalTokens.toLocaleString("fr-FR")
              : "Donnée non disponible"
          }
        />
      </dl>

      <div className="mt-3 rounded-xl bg-surface-muted p-3">
        <p className="text-xs uppercase tracking-wide text-muted">Demande utilisée</p>
        <p className="mt-1 whitespace-pre-line text-sm">{asset.request}</p>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button
          variant="primary"
          className="flex-1"
          onClick={() =>
            downloadDataUrl(
              previewUrl,
              buildAssetFilename(asset.name, extensionForMimeType(asset.mimeType)),
            )
          }
        >
          Télécharger
        </Button>
        <ConfirmButton
          label="Supprimer"
          className="flex-1"
          onConfirm={onDelete}
          ariaLabel={`Supprimer ${asset.name}`}
        />
      </div>
    </Section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="truncate text-right">{value}</dd>
    </div>
  );
}

/** « 816x816 » → « 816 × 816 px ». */
function formatSize(size: string): string {
  const match = /^(\d+)x(\d+)$/i.exec(size);
  return match ? `${match[1]} × ${match[2]} px` : size;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
