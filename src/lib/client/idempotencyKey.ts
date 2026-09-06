"use client";

/**
 * Clé d'idempotence d'une demande de génération.
 *
 * ---------------------------------------------------------------------------
 * DÉRIVÉE DU CONTENU, PAS DU HASARD
 * ---------------------------------------------------------------------------
 * La clé est calculée à partir de ce qui est réellement demandé. Deux onglets
 * qui envoient la même demande produisent donc la MÊME clé, et le serveur
 * refuse le second envoi. Une clé aléatoire ne protégerait de rien : chaque
 * onglet aurait la sienne et paierait sa génération.
 *
 * Le découpage temporel évite l'effet inverse : relancer volontairement la
 * même demande quelques minutes plus tard doit rester possible.
 * ---------------------------------------------------------------------------
 */

/** Durée pendant laquelle une demande identique est considérée comme un doublon. */
export const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

export function buildIdempotencyKey(
  parts: Array<string | number | null | undefined>,
  now: number = Date.now(),
): string {
  const bucket = Math.floor(now / DUPLICATE_WINDOW_MS);
  const payload = parts.map((part) => String(part ?? "")).join("|");
  return `${bucket}-${hash(payload)}`;
}

/**
 * Empreinte FNV-1a 32 bits.
 *
 * Non cryptographique, et c'est suffisant : on cherche à repérer deux envois
 * identiques, pas à résister à un adversaire. Le serveur reste de toute façon
 * la seule autorité sur la dépense.
 */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(36);
}
