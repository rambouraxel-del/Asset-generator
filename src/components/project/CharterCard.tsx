"use client";

import { useState } from "react";

import { CHARTER_FIELDS, FAMILY_LABELS, FRAMING_LABELS } from "@/types/project";
import type { FramingMode, Project, StyleCharter } from "@/types/project";
import { createId } from "@/lib/storage/db";
import type { useProjectWorkspace } from "@/hooks/useProjectWorkspace";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Field, selectClasses, textInputClasses, textareaClasses } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";
import { SyncBadge } from "@/components/project/SyncBadge";

/**
 * Édition de la charte, des palettes et des règles par famille.
 *
 * ---------------------------------------------------------------------------
 * ENREGISTREMENT EXPLICITE
 * ---------------------------------------------------------------------------
 * La saisie est locale tant qu'on n'a pas cliqué « Enregistrer ». Un
 * enregistrement automatique à chaque frappe multiplierait les écritures
 * distantes et, surtout, les conflits de version entre appareils. Le bouton
 * affiche donc clairement s'il reste des changements non enregistrés.
 * ---------------------------------------------------------------------------
 */
export function CharterCard({
  project,
  workspace,
}: {
  project: Project;
  workspace: ReturnType<typeof useProjectWorkspace>;
}) {
  const [draft, setDraft] = useState<Project>(project);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  /*
   * Le projet peut changer sous nos pieds : autre projet sélectionné,
   * rechargement, conflit résolu. La saisie repart alors de la version qui fait
   * autorité. La comparaison se fait PENDANT LE RENDU plutôt que dans un effet :
   * l'écran ne montre jamais, même un instant, la saisie de l'ancien projet.
   */
  const authority = `${project.id}:${project.version}:${project.updatedAt}`;
  const [lastAuthority, setLastAuthority] = useState(authority);
  if (authority !== lastAuthority) {
    setLastAuthority(authority);
    setDraft(project);
    setSaved(false);
  }

  const dirty = JSON.stringify(stripVolatile(draft)) !== JSON.stringify(stripVolatile(project));

  async function save() {
    setBusy(true);
    setSaved(false);
    const result = await workspace.updateProject(project, () => draft);
    setBusy(false);
    if (result.error === null) setSaved(true);
  }

  function patchCharter(key: keyof StyleCharter, value: string) {
    setDraft((current) => ({ ...current, charter: { ...current.charter, [key]: value } }));
  }

  return (
    <Section
      step="2"
      title="Charte graphique"
      description="Ces règles sont ajoutées à chaque génération de ce projet."
      action={<SyncBadge state={workspace.syncState} compact />}
    >
      <div className="flex flex-col gap-3">
        {CHARTER_FIELDS.map((field) => (
          <Field key={field.key} label={field.label} hint={field.hint}>
            <textarea
              rows={2}
              value={draft.charter[field.key]}
              onChange={(event) => patchCharter(field.key, event.target.value)}
              placeholder={field.placeholder}
              className={textareaClasses()}
              aria-label={field.label}
            />
          </Field>
        ))}
      </div>

      {/* ---- Palettes ---- */}
      <h3 className="mt-5 text-sm font-semibold">Palettes</h3>
      <p className="mt-1 text-xs text-muted">
        Une palette imposée limite les couleurs employées. Format attendu :{" "}
        <code>#rrggbb</code>, séparés par des virgules.
      </p>

      <div className="mt-2 flex flex-col gap-3">
        {draft.palettes.map((palette) => (
          <div key={palette.id} className="rounded-xl border border-border p-3">
            <Field label="Nom de la palette">
              <input
                type="text"
                value={palette.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    palettes: current.palettes.map((entry) =>
                      entry.id === palette.id ? { ...entry, name: event.target.value } : entry,
                    ),
                  }))
                }
                className={textInputClasses()}
                aria-label="Nom de la palette"
              />
            </Field>
            <div className="mt-2">
              <Field label="Couleurs">
                <input
                  type="text"
                  value={palette.colours.join(", ")}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      palettes: current.palettes.map((entry) =>
                        entry.id === palette.id
                          ? { ...entry, colours: parseColours(event.target.value) }
                          : entry,
                      ),
                    }))
                  }
                  placeholder="#2b1d1a, #7a5c3e, #c9a227"
                  className={textInputClasses()}
                  aria-label="Couleurs de la palette"
                />
              </Field>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {palette.colours.map((colour) => (
                <span
                  key={colour}
                  title={colour}
                  className="size-5 rounded border border-border"
                  style={{ backgroundColor: colour }}
                />
              ))}
            </div>
            <div className="mt-2">
              <ConfirmButton
                label="Supprimer la palette"
                onConfirm={() =>
                  setDraft((current) => ({
                    ...current,
                    palettes: current.palettes.filter((entry) => entry.id !== palette.id),
                    // Une famille qui pointait vers elle repasse sur le défaut.
                    familyRules: current.familyRules.map((rule) =>
                      rule.paletteId === palette.id ? { ...rule, paletteId: null } : rule,
                    ),
                  }))
                }
              />
            </div>
          </div>
        ))}

        <Button
          variant="secondary"
          onClick={() =>
            setDraft((current) => ({
              ...current,
              palettes: [
                ...current.palettes,
                { id: createId("palette"), name: "Nouvelle palette", colours: [] },
              ],
            }))
          }
        >
          Ajouter une palette
        </Button>
      </div>

      {/* ---- Règles par famille ---- */}
      <h3 className="mt-5 text-sm font-semibold">Règles par famille</h3>
      <p className="mt-1 text-xs text-muted">
        Le cadrage est important : une tuile de sol couvre toute la cellule et se raccorde,
        là où un objet isolé garde une marge transparente. Les deux consignes ne sont jamais
        envoyées ensemble.
      </p>

      <div className="mt-2 flex flex-col gap-3">
        {draft.familyRules.map((rule) => (
          <div key={rule.family} className="rounded-xl border border-border p-3">
            <p className="text-sm font-medium">{FAMILY_LABELS[rule.family]}</p>

            <div className="mt-2">
              <Field label="Règle ajoutée au prompt">
                <textarea
                  rows={2}
                  value={rule.rule}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      familyRules: current.familyRules.map((entry) =>
                        entry.family === rule.family
                          ? { ...entry, rule: event.target.value }
                          : entry,
                      ),
                    }))
                  }
                  className={textareaClasses()}
                  aria-label={`Règle pour ${FAMILY_LABELS[rule.family]}`}
                />
              </Field>
            </div>

            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Cadrage">
                <select
                  value={rule.framing}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      familyRules: current.familyRules.map((entry) =>
                        entry.family === rule.family
                          ? { ...entry, framing: event.target.value as FramingMode }
                          : entry,
                      ),
                    }))
                  }
                  className={selectClasses()}
                  aria-label={`Cadrage pour ${FAMILY_LABELS[rule.family]}`}
                >
                  {(Object.keys(FRAMING_LABELS) as FramingMode[]).map((mode) => (
                    <option key={mode} value={mode}>
                      {FRAMING_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Palette imposée">
                <select
                  value={rule.paletteId ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      familyRules: current.familyRules.map((entry) =>
                        entry.family === rule.family
                          ? { ...entry, paletteId: event.target.value || null }
                          : entry,
                      ),
                    }))
                  }
                  className={selectClasses()}
                  aria-label={`Palette pour ${FAMILY_LABELS[rule.family]}`}
                >
                  <option value="">Aucune</option>
                  {draft.palettes.map((palette) => (
                    <option key={palette.id} value={palette.id}>
                      {palette.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Largeur par défaut">
                <input
                  type="number"
                  min={1}
                  value={rule.defaultWidth ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      familyRules: current.familyRules.map((entry) =>
                        entry.family === rule.family
                          ? { ...entry, defaultWidth: toSize(event.target.value) }
                          : entry,
                      ),
                    }))
                  }
                  className={textInputClasses()}
                  aria-label={`Largeur par défaut pour ${FAMILY_LABELS[rule.family]}`}
                />
              </Field>
              <Field label="Hauteur par défaut">
                <input
                  type="number"
                  min={1}
                  value={rule.defaultHeight ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      familyRules: current.familyRules.map((entry) =>
                        entry.family === rule.family
                          ? { ...entry, defaultHeight: toSize(event.target.value) }
                          : entry,
                      ),
                    }))
                  }
                  className={textInputClasses()}
                  aria-label={`Hauteur par défaut pour ${FAMILY_LABELS[rule.family]}`}
                />
              </Field>
            </div>
          </div>
        ))}
      </div>

      {workspace.error ? (
        <div className="mt-3">
          <Alert tone="error">{workspace.error}</Alert>
        </div>
      ) : null}

      <div className="mt-4">
        <Button
          variant={dirty ? "primary" : "secondary"}
          className="w-full"
          onClick={() => void save()}
          disabled={busy || !dirty}
        >
          {busy
            ? "Enregistrement…"
            : dirty
              ? "Enregistrer les modifications"
              : saved
                ? "Enregistré ✓"
                : "Aucune modification"}
        </Button>
        {dirty ? (
          <p className="mt-2 text-center text-xs text-muted">
            Modifications non enregistrées. Elles seront perdues si vous quittez la page.
          </p>
        ) : null}
      </div>
    </Section>
  );
}

/** Champs qui bougent à l'enregistrement et ne comptent pas comme une saisie. */
function stripVolatile(project: Project) {
  const { updatedAt: _updatedAt, version: _version, ...rest } = project;
  void _updatedAt;
  void _version;
  return rest;
}

function parseColours(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^#[0-9a-f]{6}$/.test(entry));
}

function toSize(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}
