"use client";

import { useAppState } from "@/hooks/useAppState";
import { CategoriesCard } from "@/components/style/CategoriesCard";
import { ContextCard } from "@/components/style/ContextCard";
import { ReferencesCard } from "@/components/style/ReferencesCard";
import { StylePackCard } from "@/components/style/StylePackCard";

/** Onglet Style : pack actif, contexte, références, catégories. */
export function StyleTab() {
  const state = useAppState();
  const pack = state.activePack;
  if (pack === null) return null;

  return (
    <div className="flex flex-col gap-4">
      <StylePackCard
        packs={state.packs}
        activePack={pack}
        onSelect={state.selectStylePack}
        onCreate={state.createStylePack}
        onRename={state.renameStylePack}
        onDuplicate={state.duplicateStylePack}
        onDelete={state.deleteStylePack}
      />

      <ContextCard
        packName={pack.name}
        value={pack.context}
        onChange={state.updateContext}
      />

      <ReferencesCard
        packName={pack.name}
        references={state.references}
        previews={state.previews}
        enabledCount={state.enabledReferences.length}
        enabledBytes={state.enabledBytes}
        onAddFiles={state.addReferenceFiles}
        onToggle={state.toggleReference}
        onRemove={state.removeReference}
        onSetAllEnabled={state.setAllReferencesEnabled}
      />

      <CategoriesCard
        categories={pack.categories}
        onAdd={state.addCategory}
        onUpdate={state.updateCategory}
        onDelete={state.deleteCategory}
      />
    </div>
  );
}
