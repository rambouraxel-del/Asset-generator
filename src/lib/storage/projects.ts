"use client";

/**
 * Persistance locale des projets.
 *
 * ---------------------------------------------------------------------------
 * CACHE, PAS SOURCE DE VÉRITÉ
 * ---------------------------------------------------------------------------
 * `localStorage` est ici un CACHE de travail : il rend l'application utilisable
 * hors ligne et instantanée au chargement. Il n'est pas la mémoire durable du
 * projet — celle-ci vit en base (voir `supabase/migrations/`), seule à survivre
 * à un changement d'appareil, à un vidage du navigateur ou à un changement
 * d'adresse du site.
 *
 * Tant que la base n'est pas configurée, ce cache est effectivement le seul
 * stockage, et l'interface le dit clairement plutôt que de laisser croire à
 * une synchronisation qui n'existe pas.
 * ---------------------------------------------------------------------------
 */

import type { Project } from "@/types/project";

const PROJECTS_KEY = "asset-generator:projects";
const ACTIVE_PROJECT_KEY = "asset-generator:activeProjectId";

export function loadProjects(): Project[] {
  try {
    const raw = window.localStorage.getItem(PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isProject) : [];
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]): void {
  try {
    window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // Le cache peut échouer (quota, navigation privée) sans casser l'app.
  }
}

export function loadActiveProjectId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function saveActiveProjectId(id: string): void {
  try {
    window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
  } catch {
    // idem
  }
}

/** Contrôle minimal : un objet relu du stockage n'est pas typé à l'exécution. */
function isProject(value: unknown): value is Project {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Project>;
  return (
    candidate.kind === "project" &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.version === "number"
  );
}
