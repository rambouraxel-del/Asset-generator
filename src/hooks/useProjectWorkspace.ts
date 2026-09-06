"use client";

/**
 * État du mode projet : session, projets, synchronisation.
 *
 * ---------------------------------------------------------------------------
 * L'ÉTAT DE SYNCHRONISATION EST UNE DONNÉE DE PREMIÈRE CLASSE
 * ---------------------------------------------------------------------------
 * `syncState` n'est pas un détail d'affichage : c'est ce qui dit à
 * l'utilisateur si son travail est à l'abri. Il vaut toujours l'un de quatre
 * états — local uniquement, synchronisation, synchronisé, erreur — et une
 * erreur distante n'est jamais convertie en succès.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  clearSession,
  ensureFreshSession,
  isAuthAvailable,
  loadSession,
  publicConfig,
  signIn as doSignIn,
  signOut as doSignOut,
  type Session,
} from "@/lib/client/supabaseAuth";
import { createProject } from "@/lib/project/defaults";
import {
  createRemoteProject,
  fetchProjects,
  saveProject as persistProject,
  type RemoteAccess,
  type SyncState,
} from "@/lib/project/repository";
import { loadActiveProjectId, saveActiveProjectId } from "@/lib/storage/projects";
import type { Project } from "@/types/project";

export function useProjectWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("local-only");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const authAvailable = isAuthAvailable();

  const remote: RemoteAccess | null = useMemo(() => {
    const config = publicConfig();
    if (config === null || session === null) return null;
    return { config, token: session.accessToken, ownerId: session.userId };
  }, [session]);

  /** Recharge depuis la source qui fait autorité. */
  const refresh = useCallback(
    async (access: RemoteAccess | null) => {
      setSyncState(access === null ? "local-only" : "syncing");
      const result = await fetchProjects(access);
      setProjects(result.value);
      setSyncState(result.state);
      setError(result.error);
    },
    [],
  );

  // Reprise de session au chargement.
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const existing = loadSession();
      const fresh = existing === null ? null : await ensureFreshSession();
      if (cancelled) return;

      setSession(fresh);
      const config = publicConfig();
      const access: RemoteAccess | null =
        config === null || fresh === null
          ? null
          : { config, token: fresh.accessToken, ownerId: fresh.userId };

      await refresh(access);
      if (!cancelled) {
        setActiveId(loadActiveProjectId());
        setLoading(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      try {
        const next = await doSignIn(email, password);
        setSession(next);
        const config = publicConfig();
        await refresh(
          config === null ? null : { config, token: next.accessToken, ownerId: next.userId },
        );
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Connexion impossible.");
        return false;
      }
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    await doSignOut();
    clearSession();
    setSession(null);
    // On repart du cache local : les projets distants ne sont plus à nous.
    await refresh(null);
  }, [refresh]);

  const selectProject = useCallback((id: string) => {
    setActiveId(id);
    saveActiveProjectId(id);
  }, []);

  const addProject = useCallback(
    async (name: string, description: string) => {
      setSyncState(remote === null ? "local-only" : "syncing");
      setError(null);

      const draft = createProject({ name, description, ownerId: session?.userId ?? null });
      const result = await createRemoteProject(remote, draft);

      setSyncState(result.state);
      setError(result.error);

      if (result.error === null) {
        setProjects((current) => [result.value, ...current]);
        selectProject(result.value.id);
        return result.value;
      }
      return null;
    },
    [remote, session, selectProject],
  );

  const updateProject = useCallback(
    async (project: Project, change: (value: Project) => Project) => {
      setSyncState(remote === null ? "local-only" : "syncing");
      setError(null);
      setConflict(null);

      const result = await persistProject(remote, project, change);

      setSyncState(result.state);
      setError(result.error);
      setConflict(result.conflict);

      if (result.error === null) {
        setProjects((current) =>
          current.map((entry) => (entry.id === result.value.id ? result.value : entry)),
        );
      }
      return result;
    },
    [remote],
  );

  /** Accepte la version du serveur après un conflit, sans rien écraser. */
  const acceptRemoteVersion = useCallback(() => {
    if (conflict === null) return;
    setProjects((current) =>
      current.map((entry) => (entry.id === conflict.id ? conflict : entry)),
    );
    setConflict(null);
    setError(null);
  }, [conflict]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeId && !project.archived) ?? null,
    [projects, activeId],
  );

  return {
    loading,
    authAvailable,
    session,
    signIn,
    signOut,
    projects,
    visibleProjects: useMemo(() => projects.filter((p) => !p.archived), [projects]),
    archivedProjects: useMemo(() => projects.filter((p) => p.archived), [projects]),
    activeProject,
    selectProject,
    addProject,
    updateProject,
    syncState,
    error,
    conflict,
    acceptRemoteVersion,
    clearError: useCallback(() => setError(null), []),
    reload: useCallback(() => refresh(remote), [refresh, remote]),
  };
}
