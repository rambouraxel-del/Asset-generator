"use client";

/**
 * Persistance des Style Packs (métadonnées et textes) dans `localStorage`.
 *
 * Seules les données légères vivent ici : nom, contexte, catégories. Les
 * images de référence, volumineuses, vivent dans IndexedDB et pointent vers
 * le pack par leur champ `packId`.
 */

import { NAME_LIMITS } from "@/lib/config";
import type { AssetCategory, StylePack } from "@/types/domain";
import { createId } from "@/lib/storage/db";

const PACKS_KEY = "asset-generator:packs";
const ACTIVE_PACK_KEY = "asset-generator:activePackId";

/** Clés de la V0.1, lues une seule fois par la migration puis laissées en place. */
export const LEGACY_CONTEXT_KEY = "asset-generator:context";
export const LEGACY_SETTINGS_KEY = "asset-generator:settings";

export const DEFAULT_CONTEXT = `Pixel art 2D vue du dessus.
Respect strict des proportions.
Fond transparent.
Un humain adulte mesure 48 pixels de haut.
Les assets doivent rester cohérents avec les références fournies.`;

/**
 * Catégories fournies au départ. Volontairement modifiables : ce ne sont que
 * des valeurs initiales, l'utilisateur peut en créer, renommer et supprimer.
 *
 * Rappel : ces dimensions sont les dimensions CIBLES de l'asset, injectées
 * dans le prompt. Elles ne sont pas la résolution envoyée à l'API.
 */
export function createDefaultCategories(): AssetCategory[] {
  const base: Array<Omit<AssetCategory, "id">> = [
    {
      name: "Personnage",
      targetWidth: 48,
      targetHeight: 48,
      rule: "Personnage vu en entier, debout, de face. Respecter l'échelle : un humain adulte fait 48 px de haut.",
    },
    {
      name: "Petit objet",
      targetWidth: 32,
      targetHeight: 32,
      rule: "L'objet doit tenir entièrement dans cette emprise, sans être coupé.",
    },
    {
      name: "Objet moyen",
      targetWidth: 64,
      targetHeight: 64,
      rule: "L'objet doit tenir entièrement dans cette emprise, sans être coupé.",
    },
    {
      name: "Grand objet",
      targetWidth: 128,
      targetHeight: 128,
      rule: "L'objet doit tenir entièrement dans cette emprise, sans être coupé.",
    },
    {
      name: "Végétation",
      targetWidth: 96,
      targetHeight: 128,
      rule: "Silhouette lisible. Base de l'élément posée au sol, sans socle ni ombre portée.",
    },
    {
      name: "Bâtiment",
      targetWidth: 192,
      targetHeight: 192,
      rule: "Bâtiment entier et visible, perspective identique à celle des références.",
    },
    {
      name: "Terrain / Tile",
      targetWidth: 32,
      targetHeight: 32,
      rule: "Tuile destinée à être répétée : les bords doivent se raccorder sans couture visible.",
    },
    {
      name: "Libre",
      targetWidth: null,
      targetHeight: null,
      rule: "",
    },
  ];
  return base.map((category) => ({ ...category, id: createId("cat") }));
}

export function createPackId(): string {
  return createId("pack");
}

export function createPack(options: {
  id?: string;
  name: string;
  context?: string;
  categories?: AssetCategory[];
}): StylePack {
  const now = Date.now();
  return {
    id: options.id ?? createPackId(),
    name: options.name.slice(0, NAME_LIMITS.PACK_NAME_MAX_CHARS),
    context: options.context ?? DEFAULT_CONTEXT,
    categories: options.categories ?? createDefaultCategories(),
    createdAt: now,
    updatedAt: now,
  };
}

/* -------------------------------------------------------------------------- */
/* Lecture / écriture                                                         */
/* -------------------------------------------------------------------------- */

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Navigation privée, stockage bloqué : on dégrade en douceur.
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // La perte de persistance ne doit jamais casser l'application.
  }
}

export function loadPacks(): StylePack[] {
  const raw = safeGet(PACKS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStylePack).map(normalizePack);
  } catch {
    return [];
  }
}

export function savePacks(packs: StylePack[]): void {
  safeSet(PACKS_KEY, JSON.stringify(packs));
}

export function loadActivePackId(): string | null {
  return safeGet(ACTIVE_PACK_KEY);
}

export function saveActivePackId(id: string): void {
  safeSet(ACTIVE_PACK_KEY, id);
}

export function readLegacyContext(): string | null {
  return safeGet(LEGACY_CONTEXT_KEY);
}

/* -------------------------------------------------------------------------- */
/* Robustesse                                                                 */
/* -------------------------------------------------------------------------- */

function isStylePack(value: unknown): value is StylePack {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StylePack>;
  return typeof candidate.id === "string" && typeof candidate.name === "string";
}

/**
 * Complète les champs éventuellement absents d'un pack enregistré par une
 * version antérieure : ajouter un champ en V0.3 ne cassera pas les données.
 */
function normalizePack(pack: StylePack): StylePack {
  return {
    ...pack,
    context: typeof pack.context === "string" ? pack.context : "",
    categories: Array.isArray(pack.categories) ? pack.categories.map(normalizeCategory) : [],
    createdAt: typeof pack.createdAt === "number" ? pack.createdAt : Date.now(),
    updatedAt: typeof pack.updatedAt === "number" ? pack.updatedAt : Date.now(),
  };
}

function normalizeCategory(category: AssetCategory): AssetCategory {
  return {
    id: typeof category.id === "string" ? category.id : createId("cat"),
    name: typeof category.name === "string" ? category.name : "Sans nom",
    targetWidth: typeof category.targetWidth === "number" ? category.targetWidth : null,
    targetHeight: typeof category.targetHeight === "number" ? category.targetHeight : null,
    rule: typeof category.rule === "string" ? category.rule : "",
  };
}
