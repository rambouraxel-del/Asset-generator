"use client";

export const TABS = [
  { id: "style", label: "Style" },
  { id: "generate", label: "Générer" },
  { id: "library", label: "Biblio." },
  { id: "settings", label: "Réglages" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

/**
 * Navigation principale, ancrée en bas sur mobile.
 *
 * Position basse : le pouce l'atteint sans réajuster la prise sur iPhone.
 * `env(safe-area-inset-bottom)` évite la barre de geste.
 */
export function TabBar({
  active,
  onChange,
  libraryCount,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
  libraryCount: number;
}) {
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-3xl">
        {TABS.map((tab) => {
          const selected = tab.id === active;
          return (
            <li key={tab.id} className="flex-1">
              <button
                type="button"
                onClick={() => onChange(tab.id)}
                aria-current={selected ? "page" : undefined}
                /*
                 * Nom accessible distinct du libellé visible : sans cela,
                 * l'onglet « Générer » et le bouton d'action « Générer »
                 * portent le même nom, ce qui rend la navigation ambiguë
                 * pour un lecteur d'écran.
                 */
                aria-label={`Aller à l'onglet ${tab.label}`}
                className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors ${
                  selected ? "text-accent" : "text-muted"
                }`}
              >
                <span
                  aria-hidden
                  className={`h-0.5 w-8 rounded-full ${selected ? "bg-accent" : "bg-transparent"}`}
                />
                {tab.label}
                {tab.id === "library" && libraryCount > 0 ? (
                  <span className="text-[10px] text-muted">{libraryCount}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
