/**
 * Assemblage déterministe des instructions envoyées au modèle.
 *
 * ---------------------------------------------------------------------------
 * TROIS COUCHES, DANS CET ORDRE, ET RIEN D'AUTRE
 * ---------------------------------------------------------------------------
 *     règles communes du projet + règles de la famille + demande utilisateur
 *
 * Aucune IA n'intervient ici : pas de résumé de la mémoire, pas de réécriture
 * du prompt. La même entrée produit toujours exactement la même sortie, ce qui
 * rend le résultat vérifiable et l'aperçu honnête.
 *
 * L'historique des générations n'entre JAMAIS dans cette fonction. La mémoire
 * du projet est une base structurée, pas une conversation.
 *
 * ---------------------------------------------------------------------------
 * SOLS ET OBJETS NE PARTAGENT PAS LES MÊMES CONTRAINTES
 * ---------------------------------------------------------------------------
 * Une tuile de sol doit couvrir toute la cellule et se raccorder à ses
 * voisines ; un objet isolé doit au contraire garder une marge transparente.
 * Appliquer la consigne « objet entièrement visible, marge autour » à un sol
 * produit des tuiles trouées. Les deux jeux de contraintes sont donc
 * strictement séparés par `framing`.
 * ---------------------------------------------------------------------------
 */

import type {
  AssetFamily,
  FramingMode,
  ProjectPalette,
  StyleCharter,
} from "@/types/project";
import { CHARTER_FIELDS } from "@/types/project";

export const CONTEXT_TEMPLATE = {
  intro: "Tu génères un asset graphique directement exploitable dans un jeu vidéo.",

  charterHeading: "CHARTE GRAPHIQUE DU PROJET :",
  paletteHeading: "PALETTE IMPOSÉE :",
  paletteNotice:
    "N'emploie que ces couleurs, ou les teintes les plus proches. Aucune couleur hors palette.",

  familyHeading: "FAMILLE D'ASSET :",

  /* --- Cadrage : deux jeux de contraintes qui ne doivent jamais se mélanger --- */
  isolatedHeading: "CADRAGE — OBJET ISOLÉ :",
  isolatedConstraints: [
    "Un seul asset, isolé, entièrement visible, jamais coupé par les bords.",
    "Laisse une marge transparente d'au moins un pixel tout autour de l'asset.",
    "Fond entièrement transparent, sans ombre portée au sol ni décor.",
  ],

  seamlessHeading: "CADRAGE — TUILE COUVRANTE :",
  seamlessConstraints: [
    "La texture couvre la totalité de l'image, bord à bord, sans marge ni vide.",
    "Aucun pixel transparent : la tuile est entièrement opaque.",
    "Les bords doivent se raccorder : le bord droit prolonge le bord gauche, le bord bas prolonge le bord haut.",
    "Aucun objet isolé, aucun élément centré, aucune bordure décorative.",
  ],

  referencesHeading: "RÉFÉRENCES :",
  referencesNotice:
    "Les images jointes constituent le référentiel graphique officiel. Respecte leur langage visuel, leurs proportions, leur palette apparente et leur traitement pixel-art. Ne les reproduis pas telles quelles et n'en fais pas le sujet de l'image.",
  noReferencesNotice:
    "Aucune image de référence n'est jointe : applique strictement la charte ci-dessus.",

  requestHeading: "ASSET À PRODUIRE :",

  commonHeading: "CONTRAINTES GÉNÉRALES :",
  commonConstraints: [
    "aucun texte dans l'image ;",
    "aucune planche de variantes ;",
    "aplats de couleur francs, contours nets, palette restreinte ;",
    "aucun dégradé mou, aucun anti-aliasing, aucun détail sous-pixel.",
  ],
} as const;

export interface ContextInput {
  charter: StyleCharter;
  palette: ProjectPalette | null;
  family: AssetFamily | null;
  familyLabel: string | null;
  familyRule: string;
  framing: FramingMode;
  request: string;
  referenceCount: number;
  /** Dimensions finales visées, en pixels. */
  finalWidth: number | null;
  finalHeight: number | null;
}

export interface ContextBlock {
  /** Titre affiché dans l'aperçu. */
  heading: string;
  body: string;
  /**
   * `true` si le bloc porte une contrainte qu'on ne doit jamais couper en
   * silence. L'aperçu s'en sert pour avertir plutôt que tronquer.
   */
  essential: boolean;
}

export interface BuiltContext {
  /** Texte intégral réellement envoyé. */
  prompt: string;
  blocks: ContextBlock[];
  /** Longueur exacte en caractères. Ce n'est PAS un nombre de jetons. */
  characterCount: number;
  /**
   * Estimation grossière du nombre de jetons, à ±30 % près.
   *
   * Volontairement présentée comme une ESTIMATION : le découpage réel dépend
   * du tokeniseur du fournisseur, que nous n'exécutons pas ici. Sur-estimer
   * serait aussi trompeur que sous-estimer, donc l'interface doit afficher
   * l'incertitude, jamais un chiffre nu.
   */
  estimatedTokens: number;
}

/**
 * Assemble le prompt. Fonction pure : mêmes entrées => même sortie, au
 * caractère près.
 */
export function buildProjectContext(input: ContextInput): BuiltContext {
  const blocks: ContextBlock[] = [];

  blocks.push({ heading: "Introduction", body: CONTEXT_TEMPLATE.intro, essential: false });

  const charter = renderCharter(input.charter);
  if (charter !== null) {
    blocks.push({
      heading: CONTEXT_TEMPLATE.charterHeading,
      body: charter,
      essential: true,
    });
  }

  if (input.palette !== null && input.palette.colours.length > 0) {
    blocks.push({
      heading: CONTEXT_TEMPLATE.paletteHeading,
      body: `${input.palette.colours.join(", ")}\n${CONTEXT_TEMPLATE.paletteNotice}`,
      essential: true,
    });
  }

  if (input.familyLabel !== null) {
    const lines = [input.familyLabel];
    const rule = input.familyRule.trim();
    // Une règle identique au libellé n'apporte rien : on évite la répétition.
    if (rule.length > 0 && rule !== input.familyLabel) lines.push(rule);
    blocks.push({
      heading: CONTEXT_TEMPLATE.familyHeading,
      body: lines.join("\n"),
      essential: true,
    });
  }

  const size = renderSize(input.finalWidth, input.finalHeight);
  if (size !== null) {
    blocks.push({ heading: "DIMENSION FINALE :", body: size, essential: true });
  }

  blocks.push(renderFraming(input.framing));

  blocks.push({
    heading: CONTEXT_TEMPLATE.referencesHeading,
    body:
      input.referenceCount > 0
        ? CONTEXT_TEMPLATE.referencesNotice
        : CONTEXT_TEMPLATE.noReferencesNotice,
    essential: false,
  });

  blocks.push({
    heading: CONTEXT_TEMPLATE.requestHeading,
    body: input.request.trim(),
    essential: true,
  });

  blocks.push({
    heading: CONTEXT_TEMPLATE.commonHeading,
    body: CONTEXT_TEMPLATE.commonConstraints.map((line) => `- ${line}`).join("\n"),
    essential: true,
  });

  const prompt = blocks
    .map((block) => (block.heading === "Introduction" ? block.body : `${block.heading}\n${block.body}`))
    .join("\n\n");

  return {
    prompt,
    blocks,
    characterCount: prompt.length,
    estimatedTokens: estimateTokens(prompt),
  };
}

/**
 * Contraintes de cadrage, choisies par `framing` et jamais mélangées.
 */
function renderFraming(framing: FramingMode): ContextBlock {
  const isSeamless = framing === "seamless";
  return {
    heading: isSeamless ? CONTEXT_TEMPLATE.seamlessHeading : CONTEXT_TEMPLATE.isolatedHeading,
    body: (isSeamless
      ? CONTEXT_TEMPLATE.seamlessConstraints
      : CONTEXT_TEMPLATE.isolatedConstraints
    )
      .map((line) => `- ${line}`)
      .join("\n"),
    essential: true,
  };
}

/** Charte rendue champ par champ ; les champs vides disparaissent. */
function renderCharter(charter: StyleCharter): string | null {
  const lines = CHARTER_FIELDS.map((field) => {
    const value = charter[field.key].trim();
    return value.length > 0 ? `${field.label} : ${value}` : null;
  }).filter((line): line is string => line !== null);

  return lines.length > 0 ? lines.join("\n") : null;
}

function renderSize(width: number | null, height: number | null): string | null {
  if (width === null || height === null) return null;
  return `${width} × ${height} px`;
}

/**
 * Estimation du nombre de jetons.
 *
 * Approximation délibérément simple : ~4 caractères par jeton pour du texte
 * latin. Le tokeniseur réel du fournisseur n'est pas exécuté ici, et embarquer
 * une bibliothèque de tokenisation pour un affichage indicatif ne le vaudrait
 * pas. L'interface DOIT présenter ce nombre comme une estimation.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
