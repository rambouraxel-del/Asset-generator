"use client";

import { useState } from "react";

import { NAME_LIMITS } from "@/lib/config";
import type { StylePack } from "@/types/domain";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Field, selectClasses, textInputClasses } from "@/components/ui/Field";
import { Section } from "@/components/ui/Section";

/** Sélection et gestion des Style Packs. */
export function StylePackCard({
  packs,
  activePack,
  onSelect,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
}: {
  packs: StylePack[];
  activePack: StylePack;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  return (
    <Section
      step="1"
      title="Style Pack"
      description="Configuration graphique d'un jeu ou d'un projet : contexte, références et catégories."
    >
      <Field label="Pack actif">
        <select
          value={activePack.id}
          onChange={(event) => onSelect(event.target.value)}
          className={selectClasses()}
          aria-label="Style Pack actif"
        >
          {packs.map((pack) => (
            <option key={pack.id} value={pack.id}>
              {pack.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="mt-3">
        <Field label="Nom du pack actif">
          <input
            type="text"
            value={activePack.name}
            maxLength={NAME_LIMITS.PACK_NAME_MAX_CHARS}
            onChange={(event) => onRename(activePack.id, event.target.value)}
            className={textInputClasses()}
            aria-label="Renommer le Style Pack actif"
          />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setCreating((open) => !open)}>
          Nouveau pack
        </Button>
        <Button variant="secondary" onClick={() => onDuplicate(activePack.id)}>
          Dupliquer
        </Button>
        <ConfirmButton
          label="Supprimer"
          onConfirm={() => onDelete(activePack.id)}
          ariaLabel={`Supprimer le Style Pack ${activePack.name}`}
        />
      </div>

      {creating ? (
        <div className="mt-3 rounded-xl border border-border p-3">
          <Field label="Nom du nouveau pack">
            <input
              type="text"
              value={newName}
              maxLength={NAME_LIMITS.PACK_NAME_MAX_CHARS}
              placeholder="A Timeless Journey"
              onChange={(event) => setNewName(event.target.value)}
              className={textInputClasses()}
              autoFocus
            />
          </Field>
          <div className="mt-2 flex gap-2">
            <Button
              variant="primary"
              className="flex-1"
              disabled={newName.trim().length === 0}
              onClick={() => {
                onCreate(newName);
                setNewName("");
                setCreating(false);
              }}
            >
              Créer
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setNewName("");
                setCreating(false);
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-xs text-muted">
        {packs.length} pack{packs.length > 1 ? "s" : ""} enregistré
        {packs.length > 1 ? "s" : ""} dans ce navigateur. La suppression d&apos;un pack
        efface aussi ses références.
      </p>
    </Section>
  );
}
