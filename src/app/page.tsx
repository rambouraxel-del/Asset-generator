import { AssetGenerator } from "@/components/AssetGenerator";

/**
 * Page unique de l'application.
 *
 * Composant serveur volontairement minimal : toute la logique interactive
 * vit dans `AssetGenerator` (composant client). Aucun secret n'est passé au
 * navigateur — l'état de configuration est lu via GET /api/status.
 */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-16 pt-6 sm:pt-10">
      <header>
        <h1 className="text-xl font-semibold sm:text-2xl">Asset Generator</h1>
        <p className="mt-1 text-sm text-muted">
          Contexte permanent + références activées + demande actuelle. Rien d&apos;autre
          n&apos;est envoyé à OpenAI.
        </p>
      </header>

      <AssetGenerator />

      <footer className="pt-2 text-center text-xs text-muted">
        V0.1 — le contexte et les références restent stockés dans ce navigateur.
      </footer>
    </main>
  );
}
