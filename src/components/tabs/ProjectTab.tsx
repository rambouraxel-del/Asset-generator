"use client";

import { useCallback, useEffect, useState } from "react";

import { listProjectReferences } from "@/lib/storage/projectReferences";
import type { AssetFamily, ProjectReference } from "@/types/project";
import type { ReadinessResponse } from "@/types/api";
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace";
import { Alert } from "@/components/ui/Alert";
import { AccountCard } from "@/components/project/AccountCard";
import { BudgetCard } from "@/components/project/BudgetCard";
import { CharterCard } from "@/components/project/CharterCard";
import { ContextPreviewCard } from "@/components/project/ContextPreviewCard";
import { DataCard } from "@/components/project/DataCard";
import { ProjectListCard } from "@/components/project/ProjectListCard";
import { ReferencesCard } from "@/components/project/ReferencesCard";
import { SyncBadge } from "@/components/project/SyncBadge";

/**
 * Onglet Projet.
 *
 * Assemble le parcours complet : compte, projet, charte, références, aperçu du
 * contexte, budget, données. Les modes Asset unique et Planche de personnage
 * restent inchangés dans l'onglet Générer.
 */
export function ProjectTab({
  workspace,
  readiness,
}: {
  workspace: ReturnType<typeof useProjectWorkspace>;
  readiness: ReadinessResponse | null;
}) {
  const [references, setReferences] = useState<ProjectReference[]>([]);
  const [request, setRequest] = useState("");
  const [family, setFamily] = useState<AssetFamily | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);

  const project = workspace.activeProject;
  const projectId = project?.id ?? null;

  /*
   * Les références sont rechargées à chaque changement de projet et après
   * chaque modification. `reloadToken` sert de déclencheur explicite : plus
   * lisible qu'un état dupliqué, et le garde `cancelled` évite d'écrire le
   * résultat d'une lecture obsolète après un changement de projet rapide.
   */
  const [reloadToken, setReloadToken] = useState(0);
  const reloadReferences = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    // Sans projet, la lecture renvoie une liste vide : un seul chemin de code,
    // et aucune écriture d'état synchrone dans l'effet.
    const pending =
      projectId === null
        ? Promise.resolve([] as ProjectReference[])
        : listProjectReferences(projectId);

    pending
      .then((loaded) => {
        if (!cancelled) setReferences(loaded);
      })
      .catch(() => {
        if (!cancelled) setReferences([]);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, reloadToken]);

  // Changer de projet remet la sélection de références à l'automatique : garder
  // celle du projet précédent enverrait des images sans rapport.
  const [lastProject, setLastProject] = useState(projectId);
  if (projectId !== lastProject) {
    setLastProject(projectId);
    setSelectedIds(null);
    setFamily(null);
  }

  if (workspace.loading) {
    return (
      <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">
        Chargement…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SyncBadge state={workspace.syncState} detail={workspace.error} />

      <AccountCard workspace={workspace} />
      <ProjectListCard workspace={workspace} />

      {project === null ? (
        <Alert tone="info">
          Sélectionnez ou créez un projet pour saisir sa charte, ses références et voir ce
          qui sera envoyé au modèle.
        </Alert>
      ) : (
        <>
          <CharterCard project={project} workspace={workspace} />
          <ReferencesCard
            projectId={project.id}
            references={references}
            onChange={reloadReferences}
          />
          <ContextPreviewCard
            project={project}
            references={references}
            request={request}
            onRequestChange={setRequest}
            family={family}
            onFamilyChange={setFamily}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
          />
          <BudgetCard readiness={readiness} />
          <DataCard project={project} onImported={reloadReferences} />
        </>
      )}
    </div>
  );
}
