/**
 * Modèle de données de l'application.
 *
 * ---------------------------------------------------------------------------
 * SÉPARATION STRICTE : RÉFÉRENCES DE STYLE ≠ ASSETS GÉNÉRÉS
 * ---------------------------------------------------------------------------
 * Les deux familles d'images du projet ne doivent jamais être confondues :
 *
 *   StyleReference  — ENTRÉE. Image fournie par l'utilisateur, appartenant à un
 *                     Style Pack, envoyée à OpenAI comme référentiel graphique.
 *   GeneratedAsset  — SORTIE. Résultat d'une génération, rangé dans la
 *                     bibliothèque. N'est JAMAIS envoyé à OpenAI.
 *
 * Trois barrières empêchent la confusion :
 *   1. le champ littéral `kind`, qui rend les deux types incompatibles pour
 *      TypeScript — passer un `GeneratedAsset` là où un `StyleReference` est
 *      attendu ne compile pas ;
 *   2. deux object stores IndexedDB distincts, manipulés par deux modules
 *      distincts (`storage/styleReferences.ts` et `storage/generatedAssets.ts`) ;
 *   3. une assertion à l'exécution dans `lib/generation/payload.ts`, seul
 *      endroit qui prépare les fichiers envoyés à l'API.
 * ---------------------------------------------------------------------------
 */

import type {
  AcceptedImageMimeType,
  BackgroundMode,
  ImageQuality,
  OutputFormat,
} from "@/lib/config";

/* -------------------------------------------------------------------------- */
/* Catégories d'assets                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Catégorie d'asset : porte les dimensions CIBLES de l'objet produit.
 *
 * Attention à ne pas confondre avec la résolution de génération :
 *   - `targetWidth` / `targetHeight` sont une contrainte de PRODUCTION,
 *     injectée dans le prompt (« cet objet doit tenir dans 64×64 px ») ;
 *   - la résolution envoyée à l'API est un réglage séparé, soumis aux limites
 *     techniques du modèle (voir `SIZE_CONSTRAINTS` dans `lib/config.ts`).
 * Les deux sont volontairement dissociées : `gpt-image-2` ne sait pas produire
 * une image de 64×64 px, alors qu'un asset de 64×64 px reste un besoin légitime.
 */
export interface AssetCategory {
  id: string;
  name: string;
  /** Largeur cible de l'asset en pixels. `null` = aucune contrainte. */
  targetWidth: number | null;
  /** Hauteur cible de l'asset en pixels. `null` = aucune contrainte. */
  targetHeight: number | null;
  /** Règle textuelle courte ajoutée au prompt. Peut être vide. */
  rule: string;
}

/* -------------------------------------------------------------------------- */
/* Style Packs                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Configuration graphique d'un jeu ou d'un projet.
 *
 * Les métadonnées (ci-dessous) vivent dans `localStorage` ; les images de
 * référence, volumineuses, vivent dans IndexedDB et pointent vers `id` via
 * leur champ `packId`.
 */
export interface StylePack {
  id: string;
  name: string;
  /** Règles permanentes injectées dans chaque prompt de ce pack. */
  context: string;
  /** Catégories propres au pack. */
  categories: AssetCategory[];
  createdAt: number;
  updatedAt: number;
}

/* -------------------------------------------------------------------------- */
/* Références de style — ENTRÉE                                               */
/* -------------------------------------------------------------------------- */

/**
 * Image de référence appartenant à un Style Pack.
 *
 * Le champ `kind` est un discriminant littéral : il rend ce type structurellement
 * incompatible avec `GeneratedAsset`.
 */
export interface StyleReference {
  readonly kind: "style-reference";
  id: string;
  /** Style Pack propriétaire. Une référence n'existe jamais hors d'un pack. */
  packId: string;
  name: string;
  mimeType: AcceptedImageMimeType;
  size: number;
  width: number;
  height: number;
  /** Seules les références activées sont envoyées à la génération. */
  enabled: boolean;
  createdAt: number;
  order: number;
  blob: Blob;
}

/* -------------------------------------------------------------------------- */
/* Assets générés — SORTIE                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Mesures de qualité pixel-art conservées avec un asset.
 *
 * Utile pour repérer plus tard les assets à régénérer, sans avoir à réanalyser
 * toute la bibliothèque. `null` sur un asset enregistré avant la V0.2.2.
 */
export interface GeneratedAssetMetrics {
  colourCount: number;
  alphaLevelCount: number;
  semiTransparentPixels: number;
  verdict: string;
}

/** Réglages ayant produit un asset, conservés pour pouvoir les relire. */
export interface GeneratedAssetSettings {
  /** Résolution réellement demandée à l'API (« auto » ou « LARGEURxHAUTEUR »). */
  size: string;
  quality: ImageQuality;
  background: BackgroundMode;
  outputFormat: OutputFormat;
  model: string;
  referenceCount: number;
  /**
   * Mode qualité demandé, et son libellé une fois « Auto » résolu.
   * `null` sur un asset enregistré avant la V0.2.1.
   */
  qualityMode?: string | null;
  qualityModeLabel?: string | null;
  /** `true` si la résolution retenue était la plus petite compatible. */
  minimalResolution?: boolean;
  /** `true` si l'image a été ramenée localement à sa taille finale. */
  postProcessed?: boolean;
}

/**
 * Asset rangé dans la bibliothèque.
 *
 * Le blob stocké est TOUJOURS l'image finale post-traitée, celle qui est
 * exploitable dans le jeu. Le rendu brut de l'API n'est jamais conservé : il
 * n'aurait servi à rien et aurait alourdi le stockage.
 *
 * ATTENTION — c'est un RÉSULTAT. Aucun code du chemin de génération ne doit
 * lire ce type : la bibliothèque est un cul-de-sac, pas une source. Le champ
 * `kind` garantit qu'un tel objet ne peut pas être passé là où une
 * `StyleReference` est attendue.
 */
export interface GeneratedAsset {
  readonly kind: "generated-asset";
  id: string;
  name: string;
  createdAt: number;
  /** Pack actif au moment de la génération (nom figé : le pack peut être renommé). */
  packId: string;
  packName: string;
  /** Catégorie utilisée, figée de la même manière. */
  categoryName: string | null;
  targetWidth: number | null;
  targetHeight: number | null;
  /**
   * Dimensions du PNG effectivement stocké.
   *
   * C'est la taille de l'asset LIVRÉ, après post-traitement — pas la
   * résolution de génération, conservée à part dans `settings.size`.
   * `null` sur un asset enregistré avant la V0.2.1, ou livré en rendu brut.
   */
  finalWidth?: number | null;
  finalHeight?: number | null;
  /** Demande utilisateur ayant produit l'asset. */
  request: string;
  settings: GeneratedAssetSettings;
  usage: TokenUsage | null;
  /** Qualité pixel-art mesurée sur le sprite livré. */
  metrics?: GeneratedAssetMetrics | null;
  mimeType: string;
  blob: Blob;
}

/* -------------------------------------------------------------------------- */
/* Usage API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Consommation de jetons remontée par l'API.
 * Chaque champ vaut `null` lorsque l'API ne fournit pas la donnée : rien
 * n'est jamais inventé ni estimé à la place.
 */
export interface TokenUsage {
  textInputTokens: number | null;
  imageInputTokens: number | null;
  imageOutputTokens: number | null;
  totalTokens: number | null;
}

/** Compteur cumulatif local, purement indicatif. */
export interface UsageTotals {
  generations: number;
  textInputTokens: number;
  imageInputTokens: number;
  imageOutputTokens: number;
  totalTokens: number;
}
