/**
 * Reprise de l'ancienne bibliothèque locale vers un projet.
 *
 * ---------------------------------------------------------------------------
 * FORMAT RÉELLEMENT EN PLACE (relevé dans le code existant, pas supposé)
 * ---------------------------------------------------------------------------
 *   localStorage
 *     asset-generator:packs         → StylePack[] (nom, contexte, catégories)
 *     asset-generator:activePackId  → string
 *     asset-generator:settings      → GenerationSettings
 *     asset-generator:usageTotals   → UsageTotals
 *
 *   IndexedDB « asset-generator », version 2
 *     styleReferences  (clé « id », index « packId »)  → images de référence
 *     generatedAssets  (clé « id », index « createdAt ») → bibliothèque
 *
 * ---------------------------------------------------------------------------
 * TROIS RÈGLES
 * ---------------------------------------------------------------------------
 *   1. ON COPIE, ON NE DÉPLACE PAS. Les données d'origine restent intactes :
 *      en cas de problème, l'ancienne bibliothèque est toujours là.
 *   2. AUCUN DOUBLON. Un identifiant déjà importé est ignoré, ce qui rend
 *      l'import rejouable sans dégât.
 *   3. AUCUNE PROMOTION AUTOMATIQUE EN RÉFÉRENCE. Les anciens assets arrivent
 *      comme assets, avec `validated: false`. Les transformer en références
 *      validées ferait dériver la cohérence du projet sans décision humaine.
 *
 * ---------------------------------------------------------------------------
 * LIMITE IMPORTANTE : L'ADRESSE DU SITE
 * ---------------------------------------------------------------------------
 * `localStorage` et IndexedDB sont cloisonnés PAR ORIGINE (protocole + domaine
 * + port). Si l'application change d'adresse, les anciennes données ne sont
 * pas lisibles depuis la nouvelle : le navigateur les considère comme
 * appartenant à un autre site. Il faut alors ouvrir l'ANCIENNE adresse, y
 * exporter le projet (export portable), puis importer ce fichier sur la
 * nouvelle. Aucun code ne peut contourner cette barrière — c'est une
 * protection du navigateur, pas une limite de l'application.
 * ---------------------------------------------------------------------------
 */

import type { AssetFamily } from "@/types/project";

/** Ce qu'on a trouvé dans le stockage local, avant toute écriture. */
export interface LegacyScan {
  packs: Array<{ id: string; name: string; context: string; categoryCount: number }>;
  referenceCount: number;
  assetCount: number;
  /** `true` si rien d'exploitable n'a été trouvé à cette adresse. */
  empty: boolean;
  /** Origine consultée, affichée pour lever l'ambiguïté d'adresse. */
  origin: string;
}

export interface LegacyAssetLike {
  id: string;
  name: string;
  createdAt: number;
  finalWidth?: number | null;
  finalHeight?: number | null;
  categoryName?: string | null;
}

export interface LegacyReferenceLike {
  id: string;
  name: string;
  packId: string;
  createdAt: number;
}

export interface ImportPlan {
  assets: LegacyAssetLike[];
  references: LegacyReferenceLike[];
  /** Éléments ignorés parce que déjà présents. */
  skippedAssets: number;
  skippedReferences: number;
  /** Familles devinées, à confirmer par l'utilisateur. Jamais appliquées seules. */
  guessedFamilies: Record<string, AssetFamily>;
}

/**
 * Prépare l'import sans rien écrire.
 *
 * Fonction pure : on peut la montrer à l'utilisateur avant de valider, et la
 * tester sans navigateur.
 */
export function planLegacyImport(input: {
  assets: LegacyAssetLike[];
  references: LegacyReferenceLike[];
  existingAssetIds: string[];
  existingReferenceIds: string[];
}): ImportPlan {
  const knownAssets = new Set(input.existingAssetIds);
  const knownReferences = new Set(input.existingReferenceIds);

  // Un même identifiant peut apparaître deux fois dans une source abîmée :
  // on dédoublonne aussi à l'intérieur du lot.
  const seenAssets = new Set<string>();
  const assets: LegacyAssetLike[] = [];
  let skippedAssets = 0;

  for (const asset of input.assets) {
    if (knownAssets.has(asset.id) || seenAssets.has(asset.id)) {
      skippedAssets += 1;
      continue;
    }
    seenAssets.add(asset.id);
    assets.push(asset);
  }

  const seenReferences = new Set<string>();
  const references: LegacyReferenceLike[] = [];
  let skippedReferences = 0;

  for (const reference of input.references) {
    if (knownReferences.has(reference.id) || seenReferences.has(reference.id)) {
      skippedReferences += 1;
      continue;
    }
    seenReferences.add(reference.id);
    references.push(reference);
  }

  const guessedFamilies: Record<string, AssetFamily> = {};
  for (const asset of assets) {
    const guess = guessFamily(asset.categoryName ?? asset.name);
    if (guess !== null) guessedFamilies[asset.id] = guess;
  }

  return { assets, references, skippedAssets, skippedReferences, guessedFamilies };
}

/**
 * Devine une famille à partir d'un libellé.
 *
 * Comptage de mots, volontairement simple : c'est une SUGGESTION affichée à
 * l'utilisateur, jamais une classification appliquée d'office. Aucun appel à
 * une IA n'intervient ici.
 *
 * Le comptage — plutôt qu'un « premier qui correspond » — traite les libellés
 * mixtes : « tuile de sol herbeuse » contient un mot de végétation, mais deux
 * mots de sol, et c'est bien un sol. En cas d'ÉGALITÉ, aucune suggestion n'est
 * faite : mieux vaut laisser l'utilisateur trancher qu'annoncer un classement
 * tiré au sort.
 */
export function guessFamily(label: string): AssetFamily | null {
  const text = label.toLowerCase();
  const table: Array<[AssetFamily, string[]]> = [
    ["personnages", ["personnage", "héros", "heros", "pnj", "character"]],
    ["vegetation", ["arbre", "buisson", "fleur", "plante", "herbe", "chêne", "chene"]],
    ["sols", ["sol", "tuile", "tile", "terrain", "dalle", "pavé", "pave"]],
    ["constructions", ["maison", "mur", "bâtiment", "batiment", "toit", "pont", "tour"]],
    ["objets", ["objet", "potion", "épée", "epee", "coffre", "clé", "cle", "outil"]],
  ];

  const scores = table
    .map(([family, needles]) => ({
      family,
      score: needles.filter((needle) => text.includes(needle)).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scores.length === 0) return null;
  // Égalité au sommet : on ne devine pas.
  if (scores.length > 1 && scores[0].score === scores[1].score) return null;
  return scores[0].family;
}

/** Message expliquant la limite d'origine, réutilisé par l'interface. */
export const ORIGIN_LIMITATION_NOTICE =
  "Les données du navigateur appartiennent à l'adresse exacte du site. Si l'application a changé d'adresse, ouvrez l'ancienne adresse, exportez-y le projet, puis importez ce fichier ici — le navigateur interdit tout autre accès.";
