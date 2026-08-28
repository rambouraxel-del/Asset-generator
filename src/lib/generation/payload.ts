/**
 * Construction de l'instantané envoyé à /api/generate.
 *
 * ---------------------------------------------------------------------------
 * POINT DE PASSAGE OBLIGÉ — LA GARANTIE D'ISOLEMENT EST ICI
 * ---------------------------------------------------------------------------
 * Tout ce qui part vers OpenAI passe par ce module. Deux propriétés y sont
 * garanties :
 *
 * 1. AUCUNE MÉMOIRE. `buildGenerationRequest` est une fonction pure qui ne
 *    reçoit que le pack actif, la catégorie, les réglages, les références
 *    activées et la demande courante. Elle n'a accès à aucun résultat
 *    précédent, aucun historique, aucune bibliothèque.
 *
 * 2. AUCUN ASSET GÉNÉRÉ EN ENTRÉE. Chaque référence est vérifiée à
 *    l'exécution : un objet qui n'est pas une `StyleReference` fait échouer
 *    la construction plutôt que de partir vers l'API. TypeScript l'interdit
 *    déjà à la compilation ; cette assertion couvre les données venues du
 *    stockage, non typées à l'exécution.
 * ---------------------------------------------------------------------------
 */

import type { BackgroundMode, ImageQuality, OutputFormat } from "@/lib/config";
import type { QualityMode } from "@/lib/generation/qualityMode";
import type { PixelPipeline } from "@/lib/image/postProcessing";
import type { AssetCategory, StylePack, StyleReference } from "@/types/domain";

/**
 * Réglages d'une génération.
 *
 * Deux régimes cohabitent volontairement :
 *
 *   - `finalSizeEnabled = true`  — l'utilisateur choisit la TAILLE FINALE de
 *     l'asset ; la résolution envoyée à l'API et la qualité sont déduites
 *     automatiquement, et le résultat est post-traité côté serveur.
 *
 *   - `finalSizeEnabled = false` — comportement hérité de la V0.2 : `size` et
 *     `quality` sont pilotés à la main et le rendu brut est livré tel quel.
 */
export interface GenerationSettings {
  /** Post-traitement vers une taille finale exacte. */
  finalSizeEnabled: boolean;
  /** Dimensions de l'asset livré, quand `finalSizeEnabled` est actif. */
  finalWidth: number;
  finalHeight: number;
  /** Politique de qualité et de coût. */
  qualityMode: QualityMode;
  /**
   * Mode pixel art. `grid` demande au modèle de composer sur une grille
   * logique et lit ensuite l'image bloc par bloc ; `classic` reprend la chaîne
   * V0.2.2. Le serveur retombe automatiquement sur `classic` si la grille
   * n'est pas réalisable.
   */
  pixelPipeline: PixelPipeline;

  /** Résolution manuelle : « auto » ou « LARGEURxHAUTEUR ». Régime hérité. */
  size: string;
  /** Qualité manuelle. Régime hérité. */
  quality: ImageQuality;

  background: BackgroundMode;
  outputFormat: OutputFormat;
}

/** Une référence prête à partir : un nom et des octets, rien de plus. */
export interface OutgoingReference {
  name: string;
  blob: Blob;
}

/**
 * Instantané complet et autonome d'une demande de génération.
 *
 * Volontairement dépourvu de tout identifiant de résultat, de génération
 * précédente ou d'asset de bibliothèque : « Régénérer » rejoue cet objet tel
 * quel, et le rejouer ne peut donc rien transporter de plus.
 */
export interface GenerationRequest {
  context: string;
  categoryName: string | null;
  targetWidth: number | null;
  targetHeight: number | null;
  categoryRule: string;
  request: string;
  settings: GenerationSettings;
  references: OutgoingReference[];
}

/** Erreur levée si un objet étranger tente d'entrer dans une requête. */
export class ForbiddenReferenceError extends Error {
  constructor(detail: string) {
    super(`Refus d'envoyer un élément qui n'est pas une référence de style : ${detail}`);
    this.name = "ForbiddenReferenceError";
  }
}

/**
 * Vérifie à l'exécution qu'un objet est bien une référence de style.
 * Un `GeneratedAsset` (`kind: "generated-asset"`) est rejeté ici.
 */
export function assertStyleReference(value: unknown): asserts value is StyleReference {
  if (typeof value !== "object" || value === null) {
    throw new ForbiddenReferenceError(`type ${typeof value}`);
  }
  const candidate = value as { kind?: unknown; blob?: unknown };
  if (candidate.kind !== "style-reference") {
    throw new ForbiddenReferenceError(`kind=${String(candidate.kind)}`);
  }
  if (!(candidate.blob instanceof Blob)) {
    throw new ForbiddenReferenceError("blob manquant");
  }
}

/**
 * Assemble l'instantané envoyé au serveur.
 *
 * `references` doit déjà être filtré sur les références ACTIVÉES du pack
 * actif : cette fonction ne va rien chercher dans le stockage.
 */
export function buildGenerationRequest(input: {
  pack: StylePack;
  category: AssetCategory | null;
  request: string;
  settings: GenerationSettings;
  references: StyleReference[];
}): GenerationRequest {
  const outgoing: OutgoingReference[] = input.references.map((reference) => {
    assertStyleReference(reference);
    return { name: reference.name, blob: reference.blob };
  });

  return {
    context: input.pack.context,
    categoryName: input.category?.name ?? null,
    targetWidth: input.category?.targetWidth ?? null,
    targetHeight: input.category?.targetHeight ?? null,
    categoryRule: input.category?.rule ?? "",
    request: input.request.trim(),
    settings: input.settings,
    references: outgoing,
  };
}
