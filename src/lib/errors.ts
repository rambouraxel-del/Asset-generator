/**
 * Gestion centralisée des erreurs.
 *
 * Principe : le serveur ne renvoie au navigateur qu'un code stable et un
 * message court en français. Les détails techniques (stack, réponse brute de
 * l'API) restent dans la console serveur.
 */

export const ERROR_CODES = [
  "MISSING_API_KEY",
  "EMPTY_REQUEST",
  "TEXT_TOO_LONG",
  "TOO_MANY_REFERENCES",
  "UNSUPPORTED_IMAGE_FORMAT",
  "FILE_TOO_LARGE",
  "PAYLOAD_TOO_LARGE",
  "INVALID_REQUEST",
  "OPENAI_AUTH",
  "OPENAI_RATE_LIMIT",
  "OPENAI_CONTENT_FILTER",
  "OPENAI_TIMEOUT",
  "OPENAI_ERROR",
  "NETWORK_ERROR",
  "NO_IMAGE_RETURNED",
  "UNKNOWN",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Messages destinés à l'utilisateur final : courts, actionnables, sans jargon. */
const USER_MESSAGES: Record<ErrorCode, string> = {
  MISSING_API_KEY:
    "La clé API OpenAI n'est pas configurée sur le serveur. Ajoutez OPENAI_API_KEY dans les variables d'environnement, puis relancez l'application.",
  EMPTY_REQUEST: "Décrivez l'asset à créer avant de lancer la génération.",
  TEXT_TOO_LONG:
    "Le texte saisi est trop long. Raccourcissez le contexte ou la demande.",
  TOO_MANY_REFERENCES:
    "Trop d'images de référence activées. Désactivez-en quelques-unes et réessayez.",
  UNSUPPORTED_IMAGE_FORMAT:
    "Format d'image non supporté. Utilisez des fichiers PNG, JPEG ou WebP.",
  FILE_TOO_LARGE:
    "Une des images de référence est trop volumineuse. Réduisez sa taille et réimportez-la.",
  PAYLOAD_TOO_LARGE:
    "Les références activées pèsent trop lourd au total. Désactivez-en quelques-unes et réessayez.",
  INVALID_REQUEST:
    "La demande envoyée est invalide. Rechargez la page et réessayez.",
  OPENAI_AUTH:
    "OpenAI a refusé la clé API. Vérifiez qu'elle est valide et que votre organisation est autorisée à utiliser les modèles GPT Image.",
  OPENAI_RATE_LIMIT:
    "Trop de générations en peu de temps, ou quota OpenAI atteint. Patientez un instant avant de réessayer.",
  OPENAI_CONTENT_FILTER:
    "OpenAI a refusé cette demande pour des raisons de contenu. Reformulez la description de l'asset.",
  OPENAI_TIMEOUT:
    "La génération a pris trop de temps et a été interrompue. Réessayez, éventuellement avec une qualité plus basse.",
  OPENAI_ERROR:
    "OpenAI n'a pas pu traiter la génération. Réessayez dans quelques instants.",
  NETWORK_ERROR:
    "Impossible de joindre le serveur. Vérifiez votre connexion, puis réessayez.",
  NO_IMAGE_RETURNED:
    "Aucune image n'a été renvoyée par OpenAI. Réessayez, éventuellement en reformulant la demande.",
  UNKNOWN: "Une erreur inattendue est survenue. Réessayez dans quelques instants.",
};

/** Code HTTP associé à chaque code d'erreur. */
const HTTP_STATUS: Record<ErrorCode, number> = {
  MISSING_API_KEY: 503,
  EMPTY_REQUEST: 400,
  TEXT_TOO_LONG: 400,
  TOO_MANY_REFERENCES: 400,
  UNSUPPORTED_IMAGE_FORMAT: 415,
  FILE_TOO_LARGE: 413,
  PAYLOAD_TOO_LARGE: 413,
  INVALID_REQUEST: 400,
  OPENAI_AUTH: 502,
  OPENAI_RATE_LIMIT: 429,
  OPENAI_CONTENT_FILTER: 422,
  OPENAI_TIMEOUT: 504,
  OPENAI_ERROR: 502,
  NETWORK_ERROR: 502,
  NO_IMAGE_RETURNED: 502,
  UNKNOWN: 500,
};

/** Erreur applicative : porte un code stable et un message utilisateur. */
export class AppError extends Error {
  readonly code: ErrorCode;
  /** Détail technique, uniquement journalisé côté serveur. */
  readonly detail?: string;

  constructor(code: ErrorCode, options?: { detail?: string; message?: string }) {
    super(options?.message ?? USER_MESSAGES[code]);
    this.name = "AppError";
    this.code = code;
    this.detail = options?.detail;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }

  toResponseBody(): ErrorResponseBody {
    return { error: { code: this.code, message: this.message } };
  }
}

export interface ErrorResponseBody {
  error: { code: ErrorCode; message: string };
}

export function userMessageFor(code: ErrorCode): string {
  return USER_MESSAGES[code];
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value)
  );
}
