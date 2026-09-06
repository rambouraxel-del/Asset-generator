"use client";

/**
 * Stockage local des références validées d'un projet.
 *
 * Cache de travail : quand un compte est connecté, la base fait autorité et ce
 * store ne sert qu'à afficher vite et à travailler hors ligne.
 *
 * Store distinct de `styleReferences` (V0.2) : les anciennes données restent
 * intactes et lisibles, et l'import les recopie sans les altérer.
 */

import {
  createId,
  runRequest,
  STORE_PROJECT_REFERENCES,
} from "@/lib/storage/db";
import type { ProjectReference } from "@/types/project";

export function createProjectReferenceId(): string {
  return createId("pref");
}

export async function listProjectReferences(
  projectId: string,
): Promise<ProjectReference[]> {
  const all = await runRequest<ProjectReference[]>(
    STORE_PROJECT_REFERENCES,
    "readonly",
    (store) => store.index("projectId").getAll(projectId),
  );
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putProjectReference(reference: ProjectReference): Promise<void> {
  await runRequest(STORE_PROJECT_REFERENCES, "readwrite", (store) => store.put(reference));
}

export async function deleteProjectReference(id: string): Promise<void> {
  await runRequest(STORE_PROJECT_REFERENCES, "readwrite", (store) => store.delete(id));
}
