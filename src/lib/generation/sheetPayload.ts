/**
 * Instantané d'une demande de planche de personnage.
 *
 * ---------------------------------------------------------------------------
 * LE SPRITE MAÎTRE A SON PROPRE CANAL
 * ---------------------------------------------------------------------------
 * Le maître n'est PAS une référence de style. Il voyage dans un champ dédié,
 * pour deux raisons :
 *
 *   1. l'utilisateur peut désigner comme maître un asset de sa bibliothèque, et
 *      un `GeneratedAsset` ne doit jamais devenir une `StyleReference` — c'est
 *      précisément ce que `assertStyleReference` interdit ;
 *   2. le contenu de la bibliothèque n'est jamais transmis automatiquement.
 *      Seul le fichier unique explicitement choisi part avec la requête, au
 *      même titre que la demande saisie.
 *
 * Les références de style, elles, restent soumises à la même vérification que
 * pour un asset unique : elles passent par `assertStyleReference`.
 * ---------------------------------------------------------------------------
 */

import type { QualityMode } from "@/lib/generation/qualityMode";
import {
  assertStyleReference,
  type OutgoingReference,
} from "@/lib/generation/payload";
import type { Direction } from "@/lib/character/sheetLayout";
import type { AssetCategory, StylePack, StyleReference } from "@/types/domain";

export interface CharacterSheetRequest {
  context: string;
  categoryName: string | null;
  categoryRule: string;
  /** Description du personnage saisie par l'utilisateur. */
  request: string;
  /** Nom donné au personnage, utilisé pour nommer les fichiers exportés. */
  characterName: string;
  /** Octets du sprite maître. Jamais une `StyleReference`. */
  master: Blob;
  masterName: string;
  masterDirection: Direction;
  generateRightSeparately: boolean;
  matchMasterPalette: boolean;
  qualityMode: QualityMode;
  references: OutgoingReference[];
}

export interface BuildSheetRequestInput {
  pack: StylePack;
  category: AssetCategory | null;
  request: string;
  characterName: string;
  master: Blob;
  masterName: string;
  masterDirection: Direction;
  generateRightSeparately: boolean;
  matchMasterPalette: boolean;
  qualityMode: QualityMode;
  /** Références ACTIVÉES du pack actif, déjà filtrées par l'appelant. */
  references: StyleReference[];
}

/**
 * Assemble l'instantané. Fonction pure : ne va rien chercher dans le stockage
 * et ne connaît aucune génération précédente.
 */
export function buildSheetRequest(input: BuildSheetRequestInput): CharacterSheetRequest {
  const outgoing: OutgoingReference[] = input.references.map((reference) => {
    assertStyleReference(reference);
    return { name: reference.name, blob: reference.blob };
  });

  return {
    context: input.pack.context,
    categoryName: input.category?.name ?? null,
    categoryRule: input.category?.rule ?? "",
    request: input.request.trim(),
    characterName: input.characterName.trim(),
    master: input.master,
    masterName: input.masterName,
    masterDirection: input.masterDirection,
    generateRightSeparately: input.generateRightSeparately,
    matchMasterPalette: input.matchMasterPalette,
    qualityMode: input.qualityMode,
    references: outgoing,
  };
}
