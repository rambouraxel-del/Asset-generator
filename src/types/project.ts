/**
 * Modèle de données du mode projet.
 *
 * ---------------------------------------------------------------------------
 * UN PROJET EST UNE MÉMOIRE STRUCTURÉE, PAS UN HISTORIQUE
 * ---------------------------------------------------------------------------
 * Tout ce qui décrit l'univers graphique est rangé en champs typés : charte,
 * palettes, dimensions, règles par famille, références validées. Le prompt est
 * ensuite ASSEMBLÉ à partir de ces champs (voir `lib/project/contextBuilder.ts`).
 *
 * Rien n'est jamais résumé par une IA, et l'historique des générations n'est
 * jamais renvoyé au modèle : ce sont deux propriétés que toute évolution doit
 * préserver.
 *
 * ---------------------------------------------------------------------------
 * L'HISTORIQUE EST FIGÉ
 * ---------------------------------------------------------------------------
 * Une génération conserve une COPIE des règles, références et paramètres
 * réellement employés (`GenerationRecord.snapshot`). Modifier la charte plus
 * tard ne réécrit donc pas le passé : on peut toujours savoir avec quoi un
 * asset a été produit.
 * ---------------------------------------------------------------------------
 */

/** Familles d'assets. Chacune porte ses propres contraintes de cadrage. */
export const ASSET_FAMILIES = [
  "personnages",
  "objets",
  "vegetation",
  "sols",
  "constructions",
] as const;

export type AssetFamily = (typeof ASSET_FAMILIES)[number];

export const FAMILY_LABELS: Record<AssetFamily, string> = {
  personnages: "Personnages",
  objets: "Objets",
  vegetation: "Végétation",
  sols: "Sols",
  constructions: "Constructions",
};

/**
 * Mode de cadrage d'une famille.
 *
 * C'est la distinction qui évitait un vrai défaut : une tuile de sol doit
 * couvrir toute la cellule et se raccorder à ses voisines, alors qu'un objet
 * isolé doit au contraire garder une marge transparente autour de lui.
 * Appliquer la même consigne aux deux produit des sols troués.
 */
export type FramingMode = "isolated" | "seamless";

export const FRAMING_LABELS: Record<FramingMode, string> = {
  isolated: "Objet isolé (marge transparente autour)",
  seamless: "Tuile couvrante (bord à bord, raccordable)",
};

/**
 * Charte graphique structurée.
 *
 * Six champs volontairement courts et séparés : ils sont assemblés tels quels
 * dans le prompt, sans reformulation. Un champ vide est simplement omis.
 */
export interface StyleCharter {
  perspective: string;
  lighting: string;
  outlines: string;
  detailLevel: string;
  proportions: string;
  scale: string;
}

export const CHARTER_FIELDS: ReadonlyArray<{
  key: keyof StyleCharter;
  label: string;
  hint: string;
  placeholder: string;
}> = [
  {
    key: "perspective",
    label: "Perspective",
    hint: "Angle de vue commun à tous les assets.",
    placeholder: "Vue de dessus légèrement inclinée, environ 3/4.",
  },
  {
    key: "lighting",
    label: "Éclairage",
    hint: "Direction et dureté de la lumière.",
    placeholder: "Lumière douce venant du haut à gauche, ombres courtes.",
  },
  {
    key: "outlines",
    label: "Contours",
    hint: "Présence et couleur des contours.",
    placeholder: "Contour sombre d'un pixel, jamais noir pur.",
  },
  {
    key: "detailLevel",
    label: "Niveau de détail",
    hint: "Quantité de détail acceptable à cette échelle.",
    placeholder: "Détail modéré, silhouette lisible avant tout.",
  },
  {
    key: "proportions",
    label: "Proportions",
    hint: "Stylisation des proportions.",
    placeholder: "Proportions légèrement trapues, tête un peu grande.",
  },
  {
    key: "scale",
    label: "Échelle",
    hint: "Référence de taille commune au projet.",
    placeholder: "Un humain adulte mesure 48 pixels de haut.",
  },
];

export function emptyCharter(): StyleCharter {
  return {
    perspective: "",
    lighting: "",
    outlines: "",
    detailLevel: "",
    proportions: "",
    scale: "",
  };
}

/** Palette nommée du projet. Les couleurs sont des `#rrggbb`. */
export interface ProjectPalette {
  id: string;
  name: string;
  colours: string[];
}

/** Règles et cadrage propres à une famille. */
export interface FamilyRule {
  family: AssetFamily;
  /** Consigne libre, ajoutée au prompt pour cette famille uniquement. */
  rule: string;
  /** Dimensions par défaut proposées pour cette famille. */
  defaultWidth: number | null;
  defaultHeight: number | null;
  framing: FramingMode;
  /** Palette imposée à cette famille, ou `null` pour celle du projet. */
  paletteId: string | null;
}

/** Plafond de dépense propre au projet, purement indicatif côté navigateur. */
export interface ProjectBudget {
  /** Plafond souhaité en dollars, ou `null` si aucun. */
  limitUsd: number | null;
  /** Coût mesuré cumulé (usage réellement renvoyé par l'API). */
  measuredUsd: number;
  /** Générations dont le coût n'a pas pu être calculé. Jamais compté comme 0. */
  unknownCostCount: number;
  generations: number;
}

export function emptyBudget(): ProjectBudget {
  return { limitUsd: null, measuredUsd: 0, unknownCostCount: 0, generations: 0 };
}

/**
 * Projet.
 *
 * `version` sert la détection de modification concurrente : toute écriture
 * fournit la version qu'elle croit à jour, et le serveur refuse si elle a
 * changé entre-temps (voir `lib/project/concurrency.ts`).
 */
export interface Project {
  readonly kind: "project";
  id: string;
  /** Propriétaire. `null` tant que la synchronisation n'est pas activée. */
  ownerId: string | null;
  name: string;
  description: string;
  charter: StyleCharter;
  palettes: ProjectPalette[];
  defaultWidth: number;
  defaultHeight: number;
  familyRules: FamilyRule[];
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  version: number;
  budget: ProjectBudget;
}

/* -------------------------------------------------------------------------- */
/* Historique des générations                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Copie figée de ce qui a réellement servi à une génération.
 *
 * C'est ce qui rend l'historique fiable : la charte peut changer ensuite, ce
 * bloc ne bouge pas.
 */
export interface GenerationSnapshot {
  projectName: string;
  charter: StyleCharter;
  family: AssetFamily | null;
  familyRule: string;
  framing: FramingMode;
  /** Couleurs imposées au moment de la génération. */
  palette: string[];
  /** Identifiants ET noms des références envoyées, figés. */
  references: Array<{ id: string; name: string }>;
  /** Prompt intégral réellement envoyé. */
  prompt: string;
  /** Paramètres de sortie effectifs. */
  settings: {
    finalWidth: number | null;
    finalHeight: number | null;
    qualityMode: string;
    pixelPipeline: string;
    background: string;
  };
}

/** Statut de coût. « Inconnu » n'est jamais assimilé à zéro. */
export type CostStatus = "measured" | "estimated" | "unknown";

export interface GenerationCost {
  status: CostStatus;
  /** Montant en dollars ; `null` quand le statut est `unknown`. */
  amountUsd: number | null;
  /** Version des tarifs employés, pour pouvoir recalculer plus tard. */
  pricingVersion: string | null;
}

export interface GenerationRecord {
  readonly kind: "generation-record";
  id: string;
  projectId: string;
  ownerId: string | null;
  createdAt: number;
  /** Mode employé : asset unique ou planche. */
  mode: "single" | "sheet";
  request: string;
  model: string;
  /** Qualité réellement demandée à l'API. */
  quality: string;
  generationSize: string;
  snapshot: GenerationSnapshot;
  cost: GenerationCost;
  /** Identifiants des assets produits. */
  assetIds: string[];
}

/* -------------------------------------------------------------------------- */
/* Références validées du projet                                              */
/* -------------------------------------------------------------------------- */

/**
 * Image de référence appartenant à un projet.
 *
 * `validated` n'est JAMAIS mis à `true` automatiquement : reprendre l'ancienne
 * bibliothèque n'en fait pas des références, et un asset généré non plus. C'est
 * un acte explicite de l'utilisateur, sans quoi la cohérence du projet
 * dériverait sans qu'il l'ait décidé.
 */
export interface ProjectReference {
  readonly kind: "project-reference";
  id: string;
  projectId: string;
  ownerId: string | null;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  size: number;
  /** Validée explicitement par l'utilisateur. Défaut : false. */
  validated: boolean;
  /** Toujours proposée en premier, quelle que soit la famille. */
  pinned: boolean;
  /** Familles concernées. Vide = vaut pour tout le projet. */
  families: AssetFamily[];
  createdAt: number;
  blob: Blob;
}
