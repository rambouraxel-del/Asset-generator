/**
 * Construction du prompt envoyé à GPT Image.
 *
 * ---------------------------------------------------------------------------
 * POINT D'EXTENSION PRINCIPAL DU PROJET
 * ---------------------------------------------------------------------------
 * Toute la formulation envoyée au modèle est centralisée dans
 * `PROMPT_TEMPLATE`. Faire évoluer le comportement de génération se fait ici,
 * sans toucher au reste du code.
 *
 * ---------------------------------------------------------------------------
 * CONTRAINTE MAJEURE : AUCUNE MÉMOIRE ENTRE LES GÉNÉRATIONS
 * ---------------------------------------------------------------------------
 * Cette fonction est pure et ne reçoit que :
 *   1. le contexte du Style Pack actif,
 *   2. la catégorie et ses contraintes dimensionnelles,
 *   3. la dimension finale visée de l'asset,
 *   4. le nombre de références actuellement activées,
 *   5. la demande actuelle.
 * Aucun historique, aucune génération précédente, aucun asset de la
 * bibliothèque. Toute évolution future doit préserver cette propriété.
 * ---------------------------------------------------------------------------
 */

export const PROMPT_TEMPLATE = {
  intro: "Tu génères un asset graphique directement exploitable dans un jeu vidéo.",

  styleHeading: "RÈGLES DU STYLE PACK :",

  referencesHeading: "RÉFÉRENCES :",
  referencesNotice:
    "Les images jointes constituent le référentiel graphique officiel. Respecte leur langage visuel, leur perspective, leurs proportions, leur palette apparente, leur niveau de détail et leur traitement pixel-art.",
  noReferencesNotice:
    "Aucune image de référence n'est fournie : applique strictement les règles du Style Pack ci-dessus.",

  categoryHeading: "CATÉGORIE :",

  finalSizeHeading: "DIMENSION FINALE CIBLE :",
  /*
   * Le modèle ignore tout de la résolution réellement demandée à l'API : on ne
   * lui parle QUE de la taille finale de l'asset. C'est ce qui l'amène à
   * composer un objet lisible à cette échelle plutôt qu'une scène détaillée
   * qui deviendrait illisible une fois réduite.
   */
  finalSizeNotice:
    "L'asset doit être conçu pour tenir lisiblement et entièrement dans cette emprise finale. Ne crée pas une scène large. Un seul asset, isolé, entièrement visible, cadré au plus près.",
  finalSizeSmallNotice:
    "À cette très petite taille, privilégie une silhouette nette et lisible, des aplats francs et un contraste marqué : les détails fins seraient perdus.",
  /*
   * Consigne de rendu pixel-art natif.
   *
   * Le post-traitement local fait l'essentiel du travail : on ne cherche pas à
   * compenser par du texte. Cette consigne sert seulement à orienter la
   * COMPOSITION — un sprite pensé pour sa grille se nettoie bien mieux qu'une
   * illustration détaillée. Elle reste volontairement courte, et n'est ajoutée
   * que lorsqu'une taille finale est demandée.
   */
  pixelArtNotice:
    "Dessine un véritable sprite pixel-art natif, conçu pour cette grille : aplats de couleur francs, contours nets, palette restreinte. Évite les dégradés mous, les détails sous-pixel, le flou et l'aspect illustration réduite.",

  dimensionsHeading: "CONTRAINTES DIMENSIONNELLES :",
  /**
   * Distinction essentielle : la dimension cible décrit l'emprise de l'objet
   * dans le jeu, pas un droit à le déformer pour remplir le cadre.
   */
  dimensionsNotice:
    "Ces dimensions sont une contrainte de production de l'asset : l'objet doit être conçu pour cette emprise, en conservant ses proportions naturelles. Ne l'étire pas, ne le déforme pas et ne le rogne pas pour remplir le cadre.",

  assetHeading: "ASSET À PRODUIRE :",

  constraintsHeading: "CONTRAINTES GÉNÉRALES :",
  constraints: [
    "un seul asset sauf demande contraire ;",
    "aucun texte dans l'image ;",
    "pas de planche de variantes sauf demande explicite ;",
    "objet entièrement visible, jamais coupé par les bords ;",
    "respecter le fond demandé ;",
    "ne pas transformer les références en contenu de la scène ;",
    "utiliser les références uniquement comme guide graphique.",
  ],

  transparentBackgroundNotice:
    "Le fond doit être entièrement transparent, sans ombre portée sur le sol ni décor autour de l'asset.",
  opaqueBackgroundNotice:
    "Le fond doit être opaque et uni, sans décor autour de l'asset.",
} as const;

export interface AssetPromptInput {
  /** Contexte du Style Pack actif (peut être vide). */
  context: string;
  /** Nom de la catégorie sélectionnée, ou `null` si aucune. */
  categoryName?: string | null;
  /** Dimensions cibles de l'asset, en pixels. `null` = aucune contrainte. */
  targetWidth?: number | null;
  targetHeight?: number | null;
  /** Règle textuelle propre à la catégorie. Peut être vide. */
  categoryRule?: string;
  /** Demande ponctuelle décrivant l'asset à produire. */
  request: string;
  /**
   * Dimensions finales visées de l'asset livré, en pixels.
   *
   * Attention : ce n'est PAS la résolution demandée à l'API. Le modèle génère
   * plus grand, et le post-traitement local ramène l'image à cette taille.
   */
  finalWidth?: number | null;
  finalHeight?: number | null;
  /** Nombre de références effectivement jointes à cet appel. */
  referenceCount: number;
  /** Mode de fond demandé : ajoute une consigne explicite. */
  background?: "transparent" | "opaque" | "auto";
}

/**
 * Assemble le prompt final. Fonction pure : mêmes entrées => même sortie.
 */
export function buildAssetPrompt(input: AssetPromptInput): string {
  const context = input.context.trim();
  const request = input.request.trim();
  const categoryName = input.categoryName?.trim() ?? "";
  const categoryRule = input.categoryRule?.trim() ?? "";

  const blocks: string[] = [PROMPT_TEMPLATE.intro];

  if (context.length > 0) {
    blocks.push(`${PROMPT_TEMPLATE.styleHeading}\n${context}`);
  }

  blocks.push(
    `${PROMPT_TEMPLATE.referencesHeading}\n${
      input.referenceCount > 0
        ? PROMPT_TEMPLATE.referencesNotice
        : PROMPT_TEMPLATE.noReferencesNotice
    }`,
  );

  if (categoryName.length > 0) {
    blocks.push(`${PROMPT_TEMPLATE.categoryHeading}\n${categoryName}`);
  }

  const finalSize = buildFinalSizeBlock(
    input.finalWidth ?? null,
    input.finalHeight ?? null,
  );
  if (finalSize !== null) {
    blocks.push(`${PROMPT_TEMPLATE.finalSizeHeading}\n${finalSize}`);
  }

  const dimensions = buildDimensionsBlock(
    input.targetWidth ?? null,
    input.targetHeight ?? null,
    categoryRule,
  );
  if (dimensions !== null) {
    blocks.push(`${PROMPT_TEMPLATE.dimensionsHeading}\n${dimensions}`);
  }

  blocks.push(`${PROMPT_TEMPLATE.assetHeading}\n${request}`);

  const constraints: string[] = [...PROMPT_TEMPLATE.constraints].map((line) => `- ${line}`);
  if (input.background === "transparent") {
    constraints.push(`- ${PROMPT_TEMPLATE.transparentBackgroundNotice}`);
  } else if (input.background === "opaque") {
    constraints.push(`- ${PROMPT_TEMPLATE.opaqueBackgroundNotice}`);
  }
  blocks.push(`${PROMPT_TEMPLATE.constraintsHeading}\n${constraints.join("\n")}`);

  return blocks.join("\n\n");
}

/**
 * Bloc de dimension finale, ou `null` si aucune taille finale n'est demandée.
 *
 * Une consigne supplémentaire est ajoutée sous 48 px : à cette échelle, un
 * rendu détaillé devient illisible après réduction.
 */
function buildFinalSizeBlock(width: number | null, height: number | null): string | null {
  if (width === null || height === null) return null;

  const lines = [
    `${width} × ${height} px`,
    PROMPT_TEMPLATE.finalSizeNotice,
    PROMPT_TEMPLATE.pixelArtNotice,
  ];

  if (Math.max(width, height) <= SMALL_ASSET_MAX_EDGE) {
    lines.push(PROMPT_TEMPLATE.finalSizeSmallNotice);
  }

  return lines.join("\n");
}

/** Seuil au-delà duquel un asset n'est plus considéré comme « très petit ». */
export const SMALL_ASSET_MAX_EDGE = 48;

/** Bloc dimensionnel, ou `null` si la catégorie n'impose rien. */
function buildDimensionsBlock(
  width: number | null,
  height: number | null,
  rule: string,
): string | null {
  const lines: string[] = [];

  if (width !== null && height !== null) {
    lines.push(`Emprise cible de l'asset : ${width} × ${height} pixels.`);
  } else if (width !== null) {
    lines.push(`Largeur cible de l'asset : ${width} pixels.`);
  } else if (height !== null) {
    lines.push(`Hauteur cible de l'asset : ${height} pixels.`);
  }

  if (lines.length > 0) {
    lines.push(PROMPT_TEMPLATE.dimensionsNotice);
  }

  if (rule.length > 0) {
    lines.push(rule);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}
