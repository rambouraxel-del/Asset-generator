"use client";

import { LIMITS } from "@/lib/config";
import { Section } from "@/components/ui/Section";
import { textareaClasses } from "@/components/ui/Field";

/** Contexte permanent du Style Pack actif. */
export function ContextCard({
  packName,
  value,
  onChange,
}: {
  packName: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const tooLong = value.length > LIMITS.CONTEXT_MAX_CHARS;

  return (
    <Section
      step="2"
      title="Contexte"
      description={`Règles permanentes injectées dans chaque génération du pack « ${packName} ».`}
    >
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={8}
        spellCheck={false}
        aria-label="Règles permanentes de génération"
        placeholder="Pixel art 2D vue du dessus. Fond transparent. Un humain adulte mesure 48 pixels de haut..."
        className={textareaClasses()}
      />
      <p className={`mt-2 text-right text-xs ${tooLong ? "text-danger" : "text-muted"}`}>
        {value.length} / {LIMITS.CONTEXT_MAX_CHARS}
      </p>
    </Section>
  );
}
