/**
 * Construction du prompt envoyé à GPT Image.
 *
 * ---------------------------------------------------------------------------
 * POINT D'EXTENSION PRINCIPAL DU PROJET
 * ---------------------------------------------------------------------------
 * Toute la formulation envoyée au modèle est centralisée ici. Pour faire
 * évoluer le comportement de génération (Style Packs, règles de taille par
 * catégorie, palette imposée...), il suffit d'ajouter des blocs à
 * `PROMPT_TEMPLATE` et des champs à `AssetPromptInput` : aucun autre fichier
 * n'a besoin de changer.
 *
 * ---------------------------------------------------------------------------
 * CONTRAINTE MAJEURE : AUCUNE MÉMOIRE ENTRE LES GÉNÉRATIONS
 * ---------------------------------------------------------------------------
 * Cette fonction est pure et ne reçoit que trois entrées :
 *   1. le contexte permanent,
 *   2. le nombre de références actuellement activées,
 *   3. la demande actuelle.
 * Elle n'a accès à aucun historique, aucune génération précédente, aucune
 * conversation. Toute évolution future doit préserver cette propriété.
 */

export const PROMPT_TEMPLATE = {
  intro: "Tu génères un asset graphique destiné directement à un jeu vidéo.",
  permanentRulesHeading: "RÈGLES PERMANENTES :",
  referencesNotice:
    "Les images fournies sont les références graphiques officielles. Respecte au maximum leur style, leurs proportions, leur perspective, leur niveau de détail et leur langage visuel.",
  noReferencesNotice:
    "Aucune image de référence n'est fournie : applique strictement les règles permanentes ci-dessus.",
  assetHeading: "ASSET À PRODUIRE :",
  constraints: [
    "Ne représente qu'un seul asset.",
    "Ne crée pas de planche contenant plusieurs variantes sauf demande explicite.",
    "Ne rajoute aucun texte dans l'image.",
  ],
  transparentBackgroundNotice:
    "Le fond doit être entièrement transparent, sans ombre portée sur le sol ni décor autour de l'asset.",
} as const;

export interface AssetPromptInput {
  /** Règles permanentes saisies par l'utilisateur (peut être vide). */
  context: string;
  /** Demande ponctuelle décrivant l'asset à produire. */
  request: string;
  /** Nombre de références effectivement jointes à cet appel. */
  referenceCount: number;
  /** Mode de fond demandé : ajoute une consigne explicite si transparent. */
  background?: "transparent" | "opaque" | "auto";
}

/**
 * Assemble le prompt final. Fonction pure : mêmes entrées => même sortie.
 */
export function buildAssetPrompt(input: AssetPromptInput): string {
  const context = input.context.trim();
  const request = input.request.trim();

  const blocks: string[] = [PROMPT_TEMPLATE.intro];

  if (context.length > 0) {
    blocks.push(`${PROMPT_TEMPLATE.permanentRulesHeading}\n${context}`);
  }

  blocks.push(
    input.referenceCount > 0
      ? PROMPT_TEMPLATE.referencesNotice
      : PROMPT_TEMPLATE.noReferencesNotice,
  );

  blocks.push(`${PROMPT_TEMPLATE.assetHeading}\n${request}`);

  const constraints: string[] = [...PROMPT_TEMPLATE.constraints];
  if (input.background === "transparent") {
    constraints.push(PROMPT_TEMPLATE.transparentBackgroundNotice);
  }
  blocks.push(constraints.join("\n"));

  return blocks.join("\n\n");
}
