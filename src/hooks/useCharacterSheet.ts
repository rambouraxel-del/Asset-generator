"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppError, userMessageFor } from "@/lib/errors";
import { requestCharacterSheet } from "@/lib/client/generateSheet";
import { CHARACTER_SHEET } from "@/lib/config";
import type { MasterSprite } from "@/lib/client/masterSprite";
import type { Direction } from "@/lib/character/sheetLayout";
import type { CharacterSheetRequest } from "@/lib/generation/sheetPayload";
import type { GenerateSheetSuccessResponse } from "@/types/api";
import type { TokenUsage } from "@/types/domain";

/**
 * État d'une génération de planche de personnage.
 *
 * ---------------------------------------------------------------------------
 * MÊME RÈGLE QUE POUR UN ASSET UNIQUE : AUCUNE MÉMOIRE
 * ---------------------------------------------------------------------------
 * `lastRequestRef` ne conserve que les ENTRÉES, pour permettre « Régénérer » à
 * l'identique après un refus. Il ne contient jamais la planche précédente, et
 * une planche produite n'est jamais réinjectée dans une requête suivante.
 *
 * Le refus d'une planche (`reject`) efface le résultat SANS toucher au sprite
 * maître : le maître n'est jamais remplacé en silence par une vue générée.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI LE BROUILLON VIT ICI
 * ---------------------------------------------------------------------------
 * `draft` porte le maître choisi et les réglages de planche. Ce hook est monté
 * une fois pour toute la session, là où le panneau, lui, est démonté dès qu'on
 * change d'onglet ou de mode. Y laisser cet état ferait perdre le sprite maître
 * à chaque aller-retour vers la bibliothèque — d'où l'on vient précisément
 * quand on veut en choisir un.
 * ---------------------------------------------------------------------------
 */

/** Saisie en cours d'une planche, conservée entre les changements d'onglet. */
export interface CharacterSheetDraft {
  characterName: string;
  request: string;
  master: MasterSprite | null;
  masterDirection: Direction;
  generateRightSeparately: boolean;
  matchMasterPalette: boolean;
}

const EMPTY_DRAFT: CharacterSheetDraft = {
  characterName: "",
  request: "",
  master: null,
  masterDirection: "down",
  generateRightSeparately: false,
  matchMasterPalette: CHARACTER_SHEET.MATCH_MASTER_PALETTE,
};
export function useCharacterSheet({ onUsage }: { onUsage: (usage: TokenUsage | null) => void }) {
  const [result, setResult] = useState<GenerateSheetSuccessResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CharacterSheetDraft>(EMPTY_DRAFT);
  const lastRequestRef = useRef<CharacterSheetRequest | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (payload: CharacterSheetRequest) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      lastRequestRef.current = payload;
      setPending(true);
      setError(null);

      try {
        const response = await requestCharacterSheet(payload, controller.signal);
        setResult(response);
        onUsage(response.meta.usage);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setResult(null);
        setError(cause instanceof AppError ? cause.message : userMessageFor("UNKNOWN"));
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setPending(false);
        }
      }
    },
    [onUsage],
  );

  const regenerate = useCallback(async () => {
    const payload = lastRequestRef.current;
    if (payload) await run(payload);
  }, [run]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
  }, []);

  /** Refuse la planche affichée. Le sprite maître reste intact. */
  const reject = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  const clearResult = useCallback(() => {
    setResult(null);
    setError(null);
    lastRequestRef.current = null;
  }, []);

  // Aperçus dérivés des PNG renvoyés, révoqués dès qu'une nouvelle planche
  // arrive : sans cela, chaque régénération fuirait quatre object URLs.
  const previews = useMemo(() => {
    if (result === null) return null;
    const cells: Record<string, string> = {};
    for (const cell of result.cells) {
      cells[cell.direction] = toObjectUrl(cell.base64);
    }
    return { cells, sheet: toObjectUrl(result.sheet.base64) };
  }, [result]);

  useEffect(
    () => () => {
      if (previews === null) return;
      for (const url of Object.values(previews.cells)) URL.revokeObjectURL(url);
      URL.revokeObjectURL(previews.sheet);
    },
    [previews],
  );

  const updateDraft = useCallback((patch: Partial<CharacterSheetDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  return {
    result,
    previews,
    pending,
    error,
    draft,
    updateDraft,
    run,
    regenerate,
    reject,
    cancel,
    clearResult,
  };
}

/** PNG base64 → object URL, sans passer par une data URL de 100 ko. */
function toObjectUrl(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
}
