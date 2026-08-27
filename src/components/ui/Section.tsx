import type { ReactNode } from "react";

/** Carte de section : structure commune aux quatre blocs de l'interface. */
export function Section({
  step,
  title,
  description,
  action,
  children,
}: {
  step: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <header className="mb-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <span className="inline-flex size-6 shrink-0 items-center justify-center self-center rounded-full bg-surface-muted text-xs font-semibold text-muted">
              {step}
            </span>
            {title}
          </h2>
          {action ? <div className="shrink-0 text-right">{action}</div> : null}
        </div>
        {description ? (
          <p className="mt-1 text-sm leading-snug text-muted">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}
