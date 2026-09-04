/**
 * Configuration centrale de l'application.
 *
 * Tout ce qui est susceptible d'évoluer (modèle, limites, valeurs par défaut)
 * est regroupé ici pour éviter les constantes éparpillées dans le code.
 *
 * Les valeurs de ce fichier sont partagées client/serveur : elles ne doivent
 * JAMAIS contenir de secret. La clé API est lue uniquement dans
 * `src/lib/openai/client.ts`, côté serveur.
 */

/** Modèle d'image par défaut (surchargeable via OPENAI_IMAGE_MODEL). */
export const DEFAULT_IMAGE_MODEL = "gpt-image-2";

/** Limites appliquées aux entrées utilisateur (validées côté client ET serveur). */
export const LIMITS = {
  /** Longueur max du contexte permanent. */
  CONTEXT_MAX_CHARS: 8000,
  /** Longueur max de la demande ponctuelle. */
  REQUEST_MAX_CHARS: 2000,
  /** Nombre max d'images de référence envoyées à l'API (limite OpenAI : 16). */
  MAX_REFERENCES: 16,
  /** Taille max d'un fichier de référence envoyé au serveur. */
  MAX_FILE_BYTES: 4 * 1024 * 1024, // 4 Mo
  /**
   * Taille cumulée max de toutes les références d'une requête.
   * Volontairement conservateur : les plateformes serverless (Vercel, etc.)
   * plafonnent souvent le corps d'une requête autour de 4,5 Mo.
   */
  MAX_TOTAL_BYTES: 4 * 1024 * 1024, // 4 Mo
  /** Taille max d'un fichier accepté à l'import avant redimensionnement client. */
  MAX_IMPORT_BYTES: 20 * 1024 * 1024, // 20 Mo
  /** Côté max d'une référence : au-delà, l'image est réduite dans le navigateur. */
  MAX_REFERENCE_EDGE: 1536,
} as const;

/** Formats d'image acceptés en entrée (contrainte de l'API OpenAI Images). */
export const ACCEPTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type AcceptedImageMimeType = (typeof ACCEPTED_IMAGE_MIME_TYPES)[number];

/** Formats de sortie possibles. PNG et WebP supportent la transparence. */
export const OUTPUT_FORMATS = ["png", "webp", "jpeg"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Gestion du fond de l'image générée. */
export const BACKGROUND_MODES = ["transparent", "opaque", "auto"] as const;
export type BackgroundMode = (typeof BACKGROUND_MODES)[number];

/**
 * Résolutions proposées en un clic. La résolution peut aussi être saisie
 * librement (voir `SIZE_CONSTRAINTS` et `lib/validation/imageSize.ts`).
 */
export const IMAGE_SIZE_PRESETS = [
  "auto",
  "1024x1024",
  "1024x1536",
  "1536x1024",
] as const;
export type ImageSizePreset = (typeof IMAGE_SIZE_PRESETS)[number];

/**
 * Contraintes de résolution de `gpt-image-2`, vérifiées le 2026-08-27 dans la
 * documentation du SDK `openai@7.7.0` (`ImageEditParamsBase.size`) :
 *
 *   « arbitrary resolutions are supported as WIDTHxHEIGHT strings […] Width and
 *     height must both be divisible by 16 and the requested aspect ratio must be
 *     between 1:3 and 3:1 […] the maximum supported resolution is 3840x2160. »
 *
 * Les bornes en nombre total de pixels ne figurent pas dans le SDK ; elles sont
 * documentées par OpenAI et recoupées par plusieurs sources. Elles sont isolées
 * ici pour être corrigées d'un seul endroit si le modèle évolue.
 *
 * Conséquence importante : le modèle NE SAIT PAS produire une image de 64×64 px.
 * Les dimensions cibles d'une catégorie d'asset sont donc une contrainte de
 * prompt, distincte de la résolution envoyée à l'API.
 */
export const SIZE_CONSTRAINTS = {
  /** Largeur et hauteur doivent être des multiples de cette valeur. */
  MULTIPLE_OF: 16,
  /** Côté le plus long autorisé. */
  MAX_EDGE: 3840,
  /** Ratio maximal entre le grand et le petit côté (1:3 à 3:1). */
  MAX_ASPECT_RATIO: 3,
  /** Nombre total de pixels minimal (≈ 1024×640). */
  MIN_TOTAL_PIXELS: 655_360,
  /** Nombre total de pixels maximal (3840×2160). */
  MAX_TOTAL_PIXELS: 8_294_400,
  /** Au-delà, la résolution est signalée comme expérimentale par OpenAI. */
  EXPERIMENTAL_ABOVE_TOTAL_PIXELS: 2560 * 1440,
} as const;

/** Niveaux de qualité exposés dans l'interface. */
export const IMAGE_QUALITIES = ["auto", "low", "medium", "high"] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

/**
 * Réglages de génération par défaut (orientés assets de jeu vidéo).
 *
 * La taille finale est activée par défaut : c'est le mode qui livre un PNG
 * directement exploitable dans le jeu, et il économise des jetons puisque la
 * résolution de génération est choisie au plus juste.
 */
export const DEFAULT_GENERATION_SETTINGS = {
  finalSizeEnabled: true,
  finalWidth: 64,
  finalHeight: 64,
  qualityMode: "auto" as string,
  /** Grille native par défaut : c'est le mode qui produit de vrais sprites. */
  pixelPipeline: "grid" as string,

  /** Régime hérité : « auto », un preset, ou « LARGEURxHAUTEUR ». */
  size: "1024x1024" as string,
  quality: "high" as ImageQuality,

  background: "transparent" as BackgroundMode,
  outputFormat: "png" as OutputFormat,
} as const;

/** Longueurs maximales des champs propres aux Style Packs et catégories. */
export const NAME_LIMITS = {
  PACK_NAME_MAX_CHARS: 60,
  CATEGORY_NAME_MAX_CHARS: 40,
  CATEGORY_RULE_MAX_CHARS: 400,
  ASSET_NAME_MAX_CHARS: 80,
} as const;

/**
 * Tailles finales proposées en un clic, en pixels.
 *
 * Ce sont les dimensions de l'asset LIVRÉ, pas celles demandées au modèle :
 * `gpt-image-2` ne sait pas produire un 16 × 16, c'est le post-traitement
 * local qui l'obtient (voir `lib/image/postProcessing.ts`).
 */
export const FINAL_SIZE_PRESETS = [
  { width: 16, height: 16 },
  { width: 32, height: 32 },
  { width: 48, height: 48 },
  { width: 64, height: 64 },
  { width: 64, height: 96 },
  { width: 128, height: 128 },
] as const;

/** Bornes acceptées pour une taille finale saisie librement. */
export const FINAL_SIZE_LIMITS = {
  MIN: 1,
  /**
   * Au-delà, on sortirait du domaine des assets de jeu et le post-traitement
   * agrandirait le rendu au lieu de le réduire.
   */
  MAX: 2048,
} as const;

/**
 * Réglages de la chaîne « Pixel Cleanup » (V0.2.2).
 *
 * ---------------------------------------------------------------------------
 * LE PROBLÈME TRAITÉ
 * ---------------------------------------------------------------------------
 * GPT-Image-2 produit une illustration lisse : dégradés, bords anti-aliasés,
 * des centaines de teintes. Réduite telle quelle, elle donne un fichier à la
 * bonne dimension mais qui ne ressemble pas à un sprite — mesuré sur un rendu
 * type ramené en 64 × 64 : plus de 1300 couleurs pour 3200 pixels visibles.
 *
 * Ces constantes pilotent le nettoyage qui ramène la sortie à un vrai rendu
 * pixel-art. Elles sont regroupées ici pour être ajustables d'un seul endroit.
 * ---------------------------------------------------------------------------
 */
export const PIXEL_CLEANUP = {
  /**
   * Méthode de réduction depuis le rendu GPT.
   *
   * `area` (défaut) intègre tout le bloc source : silhouette fidèle et stable.
   * `nearest` retient un pixel sur N, ce qui sur une source lisse produit un
   * tirage arbitraire et bruité — c'est une des causes du « faux pixel art ».
   * Les valeurs intermédiaires créées par `area` sont supprimées juste après
   * par le seuillage alpha et la quantification.
   */
  DOWNSCALE_METHOD: "area" as "area" | "nearest",

  ALPHA: {
    /** En dessous : pixel effacé (poussière invisible). */
    INVISIBLE_BELOW: 24,
    /** Au-dessus : pixel rendu totalement opaque (halo terne). */
    OPAQUE_ABOVE: 200,
    /** Paliers d'alpha autorisés. 2 = transparence binaire, la plus nette. */
    LEVELS: 2,
  },

  PALETTE: {
    /** Couleurs maximales conservées dans le sprite final. */
    MAX_COLOURS: 32,
    /** En dessous de ce nombre de couleurs, l'image est laissée intacte. */
    SKIP_BELOW_COLOURS: 24,
  },

  /** Supprime les pixels visibles sans aucun voisin visible (bruit résiduel). */
  REMOVE_ISOLATED_PIXELS: true,
} as const;

/**
 * Réglages de la grille logique (V0.2.3).
 *
 * ---------------------------------------------------------------------------
 * L'IDÉE
 * ---------------------------------------------------------------------------
 * Plutôt que de laisser le modèle dessiner librement en haute résolution puis
 * de rattraper le tir, on lui demande de composer DÈS LE DÉPART sur une grille
 * logique : pour un sprite de 64 × 64 rendu en 832 × 832, chaque pixel final
 * correspond à un bloc de 13 × 13 pixels générés, censé être uniforme.
 *
 * La réduction devient alors une lecture bloc par bloc, exacte et sans
 * ambiguïté, au lieu d'un rééchantillonnage qui doit deviner.
 * ---------------------------------------------------------------------------
 */
export const LOGICAL_GRID = {
  /**
   * Surcoût maximal accepté pour obtenir une grille entière, rapporté à la
   * résolution la moins chère qui conviendrait sans grille.
   *
   * Mesuré sur les tailles visées : 16×16 et 48×48 ne coûtent rien de plus,
   * 32×32 et 64×64 coûtent +4 %, 64×96 +10 %, 128×128 +21 %. Une taille
   * bâtarde comme 100×75 exigerait +189 % — le repli s'y déclenche.
   *
   * Le plafond dépend du mode qualité : « éco » doit rester éco. Avec 1,25 il
   * couvre encore toutes les tailles visées (le pire cas, 128×128, coûte
   * +21 %) tout en refusant de payer +57 % pour aligner un 512×512.
   */
  MAX_COST_RATIO: { eco: 1.25, standard: 1.6, high: 2 } as Record<string, number>,

  /** Poids du score. La grille domine, le coût et le ratio corrigent. */
  WEIGHTS: {
    /** Grille entière ET identique sur les deux axes : le cas idéal. */
    UNIFORM_INTEGER: 100,
    /** Grille entière mais de facteurs différents en X et Y. */
    NON_UNIFORM_INTEGER: 60,
    /** Un seul axe tombe juste. */
    PARTIAL_INTEGER: 25,
    /** Pénalité par unité de surcoût (1,5× le coût mini => −40 × 0,5 = −20). */
    COST: 40,
    /** Pénalité par unité d'écart de rapport (2 % d'écart => −4). */
    ASPECT: 200,
  },

  /**
   * Critères de cohérence d'un bloc, calibrés sur mesures.
   *
   * Un écart absolu ne suffit pas à distinguer les deux cas : à ×13, une
   * illustration lisse a elle aussi des blocs presque plats. Mesuré :
   *
   *   grille respectée   — écart interne 0,00 · contraste entre blocs 68,6
   *   illustration lisse — écart interne 2,25 · contraste entre blocs  7,0
   *
   * Ce qui sépare vraiment les deux est le RAPPORT : un vrai pixel logique est
   * plat par rapport au saut qui le sépare de ses voisins ; une tranche de
   * dégradé varie presque autant à l'intérieur qu'à sa frontière.
   */
  BLOCK_COHERENCE: {
    /** Écart interne au-delà duquel un bloc est rejeté quoi qu'il arrive. */
    ABSOLUTE_TOLERANCE: 24,
    /** Écart interne toujours accepté : une zone réellement plate. */
    FLAT_EPSILON: 2,
    /** Part du contraste avec les voisins que l'écart interne peut atteindre. */
    RELATIVE_FACTOR: 0.15,
  },

  /** Seuils du libellé de fidélité de grille, en proportion de blocs cohérents. */
  FIDELITY_THRESHOLDS: { GOOD: 0.85, FAIR: 0.6 },

  /**
   * Méthode de réduction d'un bloc vers un pixel.
   * Comparée par test : `dominant` conserve les aplats d'un modèle qui respecte
   * la grille, `premultipliedMean` est plus stable quand il ne la respecte pas.
   */
  BLOCK_METHOD: "dominant" as "dominant" | "premultipliedMean" | "median",

  /** Recentre le sprite final par translation entière (aucun rééchantillonnage). */
  RECENTRE_FINAL: true,
} as const;

/**
 * Plafond de couleurs adapté à la taille finale.
 *
 * Un sprite de 16 × 16 n'a que ~200 pixels visibles : lui laisser 32 couleurs
 * produit un rendu inutilement riche — c'est la limite relevée en V0.2.2. La
 * table ci-dessous est interpolée linéairement sur le plus grand côté ; elle
 * est volontairement simple et modifiable d'un seul endroit.
 */
export const ADAPTIVE_PALETTE = [
  { edge: 16, colours: 12 },
  { edge: 32, colours: 20 },
  { edge: 48, colours: 24 },
  { edge: 64, colours: 32 },
  { edge: 128, colours: 48 },
] as const;

/**
 * Mode « Planche de personnage ».
 *
 * ---------------------------------------------------------------------------
 * POURQUOI UNE PLANCHE PLUTÔT QUE QUATRE GÉNÉRATIONS
 * ---------------------------------------------------------------------------
 * Générées séparément, les orientations d'un même personnage divergent : sur
 * des cellules de 48 × 48, on observe en pratique face 20 × 44 pieds à Y=45,
 * dos 16 × 42 pieds à Y=44, profil 16 × 40 pieds à Y=43. À l'usage, le
 * personnage « saute » quand on change de direction.
 *
 * Les vues sont donc demandées EN UNE SEULE IMAGE : le modèle voit ses propres
 * vues côte à côte et les tient cohérentes. La normalisation locale reprend
 * ensuite chaque cellule pour aligner exactement hauteur, centre et ligne de
 * pieds — sans jamais toucher au sprite maître.
 *
 * Disposition 2 × 2, qui est aussi le format de la planche exportée :
 *
 *     +------+------+
 *     | down |  up  |
 *     +------+------+
 *     | left | right|
 *     +------+------+
 *
 * En 48 px de cellule, la planche fait 96 × 96 : le modèle la rend en
 * 864 × 864, soit une grille logique de ×9 exactement.
 * ---------------------------------------------------------------------------
 */
export const CHARACTER_SHEET = {
  /** Côté d'une cellule, en pixels. */
  CELL_SIZE: 48,

  /**
   * Géométrie cible d'une cellule, exprimée pour `CELL_SIZE = 48`.
   *
   * `CENTRE_X` vaut (48 − 1) / 2 : une boîte de largeur paire s'y centre
   * exactement. `FEET_Y` laisse deux lignes vides sous les pieds, marge utile
   * pour une ombre ou un décalage d'animation ultérieurs.
   */
  TARGET: {
    CENTRE_X: 23.5,
    FEET_Y: 45,
  },

  /**
   * Écart de hauteur toléré avant redimensionnement. En deçà, on préfère
   * laisser la cellule intacte : un rééchantillonnage d'un seul pixel abîme
   * plus la silhouette qu'il ne l'aligne.
   */
  HEIGHT_TOLERANCE: 1,

  /** Écart de hauteur au-delà duquel la cellule passe en alerte puis en erreur. */
  STATUS_THRESHOLDS: { WARNING: 2 },

  /** Seuil d'alpha du passage en transparence binaire. */
  ALPHA_THRESHOLD: 128,

  /** Rapproche par défaut la palette des vues de celle du maître. */
  MATCH_MASTER_PALETTE: true,
} as const;

/** Facteur du second aperçu, destiné à juger la netteté pixel par pixel. */
export const PREVIEW_ZOOM_FACTOR = 8;

/** Nombre max d'assets conservés dans la bibliothèque locale. */
export const LIBRARY_MAX_ASSETS = 500;

/** Timeout de l'appel OpenAI (surchargeable via OPENAI_TIMEOUT_MS). */
export const DEFAULT_OPENAI_TIMEOUT_MS = 240_000;
