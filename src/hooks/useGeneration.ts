"use client";

import { useCallback, useRef, useState } from "react";

import { AppError, userMessageFor } from "@/lib/errors";
import { requestGeneration } from "@/lib/client/generateAsset";
import type { GenerationRequest } from "@/lib/generation/payload";
import type { TokenUsage } from "@/types/domain";
import type { GenerateSuccessResponse } from "@/types/api";

/**
 * État d'une génération.
 *
 * ---------------------------------------------------------------------------
 * AUCUNE MÉMOIRE ENTRE LES GÉNÉRATIONS
 * ---------------------------------------------------------------------------
 * `lastRequestRef` conserve l'instantané des ENTRÉES (contexte, catégorie,
 * références, demande) uniquement pour permettre « Régénérer » à l'identique.
 * Il ne contient jamais le résultat précédent, et le résultat affiché n'est
 * jamais réinjecté dans une requête.
 *
 * Chaque appel à `run` REMPLACE cet instantané : la génération B n'hérite de
 * rien de la génération A. `lastRequestRef` vit en mémoire seulement et
 * disparaît au rechargement de la page.
 * ---------------------------------------------------------------------------
 */
export function useGeneration({
  onUsage,
}: {
  /** Appelée après chaque génération réussie, avec l'usage réel de l'API. */
  onUsage: (usage: TokenUsage | null) => void;
}) {
  const [result, setResult] = useState<GenerateSuccessResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastRequestRef = useRef<GenerationRequest | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (payload: GenerationRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Remplacement complet : aucun report d'une génération à la suivante.
    lastRequestRef.current = payload;
    setPending(true);
    setError(null);

    try {
      const response = await requestGeneration(payload, controller.signal);
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
    // `onUsage` provient de l'état applicatif et y est déjà mémoïsé.
  }, [onUsage]);

  /** Relance strictement la même requête : même pack, mêmes références, même demande. */
  const regenerate = useCallback(async () => {
    const payload = lastRequestRef.current;
    if (payload) await run(payload);
  }, [run]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
  }, []);

  /** Efface le résultat affiché (changement de pack, par exemple). */
  const clearResult = useCallback(() => {
    setResult(null);
    setError(null);
    lastRequestRef.current = null;
  }, []);

  return {
    result,
    pending,
    error,
    run,
    regenerate,
    cancel,
    clearResult,
    clearError: useCallback(() => setError(null), []),
  };
}
