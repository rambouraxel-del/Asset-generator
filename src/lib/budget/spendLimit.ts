/**
 * Décision d'autorisation d'une génération au regard du budget.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE PLAFOND GARANTIT, ET CE QU'IL NE GARANTIT PAS
 * ---------------------------------------------------------------------------
 * La décision ci-dessous est exacte : elle additionne la dépense déjà
 * enregistrée ET les appels encore en vol, puis compare au plafond. Deux
 * requêtes simultanées ne peuvent donc pas passer chacune « parce qu'il restait
 * de la place ».
 *
 * En revanche, la FIABILITÉ du plafond dépend entièrement du registre qui
 * fournit ces chiffres :
 *
 *   - registre en mémoire (défaut, sans base) — chaque instance serverless a
 *     le sien et le perd au redémarrage. Le plafond devient alors un
 *     GARDE-FOU INDICATIF, pas une limite stricte. C'est écrit tel quel dans
 *     l'interface : promettre une limite dure qu'on ne tient pas serait pire
 *     que ne rien promettre.
 *
 *   - registre en base (Supabase configuré) — un seul compteur partagé, mis à
 *     jour de façon atomique. Le plafond est alors réellement contraignant, à
 *     la précision près du coût estimé avant appel.
 *
 * Dernière imprécision, inhérente au problème : le coût exact n'est connu
 * QU'APRÈS l'appel. On réserve donc une estimation haute avant de partir, puis
 * on la remplace par le coût mesuré. Un dépassement d'au plus une génération
 * reste possible.
 * ---------------------------------------------------------------------------
 */

export type SpendDecision =
  | { allowed: true; remainingUsd: number | null; reservedUsd: number }
  | {
      allowed: false;
      reason: "limite-atteinte" | "estimation-depasse-limite";
      message: string;
      remainingUsd: number;
    };

export interface SpendState {
  /** Plafond configuré côté serveur, ou `null` si aucun. */
  limitUsd: number | null;
  /** Dépense déjà enregistrée (coûts mesurés et estimés confondus). */
  recordedUsd: number;
  /** Somme réservée par les appels encore en cours. */
  inFlightUsd: number;
}

/**
 * Autorise ou refuse une génération.
 *
 * `estimatedUsd` est le coût qu'on s'apprête à engager. Il est réservé pendant
 * toute la durée de l'appel : c'est ce qui empêche deux requêtes simultanées de
 * franchir ensemble un plafond que chacune croyait libre.
 */
export function decideSpend(state: SpendState, estimatedUsd: number): SpendDecision {
  if (state.limitUsd === null) {
    return { allowed: true, remainingUsd: null, reservedUsd: Math.max(0, estimatedUsd) };
  }

  const engaged = state.recordedUsd + state.inFlightUsd;
  const remaining = state.limitUsd - engaged;

  if (remaining <= 0) {
    return {
      allowed: false,
      reason: "limite-atteinte",
      message: `Plafond de dépense atteint (${formatUsd(state.limitUsd)}). Générations bloquées jusqu'à ce que le plafond soit relevé ou le compteur remis à zéro.`,
      remainingUsd: Math.max(0, remaining),
    };
  }

  const reserve = Math.max(0, estimatedUsd);
  if (reserve > remaining) {
    return {
      allowed: false,
      reason: "estimation-depasse-limite",
      message: `Cette génération est estimée à ${formatUsd(reserve)} alors qu'il ne reste que ${formatUsd(remaining)} avant le plafond.`,
      remainingUsd: remaining,
    };
  }

  return { allowed: true, remainingUsd: remaining - reserve, reservedUsd: reserve };
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(amount < 0.01 ? 4 : 2)}`;
}
