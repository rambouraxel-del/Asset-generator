"use client";

import { useEffect, useState } from "react";

import { LIMITS } from "@/lib/config";
import { useGeneration } from "@/hooks/useGeneration";
import { useLocalContext } from "@/hooks/useLocalContext";
import { useReferences } from "@/hooks/useReferences";
import type { StatusResponse } from "@/types/api";
import { Alert } from "@/components/ui/Alert";
import { ContextSection } from "@/components/ContextSection";
import { GenerationSection } from "@/components/GenerationSection";
import { ReferencesSection } from "@/components/ReferencesSection";
import { ResultSection } from "@/components/ResultSection";

/**
 * Orchestrateur de l'interface.
 *
 * ---------------------------------------------------------------------------
 * AUCUNE MÉMOIRE ENTRE LES GÉNÉRATIONS
 * ---------------------------------------------------------------------------
 * À chaque clic sur « Générer », un instantané est construit à partir de
 * l'état courant uniquement : contexte + références activées + demande.
 * Aucun résultat précédent n'entre dans cette construction, et rien n'est
 * accumulé d'une génération à l'autre.
 * ---------------------------------------------------------------------------
 */
export function AssetGenerator() {
  const { context, setContext, settings, updateSettings } = useLocalContext();
  const references = useReferences();
  const generation = useGeneration();

  const [request, setRequest] = useState("");
  const [status, setStatus] = useState<StatusResponse | null>(null);

  // Prévenir l'utilisateur si la clé API manque, avant toute tentative.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: StatusResponse | null) => {
        if (!cancelled && body) setStatus(body);
      })
      .catch(() => {
        // Le statut est purement indicatif : son échec ne bloqué rien.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enabled = references.enabledReferences;
  const disabledReason = resolveDisabledReason({
    request,
    context,
    enabledBytes: references.enabledBytes,
    enabledCount: enabled.length,
  });

  async function handleGenerate() {
    if (disabledReason !== null) return;

    // Instantané autonome : le contenu binaire des références activées est lu
    // maintenant, dans l'ordre d'affichage.
    await generation.run({
      context,
      request: request.trim(),
      settings,
      references: enabled.map((reference) => ({
        name: reference.name,
        blob: reference.blob,
      })),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {status && !status.apiKeyConfigured && !status.mockMode ? (
        <Alert tone="error">
          La clé API OpenAI n&apos;est pas configurée sur le serveur. Ajoutez
          OPENAI_API_KEY dans les variables d&apos;environnement, puis relancez
          l&apos;application.
        </Alert>
      ) : null}

      {status?.mockMode ? (
        <Alert tone="warning">
          Mode maquette actif (MOCK_OPENAI) : les images renvoyées sont des images de
          test, aucun appel n&apos;est fait à OpenAI.
        </Alert>
      ) : null}

      <ContextSection value={context} onChange={setContext} />

      <ReferencesSection
        references={references.references}
        previews={references.previews}
        enabledCount={enabled.length}
        enabledBytes={references.enabledBytes}
        loading={references.loading}
        error={references.error}
        onAddFiles={references.addFiles}
        onToggle={references.toggleReference}
        onRemove={references.removeReference}
        onSetAllEnabled={references.setAllEnabled}
      />

      <GenerationSection
        request={request}
        onRequestChange={setRequest}
        settings={settings}
        onSettingsChange={updateSettings}
        enabledCount={enabled.length}
        pending={generation.pending}
        error={generation.error}
        disabledReason={disabledReason}
        onGenerate={handleGenerate}
        onCancel={generation.cancel}
      />

      <ResultSection
        result={generation.result}
        pending={generation.pending}
        onRegenerate={generation.regenerate}
      />
    </div>
  );
}

/**
 * Motif bloquant la génération, ou `null` si tout est prêt.
 * Duplique volontairement les règles serveur pour un retour immédiat ;
 * le serveur reste la source de vérité.
 */
function resolveDisabledReason({
  request,
  context,
  enabledBytes,
  enabledCount,
}: {
  request: string;
  context: string;
  enabledBytes: number;
  enabledCount: number;
}): string | null {
  if (request.trim().length === 0) {
    return "Décrivez l'asset à créer pour activer la génération.";
  }
  if (context.length > LIMITS.CONTEXT_MAX_CHARS) {
    return "Le contexte dépasse la longueur maximale autorisée.";
  }
  if (enabledCount > LIMITS.MAX_REFERENCES) {
    return `Trop de références activées (maximum ${LIMITS.MAX_REFERENCES}).`;
  }
  if (enabledBytes > LIMITS.MAX_TOTAL_BYTES) {
    return "Les références activées pèsent trop lourd au total.";
  }
  return null;
}
