"use client";

import { useMemo, useState } from "react";

import { buildProjectContext } from "@/lib/project/contextBuilder";
import { familyRuleOf } from "@/lib/project/defaults";
import { selectReferences, MAX_AUTO_SELECTED } from "@/lib/project/referenceSelection";
import { ASSET_FAMILIES, FAMILY_LABELS, FRAMING_LABELS } from "@/types/project";
import type { AssetFamily, Project, ProjectReference } from "@/types/project";
import { Alert } from "@/components/ui/Alert";
import { Field, selectClasses, textareaClasses } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";

/**
 * Aperçu de ce qui part réellement au modèle.
 *
 * ---------------------------------------------------------------------------
 * MONTRER, PAS RÉSUMER
 * ---------------------------------------------------------------------------
 * Le texte affiché est celui qui sera envoyé, caractère pour caractère. Aucune
 * troncature, aucune reformulation : un aperçu qui embellit ne sert à rien.
 *
 * La longueur est donnée en caractères (exacte) ET en jetons (ESTIMÉE). Cette
 * distinction est explicite : nous n'exécutons pas le tokeniseur du
 * fournisseur, et présenter une estimation comme un décompte serait faux.
 * ---------------------------------------------------------------------------
 */
export function ContextPreviewCard({
  project,
  references,
  request,
  onRequestChange,
  family,
  onFamilyChange,
  selectedIds,
  onSelectionChange,
}: {
  project: Project;
  references: ProjectReference[];
  request: string;
  onRequestChange: (value: string) => void;
  family: AssetFamily | null;
  onFamilyChange: (value: AssetFamily | null) => void;
  /** `null` = laisser la proposition automatique décider. */
  selectedIds: string[] | null;
  onSelectionChange: (ids: string[] | null) => void;
}) {
  const [showPrompt, setShowPrompt] = useState(false);

  const rule = familyRuleOf(project, family);
  const palette =
    project.palettes.find((entry) => entry.id === rule.paletteId) ?? null;

  const selection = useMemo(
    () => selectReferences({ references, family, manualIds: selectedIds }),
    [references, family, selectedIds],
  );

  const context = useMemo(
    () =>
      buildProjectContext({
        charter: project.charter,
        palette,
        family,
        familyLabel: family === null ? null : FAMILY_LABELS[family],
        familyRule: rule.rule,
        framing: rule.framing,
        request,
        referenceCount: selection.selected.length,
        finalWidth: rule.defaultWidth,
        finalHeight: rule.defaultHeight,
      }),
    [project.charter, palette, family, rule, request, selection.selected.length],
  );

  function toggle(id: string) {
    const current = selection.candidates.filter((c) => c.selected).map((c) => c.reference.id);
    const next = current.includes(id)
      ? current.filter((entry) => entry !== id)
      : [...current, id];
    onSelectionChange(next);
  }

  const validatedCount = references.filter((reference) => reference.validated).length;

  return (
    <Section
      step="4"
      title="Ce qui sera envoyé"
      description="Assemblé à partir du projet — aucune IA ne reformule ce texte."
    >
      <Field label="Famille d'asset" hint={FRAMING_LABELS[rule.framing]}>
        <select
          value={family ?? ""}
          onChange={(event) =>
            onFamilyChange(event.target.value === "" ? null : (event.target.value as AssetFamily))
          }
          className={selectClasses()}
          aria-label="Famille d'asset"
        >
          <option value="">Aucune famille</option>
          {ASSET_FAMILIES.map((entry) => (
            <option key={entry} value={entry}>
              {FAMILY_LABELS[entry]}
            </option>
          ))}
        </select>
      </Field>

      <div className="mt-3">
        <Field label="Demande">
          <textarea
            rows={3}
            value={request}
            onChange={(event) => onRequestChange(event.target.value)}
            placeholder="Une potion rouge dans une fiole ronde."
            className={textareaClasses()}
            aria-label="Demande"
          />
        </Field>
      </div>

      {/* ---- Références réellement envoyées ---- */}
      <h3 className="mt-4 text-sm font-semibold">
        Références envoyées ({selection.selected.length})
      </h3>

      {validatedCount === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-border px-3 py-4 text-center text-sm text-muted">
          Aucune référence validée. La génération s&apos;appuiera uniquement sur la charte.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted">
            Proposition automatique plafonnée à {MAX_AUTO_SELECTED} : la bibliothèque
            entière n&apos;est jamais envoyée. Vous pouvez modifier ce choix.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {selection.candidates.map((candidate) => (
              <li key={candidate.reference.id}>
                <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={candidate.selected}
                    onChange={() => toggle(candidate.reference.id)}
                    className="size-4"
                    aria-label={`Envoyer ${candidate.reference.name}`}
                  />
                  <span className="min-w-0 flex-1 truncate">{candidate.reference.name}</span>
                  <span className="shrink-0 text-xs text-muted">{candidate.reason}</span>
                </label>
              </li>
            ))}
          </ul>
          {selectedIds !== null ? (
            <button
              type="button"
              onClick={() => onSelectionChange(null)}
              className="mt-2 text-xs text-muted underline underline-offset-2"
            >
              Revenir à la sélection automatique
            </button>
          ) : null}
          {selection.omittedCount > 0 && selectedIds === null ? (
            <p className="mt-2 text-xs text-muted">
              {selection.omittedCount} référence(s) validée(s) non envoyée(s) — cochez-les
              si elles sont utiles à cette demande.
            </p>
          ) : null}
        </>
      )}

      {/* ---- Longueur ---- */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-surface-muted p-3">
          <p className="text-xs uppercase tracking-wide text-muted">Longueur exacte</p>
          <p className="mt-1 text-lg font-semibold">{context.characterCount}</p>
          <p className="text-xs text-muted">caractères</p>
        </div>
        <div className="rounded-xl bg-surface-muted p-3">
          <p className="text-xs uppercase tracking-wide text-muted">Jetons — estimation</p>
          <p className="mt-1 text-lg font-semibold">≈ {context.estimatedTokens}</p>
          <p className="text-xs text-muted">approximation, ±30 %</p>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        Le nombre de jetons est une <strong>estimation</strong> : le découpage réel dépend du
        tokeniseur du fournisseur, que nous n&apos;exécutons pas ici.
      </p>

      {request.trim().length === 0 ? (
        <div className="mt-3">
          <Alert tone="info">Saisissez une demande pour voir le texte complet.</Alert>
        </div>
      ) : null}

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowPrompt((visible) => !visible)}
          className="text-xs text-muted underline underline-offset-2"
        >
          {showPrompt ? "Masquer" : "Voir"} le texte exact envoyé
        </button>
        {showPrompt ? (
          <pre
            data-testid="context-preview"
            className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-muted p-3 text-xs leading-relaxed"
          >
            {context.prompt}
          </pre>
        ) : null}
      </div>

      <p className="mt-3 text-xs text-muted">
        Ces règles orientent le rendu ; elles ne garantissent pas une cohérence artistique
        parfaite d&apos;une génération à l&apos;autre.
      </p>
    </Section>
  );
}
