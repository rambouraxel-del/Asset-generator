/**
 * Variantes d'un asset dans la bibliothèque.
 *
 * ---------------------------------------------------------------------------
 * QUATRE FICHIERS DISTINCTS, JAMAIS FUSIONNÉS
 * ---------------------------------------------------------------------------
 *   original  — le rendu brut du fournisseur, tel qu'il est arrivé ;
 *   processed — le résultat des traitements locaux (grille, palette, alpha) ;
 *   manual    — une retouche faite à la main puis réimportée ;
 *   master    — la version explicitement désignée comme référence maîtresse.
 *
 * Deux règles protègent le travail manuel :
 *
 *   1. UNE RETOUCHE MANUELLE N'EST JAMAIS ÉCRASÉE AUTOMATIQUEMENT. Régénérer
 *      ou relancer un traitement écrit `processed`, jamais `manual`. Seule une
 *      action explicite de l'utilisateur remplace une retouche.
 *
 *   2. UNE VERSION MAÎTRESSE CONSERVE SES PIXELS D'ORIGINE. La désigner comme
 *      maîtresse copie les octets tels quels ; aucun traitement ne s'y
 *      applique ensuite. C'est ce qui permet de s'y fier comme référence.
 * ---------------------------------------------------------------------------
 */

export const VARIANT_KINDS = ["original", "processed", "manual", "master"] as const;
export type AssetVariantKind = (typeof VARIANT_KINDS)[number];

export const VARIANT_LABELS: Record<AssetVariantKind, string> = {
  original: "Fichier original",
  processed: "Après traitement",
  manual: "Retouche manuelle",
  master: "Version maîtresse",
};

export interface AssetVariant {
  kind: AssetVariantKind;
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  createdAt: number;
  /** Vrai si l'utilisateur a explicitement produit ou importé cette variante. */
  userAuthored: boolean;
}

/** Jeu de variantes d'un même asset. `original` est toujours présent. */
export type VariantSet = Partial<Record<AssetVariantKind, AssetVariant>> & {
  original: AssetVariant;
};

export class VariantProtectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VariantProtectionError";
  }
}

export interface WriteOptions {
  /**
   * Autorise l'écrasement d'une variante protégée. Réservé à une action
   * explicite de l'utilisateur — jamais posé par un traitement automatique.
   */
  explicitOverwrite?: boolean;
}

/**
 * Écrit une variante en respectant les protections.
 *
 * @throws {VariantProtectionError} si l'écriture écraserait une retouche
 *         manuelle ou une version maîtresse sans autorisation explicite.
 */
export function writeVariant(
  set: VariantSet,
  variant: AssetVariant,
  options: WriteOptions = {},
): VariantSet {
  const existing = set[variant.kind];
  const protectedKind = variant.kind === "manual" || variant.kind === "master";

  if (existing !== undefined && protectedKind && options.explicitOverwrite !== true) {
    throw new VariantProtectionError(
      `La variante « ${VARIANT_LABELS[variant.kind]} » existe déjà et ne peut pas être remplacée automatiquement. Confirmez le remplacement pour l'écraser.`,
    );
  }

  return { ...set, [variant.kind]: variant };
}

/**
 * Désigne une variante comme maîtresse.
 *
 * Les octets sont repris TELS QUELS : c'est une copie, pas un retraitement.
 * Un pixel de la source est donc un pixel identique dans la maîtresse.
 */
export function promoteToMaster(
  set: VariantSet,
  source: AssetVariantKind,
  options: WriteOptions = {},
): VariantSet {
  const origin = set[source];
  if (origin === undefined) {
    throw new VariantProtectionError(
      `Impossible de promouvoir « ${VARIANT_LABELS[source]} » : cette variante n'existe pas.`,
    );
  }

  return writeVariant(
    set,
    {
      ...origin,
      kind: "master",
      createdAt: Date.now(),
      userAuthored: true,
    },
    options,
  );
}

/**
 * Variante à afficher et à exporter par défaut.
 *
 * Priorité décroissante : la maîtresse fait foi, sinon la retouche manuelle,
 * sinon le traitement, sinon l'original. Autrement dit : le travail humain
 * passe toujours devant le résultat automatique.
 */
export function preferredVariant(set: VariantSet): AssetVariant {
  return set.master ?? set.manual ?? set.processed ?? set.original;
}

/** `true` si écrire cette variante détruirait du travail non automatique. */
export function wouldDestroyUserWork(
  set: VariantSet,
  kind: AssetVariantKind,
): boolean {
  const existing = set[kind];
  return existing !== undefined && existing.userAuthored;
}
