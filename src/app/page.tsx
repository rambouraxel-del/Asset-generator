import { AppStateProvider } from "@/hooks/useAppState";
import { AssetGeneratorApp } from "@/components/AssetGeneratorApp";

/**
 * Page unique de l'application.
 *
 * Composant serveur volontairement minimal : toute la logique interactive vit
 * dans les composants clients. Aucun secret n'est passé au navigateur —
 * l'état de configuration est lu via GET /api/status.
 */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-16 pt-6 sm:pt-10">
      <header>
        <h1 className="text-xl font-semibold sm:text-2xl">Asset Generator</h1>
        <p className="mt-1 text-sm text-muted">
          Style Pack + catégorie + références actives + demande. Rien d&apos;autre
          n&apos;est envoyé à OpenAI.
        </p>
      </header>

      <AppStateProvider>
        <AssetGeneratorApp />
      </AppStateProvider>
    </main>
  );
}
