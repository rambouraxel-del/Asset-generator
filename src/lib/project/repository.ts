"use client";

/**
 * Dépôt de projets : cache local + source distante.
 *
 * ---------------------------------------------------------------------------
 * QUI FAIT AUTORITÉ
 * ---------------------------------------------------------------------------
 * Déconnecté  — le navigateur est la seule source. L'état affiché est
 *               « local uniquement », sans ambiguïté.
 *
 * Connecté    — LA BASE FAIT AUTORITÉ. Le cache local sert à afficher vite et
 *               à travailler hors ligne, mais toute écriture part au serveur
 *               et son échec est REMONTÉ.
 *
 * ---------------------------------------------------------------------------
 * UN ÉCHEC DISTANT N'EST JAMAIS MASQUÉ PAR UN SUCCÈS LOCAL
 * ---------------------------------------------------------------------------
 * C'est la règle centrale de ce module. Écrire dans le cache puis afficher
 * « enregistré » alors que le serveur a refusé produirait exactement la perte
 * de données qu'on cherche à éviter : l'utilisateur croirait son travail à
 * l'abri. Toute écriture connectée renvoie donc soit `synced`, soit `error`,
 * jamais un faux succès.
 * ---------------------------------------------------------------------------
 */

import { applyVersioned, type ConcurrencyOutcome } from "@/lib/project/concurrency";
import { createProjectId, isValidUuid } from "@/lib/project/ids";
import { loadProjects, saveProjects } from "@/lib/storage/projects";
import type { Project } from "@/types/project";

/** État de synchronisation, affiché tel quel à l'utilisateur. */
export type SyncState = "local-only" | "syncing" | "synced" | "error";

/**
 * Ce qui est réellement synchronisé aujourd'hui.
 *
 * Annoncer « Synchronisé » sans plus de précision laisserait croire que TOUT
 * suit d'un appareil à l'autre. Ce n'est pas le cas : seule la table `projects`
 * est écrite à distance. Les images vivent encore dans IndexedDB, donc sur un
 * seul appareil. Le dire est la seule façon d'éviter qu'un utilisateur croie
 * ses références à l'abri alors qu'elles ne le sont pas.
 */
export const SYNCED_SCOPE = {
  remote: ["projets", "chartes", "palettes", "règles par famille"],
  localOnly: ["références validées", "bibliothèque d'assets", "variantes"],
} as const;

export const SYNC_LABELS: Record<SyncState, string> = {
  "local-only": "Local uniquement",
  syncing: "Synchronisation…",
  synced: "Synchronisé",
  error: "Erreur de synchronisation",
};

export const SYNC_HINTS: Record<SyncState, string> = {
  "local-only":
    "Vos données ne quittent pas ce navigateur. Elles ne suivront pas sur un autre appareil et disparaîtront si vous videz le cache.",
  syncing: "Envoi au serveur en cours.",
  synced:
    "Projet enregistré sur le serveur : nom, charte, palettes et règles vous suivront sur vos autres appareils. Les IMAGES (références et bibliothèque) restent pour l'instant sur cet appareil.",
  error:
    "Le serveur n'a pas accepté la dernière modification. Elle n'est PAS enregistrée à distance : réessayez avant de fermer.",
};

export interface RepositoryResult<T> {
  state: SyncState;
  value: T;
  /** Message d'erreur lisible, `null` si tout va bien. */
  error: string | null;
}

/** Ligne de projet telle qu'elle vit en base. */
interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  charter: Project["charter"];
  palettes: Project["palettes"];
  family_rules: Project["familyRules"];
  default_width: number;
  default_height: number;
  archived: boolean;
  version: number;
  budget_limit_usd: number | null;
  created_at: string;
  updated_at: string;
}

function toProject(row: ProjectRow): Project {
  return {
    kind: "project",
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    charter: row.charter,
    palettes: row.palettes ?? [],
    defaultWidth: row.default_width,
    defaultHeight: row.default_height,
    familyRules: row.family_rules ?? [],
    archived: row.archived,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
    version: row.version,
    budget: {
      limitUsd: row.budget_limit_usd,
      measuredUsd: 0,
      unknownCostCount: 0,
      generations: 0,
    },
  };
}

function toRow(project: Project, ownerId: string): Record<string, unknown> {
  return {
    id: project.id,
    owner_id: ownerId,
    name: project.name,
    description: project.description,
    charter: project.charter,
    palettes: project.palettes,
    family_rules: project.familyRules,
    default_width: project.defaultWidth,
    default_height: project.defaultHeight,
    archived: project.archived,
    version: project.version,
    budget_limit_usd: project.budget.limitUsd,
  };
}

/** Accès HTTP à PostgREST au nom du compte connecté. */
async function restCall<T>(
  config: { url: string; anonKey: string },
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Le serveur a répondu ${response.status}. ${detail.slice(0, 200)}`);
  }

  const text = await response.text();
  return (text.length === 0 ? undefined : JSON.parse(text)) as T;
}

export interface RemoteAccess {
  config: { url: string; anonKey: string };
  token: string;
  ownerId: string;
}

/**
 * Charge les projets.
 *
 * Déconnecté : le cache. Connecté : la base, et le cache est rafraîchi ensuite
 * pour l'affichage hors ligne.
 */
export async function fetchProjects(
  remote: RemoteAccess | null,
): Promise<RepositoryResult<Project[]>> {
  if (remote === null) {
    return { state: "local-only", value: loadProjects(), error: null };
  }

  try {
    const rows = await restCall<ProjectRow[]>(
      remote.config,
      remote.token,
      "projects?select=*&order=updated_at.desc",
    );
    const projects = rows.map(toProject);
    // Le cache suit la base, jamais l'inverse.
    saveProjects(projects);
    return { state: "synced", value: projects, error: null };
  } catch (error) {
    // On rend le cache POUR AFFICHER, en signalant clairement l'erreur : ce
    // n'est pas un succès, et l'interface doit le montrer comme tel.
    return {
      state: "error",
      value: loadProjects(),
      error: `Impossible de lire vos projets sur le serveur. ${String(error)}`,
    };
  }
}

/** Crée un projet. Connecté, l'insertion distante fait foi. */
export async function createRemoteProject(
  remote: RemoteAccess | null,
  project: Project,
): Promise<RepositoryResult<Project>> {
  if (remote === null) {
    const projects = [project, ...loadProjects()];
    saveProjects(projects);
    return { state: "local-only", value: project, error: null };
  }

  try {
    const rows = await restCall<ProjectRow[]>(remote.config, remote.token, "projects", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(toRow({ ...project, ownerId: remote.ownerId }, remote.ownerId)),
    });
    const created = toProject(rows[0]);
    saveProjects([created, ...loadProjects().filter((p) => p.id !== created.id)]);
    return { state: "synced", value: created, error: null };
  } catch (error) {
    // Rien n'est écrit en cache : afficher un projet qui n'existe pas sur le
    // serveur serait mentir sur l'état réel.
    return {
      state: "error",
      value: project,
      error: `Le projet n'a PAS été créé sur le serveur. ${String(error)}`,
    };
  }
}

/**
 * Enregistre une modification avec contrôle de version.
 *
 * La condition `version=eq.N` est évaluée PAR LA BASE : si un autre appareil a
 * écrit entre-temps, aucune ligne ne correspond et la mise à jour ne touche
 * rien. C'est ce qui empêche l'écrasement silencieux.
 */
export async function saveProject(
  remote: RemoteAccess | null,
  current: Project,
  change: (project: Project) => Project,
): Promise<
  RepositoryResult<Project> & {
    conflict: Project | null;
    /**
     * Identifiant qu'avait le projet AVANT cet appel, quand il diffère de
     * `value.id`. C'est le cas d'un projet créé hors connexion et synchronisé
     * ici pour la première fois : son identifiant local n'était pas un UUID
     * valide pour Postgres, un nouveau lui est attribué. `null` sinon.
     * L'appelant s'en sert pour migrer ce qui, localement, pointait vers
     * l'ancien identifiant (les références de `IndexedDB`, l'onglet actif…).
     */
    previousId: string | null;
  }
> {
  const outcome: ConcurrencyOutcome<Project> = applyVersioned(
    current,
    current.version,
    change,
  );
  if (!outcome.ok) {
    return {
      state: "error",
      value: current,
      error: outcome.message,
      conflict: outcome.current,
      previousId: null,
    };
  }

  const next = outcome.next;

  if (remote === null) {
    saveProjects(loadProjects().map((p) => (p.id === next.id ? next : p)));
    return { state: "local-only", value: next, error: null, conflict: null, previousId: null };
  }

  /*
   * PREMIÈRE SYNCHRONISATION D'UN PROJET CRÉÉ HORS CONNEXION.
   *
   * Son identifiant local (par exemple un ancien `project-<uuid>` d'une
   * version antérieure, ou tout id non-UUID) n'est PAS accepté par la colonne
   * `uuid` de Postgres. Tenter un PATCH échouerait (22P02) ou, pire, ne
   * toucherait aucune ligne et serait pris à tort pour un conflit de version
   * avec un autre appareil. On crée donc la ligne distante avec un UUID
   * fraîchement généré — c'est une INSERTION, pas une mise à jour — et on
   * rend l'ancien identifiant à l'appelant pour qu'il propage le changement
   * localement. Rien n'est perdu : tous les champs de `next` sont recopiés
   * tels quels, seuls `id` et `version` sont réinitialisés comme pour tout
   * nouveau projet distant.
   */
  if (!isValidUuid(current.id)) {
    const migrated = await createRemoteProject(remote, {
      ...next,
      id: createProjectId(),
      version: 1,
    });

    if (migrated.error !== null) {
      // Échec réseau ou serveur : le projet local n'est PAS touché, rien
      // n'est perdu, l'ancien identifiant reste utilisable pour réessayer.
      return {
        state: migrated.state,
        value: current,
        error: migrated.error,
        conflict: null,
        previousId: null,
      };
    }

    // `createRemoteProject` a déjà ajouté la nouvelle entrée au cache ; on
    // retire l'ancienne pour ne pas laisser le même projet en double.
    saveProjects(loadProjects().filter((p) => p.id !== current.id));

    return {
      state: "synced",
      value: migrated.value,
      error: null,
      conflict: null,
      previousId: current.id,
    };
  }

  try {
    const rows = await restCall<ProjectRow[]>(
      remote.config,
      remote.token,
      `projects?id=eq.${encodeURIComponent(next.id)}&version=eq.${current.version}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(toRow(next, remote.ownerId)),
      },
    );

    if (rows.length === 0) {
      // Aucune ligne mise à jour : la version attendue n'existe plus.
      const fresh = await restCall<ProjectRow[]>(
        remote.config,
        remote.token,
        `projects?id=eq.${encodeURIComponent(next.id)}&select=*`,
      ).catch(() => [] as ProjectRow[]);

      return {
        state: "error",
        value: current,
        error:
          "Ce projet a été modifié sur un autre appareil. Vos changements n'ont PAS été enregistrés — rechargez pour voir la version à jour avant de recommencer.",
        conflict: rows.length === 0 && fresh.length > 0 ? toProject(fresh[0]) : null,
        previousId: null,
      };
    }

    const saved = toProject(rows[0]);
    saveProjects(loadProjects().map((p) => (p.id === saved.id ? saved : p)));
    return { state: "synced", value: saved, error: null, conflict: null, previousId: null };
  } catch (error) {
    return {
      state: "error",
      value: current,
      error: `Modification NON enregistrée sur le serveur. ${String(error)}`,
      conflict: null,
      previousId: null,
    };
  }
}
