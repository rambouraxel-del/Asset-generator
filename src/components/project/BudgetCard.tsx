"use client";

import type { ReadinessResponse } from "@/types/api";
import { Alert } from "@/components/ui/Alert";
import { Section } from "@/components/ui/Section";

/**
 * Dépenses et budget, en termes compréhensibles.
 *
 * ---------------------------------------------------------------------------
 * NE JAMAIS PROMETTRE PLUS QUE CE QUI EST TENU
 * ---------------------------------------------------------------------------
 * Le plafond n'est réellement contraignant que si le compteur est partagé et
 * durable. Quand ce n'est pas le cas, cet écran l'écrit noir sur blanc plutôt
 * que d'afficher un cadenas rassurant.
 *
 * De même, « mesuré », « estimé » et « inconnu » sont montrés séparément : une
 * donnée absente n'est pas zéro, et les additionner donnerait un faux total.
 * ---------------------------------------------------------------------------
 */
export function BudgetCard({ readiness }: { readiness: ReadinessResponse | null }) {
  if (readiness === null) {
    return (
      <Section step="5" title="Dépenses">
        <p className="text-sm text-muted">Lecture de l&apos;état du serveur…</p>
      </Section>
    );
  }

  const spend = readiness.spend;

  return (
    <Section
      step="5"
      title="Dépenses"
      description={
        readiness.mockMode
          ? "Mode maquette : aucune génération n'est facturée."
          : "Seules les générations consomment votre crédit."
      }
    >
      {!readiness.canGenerate ? (
        <div className="mb-3">
          <Alert tone="error">
            <span className="font-medium">Génération bloquée par sécurité.</span>
            <ul className="mt-1 list-inside list-disc">
              {readiness.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}

      {spend !== null ? (
        <div className="grid grid-cols-2 gap-3">
          <Tile
            label="Coût mesuré"
            value={`$${spend.measuredUsd.toFixed(4)}`}
            hint="Usage réel × tarif connu"
          />
          <Tile
            label="Coût estimé"
            value={`$${spend.estimatedUsd.toFixed(4)}`}
            hint="Quand le coût réel n'est pas calculable"
          />
          <Tile
            label="Générations"
            value={String(spend.generations)}
            hint="Appels réellement partis"
          />
          <Tile
            label="Coût inconnu"
            value={String(spend.unknownCostCount)}
            hint="Comptées à part, jamais comme zéro"
          />
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-sm text-muted">
          Compteur de dépense indisponible — connectez-vous pour le consulter.
        </p>
      )}

      <div className="mt-3 rounded-xl bg-surface-muted p-3">
        <p className="text-xs uppercase tracking-wide text-muted">Plafond</p>
        <p className="mt-1 text-sm">
          {readiness.spendLimitUsd === null
            ? "Aucun plafond configuré."
            : `$${readiness.spendLimitUsd.toFixed(2)}`}
        </p>
        <p className="mt-2 text-xs text-muted">
          {readiness.strictLimit
            ? "Plafond appliqué de façon fiable : le compteur est partagé entre les serveurs. Un dépassement d'au plus une génération reste possible, le coût réel n'étant connu qu'après l'appel."
            : "Garde-fou indicatif seulement : le compteur n'est pas partagé entre les serveurs et repart à zéro au redémarrage. Le seul plafond vraiment strict est celui configuré sur votre compte OpenAI."}
        </p>
      </div>

      <p className="mt-3 text-xs text-muted">
        Modèle configuré : <strong>{readiness.model}</strong>. Le modèle et la qualité
        réellement employés sont affichés avec chaque résultat.
      </p>
    </Section>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl bg-surface-muted p-3">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}
