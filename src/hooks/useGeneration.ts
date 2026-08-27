"use client";

import { useCallback, useRef, useState } from "react";

import { AppError, userMessageFor } from "@/lib/errors";
import {
  requestGeneration,
  type GenerationRequest,
} from "@/lib/client/generateAsset";
import type { GenerateSuccessResponse } from "@/types/api";

/**
 * État d'une génération.
 *
 * ---------------------------------------------------------------------------
 * AUCUNE MÉMOIRE ENTRE LES GÉNÉRATIONS
 * ---------------------------------------------------------------------------
 * `lastRequest` conservé l'instantané des ENTREES (contexte, références,
 * demande) uniquement pour permettre « Régénérer » à l'identique. Il ne
 * contient jamais le résultat précédent, et le résultat affiché n'est jamais
 * reinjecte dans une requête. Cet instantané vit en mémoire seulement : il
 * disparait au rechargement de la page.
 * ---------------------------------------------------------------------------
 */
export function useGeneration() {
  const [result, setResult] = useState<GenerateSuccessResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastRequestRef = useRef<GenerationRequest | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (payload: GenerationRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    lastRequestRef.current = payload;
    setPending(true);
    setError(null);

    try {
      const response = await requestGeneration(payload, controller.signal);
      setResult(response);
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
  }, []);

  /** Relance strictement la même requête : même contexte, mêmes références, même demande. */
  const regenerate = useCallback(async () => {
    const payload = lastRequestRef.current;
    if (payload) await run(payload);
  }, [run]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
  }, []);

  return {
    result,
    pending,
    error,
    run,
    regenerate,
    cancel,
    clearError: useCallback(() => setError(null), []),
  };
}
