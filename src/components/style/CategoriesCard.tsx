"use client";

import { NAME_LIMITS } from "@/lib/config";
import type { AssetCategory } from "@/types/domain";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Field, textInputClasses, textareaClasses } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";

/**
 * Catégories d'assets du Style Pack actif.
 *
 * Les dimensions saisies ici sont les dimensions CIBLES de l'objet produit :
 * elles sont injectées dans le prompt. Elles ne sont pas la résolution
 * demandée à l'API, réglée séparément dans l'onglet Générer.
 */
export function CategoriesCard({
  categories,
  onAdd,
  onUpdate,
  onDelete,
}: {
  categories: AssetCategory[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Omit<AssetCategory, "id">>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Section
      step="4"
      title="Catégories"
      description="Contraintes de taille par type d'asset, ajoutées au prompt."
      action={<span className="text-xs text-muted">{categories.length}</span>}
    >
      <Alert tone="info">
        Ces dimensions décrivent l&apos;emprise voulue de l&apos;asset dans le jeu. Elles
        sont indépendantes de la résolution envoyée à l&apos;API : le modèle ne sait pas
        produire une image de 32 × 32 px, mais il peut dessiner un objet conçu pour
        cette emprise.
      </Alert>

      <ul className="mt-3 flex flex-col gap-3">
        {categories.map((category) => (
          <li key={category.id} className="rounded-xl border border-border p-3">
            <Field label="Nom">
              <input
                type="text"
                value={category.name}
                maxLength={NAME_LIMITS.CATEGORY_NAME_MAX_CHARS}
                onChange={(event) => onUpdate(category.id, { name: event.target.value })}
                className={textInputClasses()}
                aria-label={`Nom de la catégorie ${category.name}`}
              />
            </Field>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Largeur cible (px)">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={category.targetWidth ?? ""}
                  placeholder="—"
                  onChange={(event) =>
                    onUpdate(category.id, { targetWidth: parseDimension(event.target.value) })
                  }
                  className={textInputClasses()}
                  aria-label={`Largeur cible de ${category.name}`}
                />
              </Field>
              <Field label="Hauteur cible (px)">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={category.targetHeight ?? ""}
                  placeholder="—"
                  onChange={(event) =>
                    onUpdate(category.id, { targetHeight: parseDimension(event.target.value) })
                  }
                  className={textInputClasses()}
                  aria-label={`Hauteur cible de ${category.name}`}
                />
              </Field>
            </div>

            <div className="mt-2">
              <Field label="Règle (optionnelle)" hint="Ajoutée telle quelle au prompt.">
                <textarea
                  value={category.rule}
                  rows={2}
                  maxLength={NAME_LIMITS.CATEGORY_RULE_MAX_CHARS}
                  placeholder="L'objet doit tenir entièrement dans cette emprise."
                  onChange={(event) => onUpdate(category.id, { rule: event.target.value })}
                  className={textareaClasses()}
                  aria-label={`Règle de ${category.name}`}
                />
              </Field>
            </div>

            <div className="mt-2 flex justify-end">
              <ConfirmButton
                label="Supprimer"
                onConfirm={() => onDelete(category.id)}
                ariaLabel={`Supprimer la catégorie ${category.name}`}
              />
            </div>
          </li>
        ))}
      </ul>

      {categories.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted">
          Aucune catégorie. La génération restera possible sans contrainte de taille.
        </p>
      ) : null}

      <Button variant="secondary" className="mt-3 w-full" onClick={onAdd}>
        Ajouter une catégorie
      </Button>
    </Section>
  );
}

/** Champ vide ou invalide = aucune contrainte (`null`). */
function parseDimension(raw: string): number | null {
  const value = Number(raw);
  return raw.trim() !== "" && Number.isInteger(value) && value > 0 ? value : null;
}
