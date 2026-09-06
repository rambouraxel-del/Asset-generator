/**
 * Export et import portables d'un projet.
 *
 * ---------------------------------------------------------------------------
 * CE N'EST PAS UNE SAUVEGARDE AUTOMATIQUE
 * ---------------------------------------------------------------------------
 * Ce format est un export MANUEL, déclenché par l'utilisateur, destiné à
 * déplacer un projet ou à en garder une copie hors ligne. Il ne remplace pas
 * une sauvegarde régulière de la base ET du stockage de fichiers : voir la
 * procédure dans le README. Sauvegarder la base ne sauvegarde PAS les images,
 * qui vivent ailleurs.
 *
 * ---------------------------------------------------------------------------
 * FORMAT
 * ---------------------------------------------------------------------------
 * Un seul fichier JSON versionné, images comprises en base64. Choix assumé :
 * aucune dépendance d'archivage n'est ajoutée, le fichier reste lisible et
 * vérifiable, et des sprites pixel art pèsent quelques centaines d'octets
 * chacun. Pour une bibliothèque de plusieurs milliers d'images, ce format
 * devient lourd — c'est sa limite, documentée plutôt que masquée.
 * ---------------------------------------------------------------------------
 */

import type { AssetVariantKind } from "@/lib/library/variants";
import type { Project } from "@/types/project";

/** Version du format. Toute rupture l'incrémente ; l'import refuse l'inconnu. */
export const MANIFEST_VERSION = 1;

export interface PortableImage {
  /** Identifiant local dans le manifeste, pas un identifiant de base. */
  ref: string;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  /** Contenu encodé en base64, sans préfixe `data:`. */
  base64: string;
}

export interface PortableAsset {
  id: string;
  name: string;
  createdAt: number;
  family: string | null;
  /** Une entrée par variante conservée. */
  variants: Array<{ kind: AssetVariantKind; ref: string }>;
}

export interface PortableReference {
  id: string;
  name: string;
  validated: boolean;
  pinned: boolean;
  families: string[];
  ref: string;
}

export interface ProjectManifest {
  manifestVersion: number;
  exportedAt: number;
  /** Version de l'application ayant produit l'export, à titre informatif. */
  appVersion: string;
  project: Omit<Project, "kind">;
  assets: PortableAsset[];
  references: PortableReference[];
  images: PortableImage[];
}

export type ValidationIssue = {
  severity: "error" | "warning";
  message: string;
};

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  manifest: ProjectManifest | null;
}

/**
 * Vérifie un manifeste avant import.
 *
 * Refuse plutôt que de deviner : un manifeste d'une version inconnue, une
 * image manquante ou une référence orpheline sont des erreurs, pas des
 * approximations à rattraper en silence.
 */
export function validateManifest(raw: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (typeof raw !== "object" || raw === null) {
    return { valid: false, issues: [err("Le fichier n'est pas un manifeste JSON valide.")], manifest: null };
  }

  const candidate = raw as Partial<ProjectManifest>;

  if (typeof candidate.manifestVersion !== "number") {
    return { valid: false, issues: [err("Version de manifeste absente.")], manifest: null };
  }
  if (candidate.manifestVersion > MANIFEST_VERSION) {
    return {
      valid: false,
      issues: [
        err(
          `Ce fichier vient d'une version plus récente de l'application (format ${candidate.manifestVersion}, cette version lit jusqu'à ${MANIFEST_VERSION}). Mettez l'application à jour avant d'importer.`,
        ),
      ],
      manifest: null,
    };
  }

  if (typeof candidate.project !== "object" || candidate.project === null) {
    return { valid: false, issues: [err("Le manifeste ne contient aucun projet.")], manifest: null };
  }

  const images = Array.isArray(candidate.images) ? candidate.images : [];
  const assets = Array.isArray(candidate.assets) ? candidate.assets : [];
  const references = Array.isArray(candidate.references) ? candidate.references : [];

  const available = new Set(images.map((image) => image.ref));

  for (const image of images) {
    if (typeof image.base64 !== "string" || image.base64.length === 0) {
      issues.push(err(`Image « ${image.name ?? image.ref} » vide ou illisible.`));
    }
  }

  // Une variante qui pointe vers une image absente rendrait l'asset incomplet.
  for (const asset of assets) {
    for (const variant of asset.variants ?? []) {
      if (!available.has(variant.ref)) {
        issues.push(
          err(`L'asset « ${asset.name} » référence une image manquante (${variant.ref}).`),
        );
      }
    }
  }

  for (const reference of references) {
    if (!available.has(reference.ref)) {
      issues.push(err(`La référence « ${reference.name} » pointe vers une image manquante.`));
    }
  }

  const valid = issues.every((issue) => issue.severity !== "error");
  return { valid, issues, manifest: valid ? (candidate as ProjectManifest) : null };
}

/** Conflits détectés entre un manifeste et ce qui existe déjà en local. */
export interface ImportConflict {
  kind: "projet" | "asset" | "référence";
  id: string;
  name: string;
  message: string;
}

/**
 * Compare un manifeste à l'existant et liste les conflits.
 *
 * Ne décide rien : l'utilisateur choisit ensuite entre ignorer, dupliquer ou
 * remplacer. Importer sans le lui demander écraserait potentiellement des
 * retouches manuelles.
 */
export function detectConflicts(
  manifest: ProjectManifest,
  existing: { projectIds: string[]; assetIds: string[]; referenceIds: string[] },
): ImportConflict[] {
  const conflicts: ImportConflict[] = [];

  if (existing.projectIds.includes(manifest.project.id)) {
    conflicts.push({
      kind: "projet",
      id: manifest.project.id,
      name: manifest.project.name,
      message: "Un projet portant cet identifiant existe déjà.",
    });
  }

  const assetIds = new Set(existing.assetIds);
  for (const asset of manifest.assets) {
    if (assetIds.has(asset.id)) {
      conflicts.push({
        kind: "asset",
        id: asset.id,
        name: asset.name,
        message: "Cet asset existe déjà ; l'importer pourrait écraser une retouche manuelle.",
      });
    }
  }

  const referenceIds = new Set(existing.referenceIds);
  for (const reference of manifest.references) {
    if (referenceIds.has(reference.id)) {
      conflicts.push({
        kind: "référence",
        id: reference.id,
        name: reference.name,
        message: "Cette référence existe déjà.",
      });
    }
  }

  return conflicts;
}

function err(message: string): ValidationIssue {
  return { severity: "error", message };
}
