"use client";

import { useState } from "react";

import { LIMITS, SIZE_CONSTRAINTS } from "@/lib/config";
import type { PricingRates } from "@/lib/pricing";
import { formatUsd } from "@/lib/pricing";
import type { StatusResponse } from "@/types/api";
import type { UsageTotals } from "@/types/domain";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Field, textInputClasses } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";
import { formatBytes } from "@/components/style/ReferencesCard";

/** Onglet Paramètres : compteurs, tarifs d'estimation, informations serveur. */
export function SettingsTab({
  status,
  usageTotals,
  onResetUsage,
  rates,
  onRatesChange,
}: {
  status: StatusResponse | null;
  usageTotals: UsageTotals;
  onResetUsage: () => void;
  rates: PricingRates | null;
  onRatesChange: (rates: PricingRates | null) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Section
        step="•"
        title="Consommation cumulée"
        description="Somme de ce que l'API a réellement renvoyé sur cet appareil. Indicatif."
      >
        <dl className="flex flex-col gap-1 text-sm">
          <Row label="Générations" value={usageTotals.generations.toLocaleString("fr-FR")} />
          <Row label="Jetons texte (entrée)" value={formatTokens(usageTotals.textInputTokens)} />
          <Row label="Jetons image (entrée)" value={formatTokens(usageTotals.imageInputTokens)} />
          <Row label="Jetons image (sortie)" value={formatTokens(usageTotals.imageOutputTokens)} />
          <Row label="Total" value={formatTokens(usageTotals.totalTokens)} strong />
        </dl>

        {usageTotals.generations > 0 && usageTotals.totalTokens === 0 ? (
          <div className="mt-3">
            <Alert tone="info">
              Des générations ont eu lieu mais l&apos;API n&apos;a renvoyé aucune donnée
              de consommation : rien n&apos;est estimé à la place.
            </Alert>
          </div>
        ) : null}

        <div className="mt-3">
          <ConfirmButton
            label="Remettre les compteurs à zéro"
            onConfirm={onResetUsage}
          />
        </div>
      </Section>

      <PricingCard rates={rates} onRatesChange={onRatesChange} usageTotals={usageTotals} />

      <Section step="•" title="Serveur">
        <dl className="flex flex-col gap-1 text-sm">
          <Row label="Modèle" value={status?.model ?? "—"} />
          <Row
            label="Clé API"
            value={
              status === null
                ? "—"
                : status.apiKeyConfigured
                  ? "Configurée côté serveur"
                  : "Absente"
            }
          />
          <Row label="Mode maquette" value={status?.mockMode ? "Actif" : "Inactif"} />
        </dl>
        <p className="mt-3 text-xs text-muted">
          La clé API n&apos;est jamais transmise au navigateur : seule sa présence est
          signalée.
        </p>
      </Section>

      <Section step="•" title="Limites appliquées">
        <dl className="flex flex-col gap-1 text-sm">
          <Row label="Contexte" value={`${LIMITS.CONTEXT_MAX_CHARS} caractères`} />
          <Row label="Demande" value={`${LIMITS.REQUEST_MAX_CHARS} caractères`} />
          <Row label="Références par génération" value={String(LIMITS.MAX_REFERENCES)} />
          <Row label="Poids cumulé des références" value={formatBytes(LIMITS.MAX_TOTAL_BYTES)} />
          <Row
            label="Résolution"
            value={`multiples de ${SIZE_CONSTRAINTS.MULTIPLE_OF}, ≤ ${SIZE_CONSTRAINTS.MAX_EDGE} px/côté`}
          />
        </dl>
      </Section>
    </div>
  );
}

/**
 * Saisie des tarifs servant à l'estimation de coût.
 *
 * Aucun tarif n'est fourni par l'application : les prix OpenAI changent et une
 * valeur figée deviendrait fausse en silence. L'estimation n'apparaît qu'une
 * fois les tarifs relevés et saisis par l'utilisateur.
 */
function PricingCard({
  rates,
  onRatesChange,
  usageTotals,
}: {
  rates: PricingRates | null;
  onRatesChange: (rates: PricingRates | null) => void;
  usageTotals: UsageTotals;
}) {
  const [textInput, setTextInput] = useState(rates?.textInputPerMillion.toString() ?? "");
  const [imageInput, setImageInput] = useState(rates?.imageInputPerMillion.toString() ?? "");
  const [imageOutput, setImageOutput] = useState(
    rates?.imageOutputPerMillion.toString() ?? "",
  );

  const parsed = {
    text: Number(textInput),
    input: Number(imageInput),
    output: Number(imageOutput),
  };
  const valid =
    [parsed.text, parsed.input, parsed.output].every(
      (value) => Number.isFinite(value) && value >= 0,
    ) &&
    textInput.trim() !== "" &&
    imageInput.trim() !== "" &&
    imageOutput.trim() !== "";

  const cumulativeUsd =
    rates === null
      ? null
      : (usageTotals.textInputTokens / 1e6) * rates.textInputPerMillion +
        (usageTotals.imageInputTokens / 1e6) * rates.imageInputPerMillion +
        (usageTotals.imageOutputTokens / 1e6) * rates.imageOutputPerMillion;

  return (
    <Section
      step="•"
      title="Estimation de coût"
      description="Optionnelle et désactivée par défaut."
    >
      <Alert tone="info">
        Aucun tarif n&apos;est livré avec l&apos;application : les prix OpenAI évoluent et
        une valeur figée deviendrait fausse sans prévenir. Relevez vos tarifs sur votre
        page de tarification OpenAI et saisissez-les ici pour activer une estimation.
      </Alert>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Texte entrée ($/M jetons)">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={textInput}
            onChange={(event) => setTextInput(event.target.value)}
            className={textInputClasses()}
            aria-label="Tarif texte en entrée par million de jetons"
          />
        </Field>
        <Field label="Image entrée ($/M jetons)">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={imageInput}
            onChange={(event) => setImageInput(event.target.value)}
            className={textInputClasses()}
            aria-label="Tarif image en entrée par million de jetons"
          />
        </Field>
        <Field label="Image sortie ($/M jetons)">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={imageOutput}
            onChange={(event) => setImageOutput(event.target.value)}
            className={textInputClasses()}
            aria-label="Tarif image en sortie par million de jetons"
          />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!valid}
          onClick={() =>
            onRatesChange({
              textInputPerMillion: parsed.text,
              imageInputPerMillion: parsed.input,
              imageOutputPerMillion: parsed.output,
              updatedAt: Date.now(),
            })
          }
        >
          Enregistrer les tarifs
        </Button>
        {rates !== null ? (
          <Button
            variant="ghost"
            onClick={() => {
              onRatesChange(null);
              setTextInput("");
              setImageInput("");
              setImageOutput("");
            }}
          >
            Désactiver l&apos;estimation
          </Button>
        ) : null}
      </div>

      {rates !== null ? (
        <p className="mt-3 text-sm">
          <span className="text-muted">Estimation cumulée : </span>
          <span className="font-medium">{formatUsd(cumulativeUsd ?? 0)}</span>
          <span className="block text-xs text-muted">
            Tarifs saisis le {new Date(rates.updatedAt).toLocaleDateString("fr-FR")}.
            Estimation indicative, hors taxes et remises éventuelles.
          </span>
        </p>
      ) : null}
    </Section>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? "font-semibold" : ""}>{value}</dd>
    </div>
  );
}

function formatTokens(value: number): string {
  return `${value.toLocaleString("fr-FR")} jetons`;
}
