"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";

/**
 * Bouton destructeur à double confirmation.
 *
 * Un premier appui affiche « Confirmer ? », un second exécute l'action. Plus
 * fiable qu'un `window.confirm` sur mobile, et sans dépendance de modale.
 * La confirmation retombe d'elle-même après quelques secondes.
 */
export function ConfirmButton({
  label,
  confirmLabel = "Confirmer ?",
  onConfirm,
  ariaLabel,
  className = "",
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  ariaLabel?: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <Button
      variant="danger"
      className={className}
      aria-label={ariaLabel}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}
