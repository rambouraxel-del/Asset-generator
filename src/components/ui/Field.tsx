import type { ReactNode } from "react";

/** Champ de formulaire : libellé, contrôle, aide ou erreur éventuelle. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL_CLASSES =
  "min-h-11 w-full rounded-xl border border-border bg-surface-muted px-3 text-foreground outline-none focus-visible:border-accent";

export function textInputClasses(invalid = false): string {
  return invalid ? `${CONTROL_CLASSES} border-danger` : CONTROL_CLASSES;
}

export function selectClasses(): string {
  return CONTROL_CLASSES;
}

export function textareaClasses(): string {
  return "w-full resize-y rounded-xl border border-border bg-surface-muted p-3 leading-relaxed text-foreground outline-none focus-visible:border-accent";
}
