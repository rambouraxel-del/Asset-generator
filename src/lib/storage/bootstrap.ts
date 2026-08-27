"use client";

/**
 * Démarrage du stockage local et migration depuis la V0.1.
 *
 * Exécuté une fois au montage de l'application. Trois cas :
 *
 *   1. Des Style Packs existent déjà (V0.2)  → on les charge tels quels.
 *   2. Des données V0.1 sont présentes       → on les rapatrie dans un pack
 *      « Style Pack V0.1 », sans rien perdre : le contexte devient le contexte
 *      du pack, et les références V0.1 (déjà rattachées au pack de migration
 *      par la mise à jour IndexedDB) le rejoignent automatiquement.
 *   3. Rien du tout (première visite)        → on crée un pack par défaut.
 *
 * La migration est idempotente : relancer `bootstrapStorage` ne duplique rien.
 */

import type { StylePack } from "@/types/domain";
import { LEGACY_PACK_ID, openDatabase } from "@/lib/storage/db";
import {
  DEFAULT_CONTEXT,
  createPack,
  loadActivePackId,
  loadPacks,
  readLegacyContext,
  saveActivePackId,
  savePacks,
} from "@/lib/storage/packs";
import { countReferencesForPack } from "@/lib/storage/styleReferences";

export const LEGACY_PACK_NAME = "Style Pack V0.1";
export const DEFAULT_PACK_NAME = "Mon premier Style Pack";

export interface BootstrapResult {
  packs: StylePack[];
  activePackId: string;
  /** `true` si des données V0.1 viennent d'être reprises. */
  migratedFromV1: boolean;
}

export async function bootstrapStorage(): Promise<BootstrapResult> {
  // Ouvrir la base déclenche la migration IndexedDB v1 → v2 si nécessaire.
  await openDatabase();

  const existing = loadPacks();

  if (existing.length > 0) {
    return {
      packs: existing,
      activePackId: resolveActivePackId(existing),
      migratedFromV1: false,
    };
  }

  const legacyContext = readLegacyContext();
  const legacyReferenceCount = await countReferencesForPack(LEGACY_PACK_ID);
  const hasLegacyData = legacyContext !== null || legacyReferenceCount > 0;

  const pack = hasLegacyData
    ? createPack({
        id: LEGACY_PACK_ID,
        name: LEGACY_PACK_NAME,
        // Un contexte V0.1 vide est une intention : on la respecte.
        context: legacyContext ?? DEFAULT_CONTEXT,
      })
    : createPack({ name: DEFAULT_PACK_NAME, context: DEFAULT_CONTEXT });

  savePacks([pack]);
  saveActivePackId(pack.id);

  return { packs: [pack], activePackId: pack.id, migratedFromV1: hasLegacyData };
}

/** Le pack actif enregistré, ou le premier disponible s'il a disparu. */
function resolveActivePackId(packs: StylePack[]): string {
  const stored = loadActivePackId();
  const isValid = stored !== null && packs.some((pack) => pack.id === stored);
  const resolved = isValid ? stored : packs[0].id;
  if (!isValid) saveActivePackId(resolved);
  return resolved;
}
