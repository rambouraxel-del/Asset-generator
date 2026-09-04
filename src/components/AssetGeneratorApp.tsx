"use client";

import { useEffect, useState } from "react";

import { useAppState } from "@/hooks/useAppState";
import { useCharacterSheet } from "@/hooks/useCharacterSheet";
import { useGeneration } from "@/hooks/useGeneration";
import { useLibrary } from "@/hooks/useLibrary";
import type { StatusResponse } from "@/types/api";
import { Alert } from "@/components/ui/Alert";
import { TabBar, type TabId } from "@/components/TabBar";
import { GenerateTab } from "@/components/tabs/GenerateTab";
import { LibraryTab } from "@/components/tabs/LibraryTab";
import { SettingsTab } from "@/components/tabs/SettingsTab";
import { StyleTab } from "@/components/tabs/StyleTab";

/**
 * Coque de l'application : navigation et composition des onglets.
 *
 * ---------------------------------------------------------------------------
 * DEUX ÉTATS, DEUX MONDES
 * ---------------------------------------------------------------------------
 * `useAppState` porte les ENTRÉES (Style Packs, contexte, références) ;
 * `useLibrary` porte les SORTIES (assets générés). Ils ne partagent aucun
 * store et ne s'écrivent jamais l'un dans l'autre.
 * ---------------------------------------------------------------------------
 */
export function AssetGeneratorApp() {
  const state = useAppState();
  // La comptabilisation de l'usage appartient à l'état applicatif, pas au
  // hook de génération : celui-ci se contente de remonter la donnée réelle.
  const generation = useGeneration({ onUsage: state.recordUsage });
  // Deux états de génération distincts : basculer de mode n'efface pas le
  // travail en cours dans l'autre.
  const sheet = useCharacterSheet({ onUsage: state.recordUsage });
  const library = useLibrary();

  const [tab, setTab] = useState<TabId>("generate");
  const [serverStatus, setServerStatus] = useState<StatusResponse | null>(null);

  // Prévenir l'utilisateur si la clé API manque, avant toute tentative.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: StatusResponse | null) => {
        if (!cancelled && body) setServerStatus(body);
      })
      .catch(() => {
        // Le statut est purement indicatif : son échec ne bloque rien.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">
        Chargement…
      </p>
    );
  }

  if (state.status === "error" || state.activePack === null) {
    return (
      <Alert tone="error">
        {state.error ?? "Le stockage local n'a pas pu être ouvert."}
      </Alert>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4 pb-24">
        {serverStatus && !serverStatus.apiKeyConfigured && !serverStatus.mockMode ? (
          <Alert tone="error">
            La clé API OpenAI n&apos;est pas configurée sur le serveur. Ajoutez
            OPENAI_API_KEY dans les variables d&apos;environnement, puis relancez
            l&apos;application.
          </Alert>
        ) : null}

        {serverStatus?.mockMode ? (
          <Alert tone="warning">
            Mode maquette actif (MOCK_OPENAI) : les images renvoyées sont des images de
            test, aucun appel n&apos;est fait à OpenAI.
          </Alert>
        ) : null}

        {state.migratedFromV1 ? (
          <Alert tone="info">
            Vos données de la V0.1 ont été reprises dans le Style Pack «{" "}
            {state.activePack.name} ». Rien n&apos;a été perdu.
          </Alert>
        ) : null}

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}

        {tab === "style" ? <StyleTab /> : null}
        {tab === "generate" ? (
          <GenerateTab
            generation={generation}
            sheet={sheet}
            library={library}
            rates={state.pricingRates}
          />
        ) : null}
        {tab === "library" ? <LibraryTab library={library} /> : null}
        {tab === "settings" ? (
          <SettingsTab
            status={serverStatus}
            usageTotals={state.usageTotals}
            onResetUsage={state.resetUsage}
            rates={state.pricingRates}
            onRatesChange={state.setPricingRates}
          />
        ) : null}
      </div>

      <TabBar active={tab} onChange={setTab} libraryCount={library.assets.length} />
    </>
  );
}
