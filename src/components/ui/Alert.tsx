import type { ReactNode } from "react";

type Tone = "error" | "warning" | "info";

const TONE_CLASSES: Record<Tone, string> = {
  error: "border-danger/40 bg-danger-surface text-danger",
  warning: "border-border bg-surface-muted text-foreground",
  info: "border-border bg-surface-muted text-muted",
};

/** Message court, lisible, sans jargon technique. */
export function Alert({
  tone = "error",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`whitespace-pre-line rounded-xl border px-3 py-2 text-sm ${TONE_CLASSES[tone]}`}
    >
      {children}
    </div>
  );
}
