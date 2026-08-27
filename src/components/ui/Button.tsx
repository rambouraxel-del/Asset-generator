import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-foreground hover:opacity-90 disabled:opacity-50",
  secondary:
    "border border-border bg-surface text-foreground hover:bg-surface-muted disabled:opacity-50",
  ghost: "text-muted hover:bg-surface-muted disabled:opacity-50",
  danger: "text-danger hover:bg-danger-surface disabled:opacity-50",
};

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={[
        // `min-h-11` : cible tactile confortable, recommandation iOS.
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium",
        "transition-opacity disabled:cursor-not-allowed",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        VARIANT_CLASSES[variant],
        className,
      ].join(" ")}
    />
  );
}
