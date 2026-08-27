"use client";

import { LIMITS } from "@/lib/config";
import { Section } from "@/components/ui/Section";

/**
 * Section A — Contexte permanent.
 * Sauvegardé automatiquement dans le navigateur (cf. `useLocalContext`).
 */
export function ContextSection({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const tooLong = value.length > LIMITS.CONTEXT_MAX_CHARS;

  return (
    <Section
      step="A"
      title="Contexte"
      description="Règles permanentes appliquées à chaque génération. Enregistrées dans ce navigateur."
    >
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={8}
        spellCheck={false}
        aria-label="Règles permanentes de génération"
        placeholder="Pixel art 2D vue du dessus. Fond transparent. Un humain adulte mesure 48 pixels de haut..."
        className="w-full resize-y rounded-xl border border-border bg-surface-muted p-3 leading-relaxed outline-none focus-visible:border-accent"
      />
      <p className={`mt-2 text-right text-xs ${tooLong ? "text-danger" : "text-muted"}`}>
        {value.length} / {LIMITS.CONTEXT_MAX_CHARS}
      </p>
    </Section>
  );
}
