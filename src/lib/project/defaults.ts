/**
 * Valeurs initiales d'un projet.
 *
 * ---------------------------------------------------------------------------
 * AUCUNE RÈGLE DE PROJET N'EST CODÉE EN DUR
 * ---------------------------------------------------------------------------
 * Ce module fournit un SQUELETTE : familles présentes, cadrage par défaut,
 * dimensions courantes. Il ne contient la charte d'aucun univers particulier.
 *
 * « Timeless Journey » se crée donc comme n'importe quel projet : on le nomme
 * et on saisit sa charte. Rien dans le code ne connaît ses règles, ce qui
 * évite qu'un projet devienne un cas particulier impossible à faire évoluer.
 * ---------------------------------------------------------------------------
 */

import { ASSET_FAMILIES, emptyBudget, emptyCharter } from "@/types/project";
import type { AssetFamily, FamilyRule, FramingMode, Project } from "@/types/project";
import { createId } from "@/lib/storage/db";

/**
 * Cadrage par défaut de chaque famille.
 *
 * Les sols sont `seamless` : une tuile couvre toute la cellule et se raccorde
 * à ses voisines. Tout le reste est `isolated`. C'est le défaut, modifiable
 * famille par famille — mais c'est le bon défaut, et l'oublier produit des
 * sols troués.
 */
export const DEFAULT_FRAMING: Record<AssetFamily, FramingMode> = {
  personnages: "isolated",
  objets: "isolated",
  vegetation: "isolated",
  sols: "seamless",
  constructions: "isolated",
};

/** Dimensions couramment employées, purement indicatives. */
const DEFAULT_SIZES: Record<AssetFamily, [number, number]> = {
  personnages: [48, 48],
  objets: [32, 32],
  vegetation: [64, 64],
  sols: [32, 32],
  constructions: [128, 128],
};

export function createDefaultFamilyRules(): FamilyRule[] {
  return ASSET_FAMILIES.map((family) => ({
    family,
    // Volontairement vide : c'est à l'utilisateur d'écrire ses règles.
    rule: "",
    defaultWidth: DEFAULT_SIZES[family][0],
    defaultHeight: DEFAULT_SIZES[family][1],
    framing: DEFAULT_FRAMING[family],
    paletteId: null,
  }));
}

export function createProjectId(): string {
  return createId("project");
}

/** Crée un projet vierge. Le nom est la seule donnée obligatoire. */
export function createProject(options: {
  name: string;
  description?: string;
  ownerId?: string | null;
}): Project {
  const now = Date.now();
  return {
    kind: "project",
    id: createProjectId(),
    ownerId: options.ownerId ?? null,
    name: options.name.trim() || "Projet sans nom",
    description: options.description?.trim() ?? "",
    charter: emptyCharter(),
    palettes: [],
    defaultWidth: 48,
    defaultHeight: 48,
    familyRules: createDefaultFamilyRules(),
    archived: false,
    createdAt: now,
    updatedAt: now,
    version: 1,
    budget: emptyBudget(),
  };
}

/** Règle d'une famille, ou la règle par défaut si elle manque. */
export function familyRuleOf(project: Project, family: AssetFamily | null): FamilyRule {
  const found =
    family === null ? undefined : project.familyRules.find((rule) => rule.family === family);
  if (found !== undefined) return found;

  return {
    family: family ?? "objets",
    rule: "",
    defaultWidth: project.defaultWidth,
    defaultHeight: project.defaultHeight,
    framing: family === null ? "isolated" : DEFAULT_FRAMING[family],
    paletteId: null,
  };
}
