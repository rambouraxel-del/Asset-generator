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
  /** Cote max d'une référence : au-dela, l'image est reduite dans le navigateur. */
  MAX_REFERENCE_EDGE: 1536,
} as const;

/** Formats d'image acceptes en entrée (contrainte de l'API OpenAI Images). */
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
 * Tailles proposées dans l'interface.
 * `gpt-image-2` accepte aussi des resolutions libres "LARGEURxHAUTEUR"
 * (multiples de 16, ratio entre 1:3 et 3:1) : la V0.2 pourra les exposer.
 */
export const IMAGE_SIZES = [
  "auto",
  "1024x1024",
  "1024x1536",
  "1536x1024",
] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** Niveaux de qualite exposes dans l'interface. */
export const IMAGE_QUALITIES = ["auto", "low", "medium", "high"] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

/** Reglages de génération par défaut (orientés assets de jeu video). */
export const DEFAULT_GENERATION_SETTINGS = {
  size: "1024x1024" as ImageSize,
  quality: "high" as ImageQuality,
  background: "transparent" as BackgroundMode,
  outputFormat: "png" as OutputFormat,
} as const;

/** Timeout de l'appel OpenAI (surchargeable via OPENAI_TIMEOUT_MS). */
export const DEFAULT_OPENAI_TIMEOUT_MS = 240_000;
