"use client";

import { useState } from "react";

import type { useProjectWorkspace } from "@/hooks/useProjectWorkspace";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Field, selectClasses, textInputClasses, textareaClasses } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";

/**
 * Création, sélection et archivage des projets.
 *
 * L'archivage remplace la suppression : un projet archivé sort des listes mais
 * garde sa bibliothèque et son historique. Supprimer pour de bon détruirait des
 * générations déjà payées.
 */
export function ProjectListCard({
  workspace,
}: {
  workspace: ReturnType<typeof useProjectWorkspace>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const active = workspace.activeProject;

  async function handleCreate() {
    setBusy(true);
    const created = await workspace.addProject(name, description);
    setBusy(false);
    if (created !== null) {
      setName("");
      setDescription("");
      setCreating(false);
    }
  }

  async function toggleArchive(archived: boolean) {
    if (active === null) return;
    setBusy(true);
    await workspace.updateProject(active, (project) => ({ ...project, archived }));
    setBusy(false);
  }

  return (
    <Section
      step="1"
      title="Projet"
      description={`${workspace.visibleProjects.length} projet${
        workspace.visibleProjects.length > 1 ? "s" : ""
      } · ${workspace.archivedProjects.length} archivé${
        workspace.archivedProjects.length > 1 ? "s" : ""
      }`}
    >
      {workspace.conflict !== null ? (
        <div className="mb-3 flex flex-col gap-2">
          <Alert tone="error">
            Ce projet a été modifié sur un autre appareil. Vos changements n&apos;ont pas été
            enregistrés, rien n&apos;a été écrasé.
          </Alert>
          <Button variant="secondary" onClick={workspace.acceptRemoteVersion}>
            Charger la version du serveur
          </Button>
        </div>
      ) : null}

      {workspace.visibleProjects.length > 0 ? (
        <Field label="Projet actif">
          <select
            value={active?.id ?? ""}
            onChange={(event) => workspace.selectProject(event.target.value)}
            className={selectClasses()}
            aria-label="Projet actif"
          >
            <option value="">Aucun projet sélectionné</option>
            {workspace.visibleProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted">
          Aucun projet pour l&apos;instant. Créez-en un pour commencer — par exemple
          « Timeless Journey ».
        </p>
      )}

      {creating ? (
        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-border p-3">
          <Field label="Nom du projet">
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Timeless Journey"
              className={textInputClasses()}
              aria-label="Nom du projet"
            />
          </Field>
          <Field label="Description" hint="À quoi sert ce projet ? Une phrase suffit.">
            <textarea
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={textareaClasses()}
              aria-label="Description du projet"
            />
          </Field>
          <div className="flex gap-2">
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => void handleCreate()}
              disabled={busy || name.trim().length === 0}
            >
              {busy ? "Création…" : "Créer le projet"}
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Annuler
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button variant="secondary" className="w-full" onClick={() => setCreating(true)}>
            Nouveau projet
          </Button>
        </div>
      )}

      {active !== null ? (
        <div className="mt-3 rounded-xl border border-border p-3">
          <p className="text-sm font-medium">{active.name}</p>
          {active.description.length > 0 ? (
            <p className="mt-1 text-sm text-muted">{active.description}</p>
          ) : null}
          <p className="mt-2 text-xs text-muted">
            Version {active.version} · modifié le{" "}
            {new Date(active.updatedAt).toLocaleString("fr-FR")}
          </p>
          <div className="mt-3">
            <ConfirmButton
              label="Archiver ce projet"
              confirmLabel="Confirmer l'archivage"
              onConfirm={() => void toggleArchive(true)}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            L&apos;archivage masque le projet sans rien supprimer : bibliothèque, références
            et historique sont conservés.
          </p>
        </div>
      ) : null}

      {workspace.archivedProjects.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted underline underline-offset-2">
            Projets archivés ({workspace.archivedProjects.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {workspace.archivedProjects.map((project) => (
              <li
                key={project.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="truncate">{project.name}</span>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void workspace.updateProject(project, (value) => ({
                      ...value,
                      archived: false,
                    }))
                  }
                >
                  Réactiver
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Section>
  );
}
