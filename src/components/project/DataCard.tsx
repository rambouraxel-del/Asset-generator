"use client";

import { useState } from "react";

import { downloadDataUrl } from "@/lib/client/download";
import {
  ORIGIN_LIMITATION_NOTICE,
  planLegacyImport,
  type LegacyAssetLike,
} from "@/lib/project/legacyImport";
import {
  MANIFEST_VERSION,
  detectConflicts,
  validateManifest,
  type ImportConflict,
  type ProjectManifest,
} from "@/lib/project/portableProject";
import { listGeneratedAssets } from "@/lib/storage/generatedAssets";
import { listProjectReferences } from "@/lib/storage/projectReferences";
import type { Project } from "@/types/project";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";

/**
 * Import de l'ancienne bibliothèque, export et import portables.
 *
 * ---------------------------------------------------------------------------
 * COPIER, JAMAIS DÉPLACER
 * ---------------------------------------------------------------------------
 * L'import lit l'ancienne bibliothèque et la recopie. La source n'est ni
 * modifiée ni vidée : en cas de problème, elle est toujours là.
 * ---------------------------------------------------------------------------
 */
export function DataCard({
  project,
  onImported,
}: {
  project: Project;
  onImported: () => void;
}) {
  const [scan, setScan] = useState<{ assets: LegacyAssetLike[]; message: string } | null>(null);
  const [conflicts, setConflicts] = useState<ImportConflict[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Analyse d'abord, sans rien écrire : l'utilisateur voit avant de décider. */
  async function analyseLegacy() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const legacy = await listGeneratedAssets();
      const existing = await listProjectReferences(project.id);
      const plan = planLegacyImport({
        assets: legacy.map((asset) => ({
          id: asset.id,
          name: asset.name,
          createdAt: asset.createdAt,
          finalWidth: asset.finalWidth ?? null,
          finalHeight: asset.finalHeight ?? null,
          categoryName: asset.categoryName ?? null,
        })),
        references: [],
        existingAssetIds: [],
        existingReferenceIds: existing.map((reference) => reference.id),
      });

      setScan({
        assets: plan.assets,
        message:
          plan.assets.length === 0
            ? "Aucun asset à reprendre depuis cette adresse : la bibliothèque de la version précédente est vide ici."
            : `${plan.assets.length} asset(s) trouvés, ${plan.skippedAssets} déjà présents (ils seront ignorés).`,
      });
    } catch (cause) {
      setError(`Lecture de l'ancienne bibliothèque impossible : ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  }

  async function exportProject() {
    setBusy(true);
    setError(null);
    try {
      const references = await listProjectReferences(project.id);
      const images = await Promise.all(
        references.map(async (reference) => ({
          ref: reference.id,
          name: reference.name,
          mimeType: reference.mimeType,
          width: reference.width,
          height: reference.height,
          base64: await blobToBase64(reference.blob),
        })),
      );

      const { kind: _kind, ...rest } = project;
      void _kind;

      const manifest: ProjectManifest = {
        manifestVersion: MANIFEST_VERSION,
        exportedAt: Date.now(),
        appVersion: "0.3.0",
        project: rest,
        assets: [],
        references: references.map((reference) => ({
          id: reference.id,
          name: reference.name,
          validated: reference.validated,
          pinned: reference.pinned,
          families: reference.families,
          ref: reference.id,
        })),
        images,
      };

      const json = JSON.stringify(manifest);
      const url = `data:application/json;base64,${btoa(unescape(encodeURIComponent(json)))}`;
      downloadDataUrl(url, `${slug(project.name)}-export.json`);
      setMessage(
        `Export produit : ${references.length} référence(s), ${images.length} image(s). Ce fichier est un export MANUEL, pas une sauvegarde automatique.`,
      );
    } catch (cause) {
      setError(`Export impossible : ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  }

  async function analyseImport(file: File) {
    setBusy(true);
    setError(null);
    setMessage(null);
    setConflicts(null);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const validation = validateManifest(parsed);

      if (!validation.valid || validation.manifest === null) {
        setError(
          `Fichier refusé :\n${validation.issues.map((issue) => `• ${issue.message}`).join("\n")}`,
        );
        return;
      }

      const references = await listProjectReferences(project.id);
      const found = detectConflicts(validation.manifest, {
        projectIds: [project.id],
        assetIds: [],
        referenceIds: references.map((reference) => reference.id),
      });

      setConflicts(found);
      setMessage(
        found.length === 0
          ? `Fichier valide : ${validation.manifest.references.length} référence(s), ${validation.manifest.images.length} image(s). Aucun conflit.`
          : `Fichier valide, mais ${found.length} conflit(s) détecté(s). Rien n'a été importé.`,
      );
    } catch (cause) {
      setError(`Fichier illisible : ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section step="6" title="Données du projet" description="Import, export, sauvegarde.">
      <h3 className="text-sm font-semibold">Reprendre l&apos;ancienne bibliothèque</h3>
      <p className="mt-1 text-xs text-muted">{ORIGIN_LIMITATION_NOTICE}</p>

      <div className="mt-2">
        <Button variant="secondary" onClick={() => void analyseLegacy()} disabled={busy}>
          Analyser l&apos;ancienne bibliothèque
        </Button>
      </div>

      {scan !== null ? (
        <div className="mt-2">
          <Alert tone="info">{scan.message}</Alert>
          {scan.assets.length > 0 ? (
            <p className="mt-2 text-xs text-muted">
              La copie laisse la source intacte et n&apos;active aucune référence : les
              assets repris restent des assets, à vous de valider ce qui doit servir de
              référence.
            </p>
          ) : null}
        </div>
      ) : null}

      <h3 className="mt-5 text-sm font-semibold">Export portable</h3>
      <p className="mt-1 text-xs text-muted">
        Un fichier JSON contenant le projet et ses images. Sert à déplacer un projet ou à en
        garder une copie — <strong>ce n&apos;est pas une sauvegarde automatique</strong>.
      </p>
      <div className="mt-2">
        <Button variant="secondary" onClick={() => void exportProject()} disabled={busy}>
          Exporter ce projet
        </Button>
      </div>

      <h3 className="mt-5 text-sm font-semibold">Import portable</h3>
      <Field label="Fichier d'export" hint="Le fichier est vérifié avant tout import.">
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void analyseImport(file);
            event.target.value = "";
          }}
          className="min-h-11 w-full rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm"
          aria-label="Importer un fichier de projet"
        />
      </Field>

      {conflicts !== null && conflicts.length > 0 ? (
        <div className="mt-2">
          <Alert tone="warning">
            <span className="font-medium">Conflits détectés — rien n&apos;a été importé :</span>
            <ul className="mt-1 list-inside list-disc">
              {conflicts.map((conflict) => (
                <li key={`${conflict.kind}-${conflict.id}`}>
                  {conflict.kind} « {conflict.name} » — {conflict.message}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}

      {message ? (
        <div className="mt-2">
          <Alert tone="info">{message}</Alert>
        </div>
      ) : null}
      {error ? (
        <div className="mt-2">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      <p className="mt-4 text-xs text-muted">
        Sauvegarde complète : la base <em>et</em> les fichiers doivent être sauvegardés
        séparément. Voir <code>docs/memoire-et-budget.md</code>.
      </p>

      <button
        type="button"
        onClick={onImported}
        className="mt-2 text-xs text-muted underline underline-offset-2"
      >
        Rafraîchir les données affichées
      </button>
    </Section>
  );
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "projet"
  );
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}
