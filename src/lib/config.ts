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

/** Facteur du second aperçu, destiné à juger la netteté pixel par pixel. */
export const PREVIEW_ZOOM_FACTOR = 8;

/** Nombre max d'assets conservés dans la bibliothèque locale. */
export const LIBRARY_MAX_ASSETS = 500;

/** Timeout de l'appel OpenAI (surchargeable via OPENAI_TIMEOUT_MS). */
export const DEFAULT_OPENAI_TIMEOUT_MS = 240_000;
