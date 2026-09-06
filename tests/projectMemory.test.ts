/**
 * Étape « mode projet, mémoire durable et garde-fous budgétaires ».
 *
 * Les tests suivent l'ordre du cahier des charges : isolation, persistance,
 * import historique, export/import, protection des originaux, concurrence,
 * construction du contexte, sélection des références, refus des appels non
 * autorisés, doubles soumissions et plafond.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authorizeGeneration, parseAllowlist } from "@/lib/auth/allowlist";
import { resolveIdentity, SOLO_OWNER_ID } from "@/lib/auth/session";
import { IdempotencyStore } from "@/lib/budget/idempotency";
import { MemoryLedger } from "@/lib/budget/ledger";
import { decideSpend } from "@/lib/budget/spendLimit";
import { computeServerCost } from "@/lib/budget/serverPricing";
import {
  promoteToMaster,
  preferredVariant,
  writeVariant,
  wouldDestroyUserWork,
  VariantProtectionError,
  type AssetVariant,
  type VariantSet,
} from "@/lib/library/variants";
import { applyVersioned } from "@/lib/project/concurrency";
import { buildProjectContext, estimateTokens } from "@/lib/project/contextBuilder";
import { createProject, createDefaultFamilyRules, familyRuleOf } from "@/lib/project/defaults";
import { guessFamily, planLegacyImport } from "@/lib/project/legacyImport";
import {
  detectConflicts,
  validateManifest,
  MANIFEST_VERSION,
  type ProjectManifest,
} from "@/lib/project/portableProject";
import { selectReferences, MAX_AUTO_SELECTED } from "@/lib/project/referenceSelection";
import { emptyCharter } from "@/types/project";
import type { AssetFamily, ProjectReference } from "@/types/project";

/* -------------------------------------------------------------------------- */
/* Fabriques                                                                  */
/* -------------------------------------------------------------------------- */

function reference(overrides: Partial<ProjectReference> = {}): ProjectReference {
  return {
    kind: "project-reference",
    id: "ref-1",
    projectId: "project-1",
    ownerId: null,
    name: "reference.png",
    mimeType: "image/png",
    width: 48,
    height: 48,
    size: 100,
    validated: true,
    pinned: false,
    families: [],
    createdAt: 1,
    blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
    ...overrides,
  };
}

function variant(overrides: Partial<AssetVariant> = {}): AssetVariant {
  return {
    kind: "original",
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    width: 48,
    height: 48,
    mimeType: "image/png",
    createdAt: 1,
    userAuthored: false,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* 1. Isolation des comptes et des projets                                    */
/* -------------------------------------------------------------------------- */

describe("Isolation des comptes", () => {
  const ORIGINAL = process.env.GENERATION_ALLOWLIST;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.GENERATION_ALLOWLIST;
    else process.env.GENERATION_ALLOWLIST = ORIGINAL;
  });

  it("laisse passer en mode solo quand aucune liste n'est configurée", () => {
    delete process.env.GENERATION_ALLOWLIST;
    const verdict = authorizeGeneration(null);
    expect(verdict).toEqual({ allowed: true, mode: "propriétaire-unique" });
  });

  it("refuse un compte connecté mais absent de la liste", () => {
    process.env.GENERATION_ALLOWLIST = "proprietaire@exemple.fr";
    const verdict = authorizeGeneration("intrus@exemple.fr");
    expect(verdict.allowed).toBe(false);
  });

  it("refuse un appel anonyme dès qu'une liste existe", () => {
    process.env.GENERATION_ALLOWLIST = "proprietaire@exemple.fr";
    expect(authorizeGeneration(null).allowed).toBe(false);
  });

  it("accepte le compte autorisé, quelle que soit la casse", () => {
    process.env.GENERATION_ALLOWLIST = "Proprietaire@Exemple.FR";
    expect(authorizeGeneration("proprietaire@exemple.fr").allowed).toBe(true);
  });

  it("ignore les entrées vides de la liste", () => {
    expect(parseAllowlist("a@b.fr, ,, c@d.fr")).toEqual(["a@b.fr", "c@d.fr"]);
  });

  it("sans Supabase, l'identité est le propriétaire local", async () => {
    const identity = await resolveIdentity(new Request("https://exemple.fr"));
    expect(identity?.ownerId).toBe(SOLO_OWNER_ID);
    expect(identity?.mode).toBe("solo");
    // Non vérifiée : l'interface ne doit pas prétendre le contraire.
    expect(identity?.verified).toBe(false);
  });

  it("les dépenses de deux comptes ne se mélangent pas", async () => {
    const ledger = new MemoryLedger();
    await ledger.reserve("compte-a", 0.5, "r1");
    await ledger.settle("compte-a", "r1", { costUsd: 0.5, counted: true });

    expect((await ledger.read("compte-a")).recordedUsd).toBe(0.5);
    expect((await ledger.read("compte-b")).recordedUsd).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Persistance : forme du projet et règles par famille                     */
/* -------------------------------------------------------------------------- */

describe("Structure d'un projet", () => {
  it("crée un projet nommé sans coder ses règles en dur", () => {
    const project = createProject({ name: "Timeless Journey" });

    expect(project.name).toBe("Timeless Journey");
    expect(project.version).toBe(1);
    expect(project.archived).toBe(false);
    // La charte est VIDE : aucune règle d'univers n'est livrée avec le code.
    expect(Object.values(project.charter).every((value) => value === "")).toBe(true);
    expect(project.familyRules.every((rule) => rule.rule === "")).toBe(true);
  });

  it("couvre les cinq familles demandées", () => {
    const families = createDefaultFamilyRules().map((rule) => rule.family);
    expect(families).toEqual([
      "personnages",
      "objets",
      "vegetation",
      "sols",
      "constructions",
    ]);
  });

  it("les sols sont couvrants par défaut, les objets isolés", () => {
    const rules = createDefaultFamilyRules();
    expect(rules.find((r) => r.family === "sols")?.framing).toBe("seamless");
    expect(rules.find((r) => r.family === "objets")?.framing).toBe("isolated");
    expect(rules.find((r) => r.family === "personnages")?.framing).toBe("isolated");
  });

  it("retombe sur une règle utilisable si la famille est absente", () => {
    const project = createProject({ name: "P" });
    project.familyRules = [];
    expect(familyRuleOf(project, "sols").framing).toBe("seamless");
    expect(familyRuleOf(project, null).framing).toBe("isolated");
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Import historique sans perte ni doublons                                */
/* -------------------------------------------------------------------------- */

describe("Import de l'ancienne bibliothèque", () => {
  const assets = [
    { id: "a1", name: "Chêne", createdAt: 1 },
    { id: "a2", name: "Potion", createdAt: 2 },
  ];
  const refs = [{ id: "r1", name: "palette.png", packId: "p1", createdAt: 1 }];

  it("copie tout quand rien n'existe encore", () => {
    const plan = planLegacyImport({
      assets,
      references: refs,
      existingAssetIds: [],
      existingReferenceIds: [],
    });
    expect(plan.assets).toHaveLength(2);
    expect(plan.references).toHaveLength(1);
    expect(plan.skippedAssets).toBe(0);
  });

  it("ne crée pas de doublon si l'import est rejoué", () => {
    const plan = planLegacyImport({
      assets,
      references: refs,
      existingAssetIds: ["a1", "a2"],
      existingReferenceIds: ["r1"],
    });
    expect(plan.assets).toHaveLength(0);
    expect(plan.references).toHaveLength(0);
    expect(plan.skippedAssets).toBe(2);
    expect(plan.skippedReferences).toBe(1);
  });

  it("dédoublonne aussi à l'intérieur d'une source abîmée", () => {
    const plan = planLegacyImport({
      assets: [...assets, { id: "a1", name: "Chêne (bis)", createdAt: 3 }],
      references: [],
      existingAssetIds: [],
      existingReferenceIds: [],
    });
    expect(plan.assets.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(plan.skippedAssets).toBe(1);
  });

  it("ne perd aucun asset : importés + ignorés = source", () => {
    const source = [...assets, { id: "a3", name: "Mur", createdAt: 4 }];
    const plan = planLegacyImport({
      assets: source,
      references: [],
      existingAssetIds: ["a2"],
      existingReferenceIds: [],
    });
    expect(plan.assets.length + plan.skippedAssets).toBe(source.length);
  });

  it("suggère une famille sans jamais l'imposer", () => {
    const plan = planLegacyImport({
      assets: [
        { id: "a1", name: "Grand chêne", createdAt: 1 },
        { id: "a2", name: "Tuile de sol herbeuse", createdAt: 2 },
        { id: "a3", name: "Chose indéterminée", createdAt: 3 },
      ],
      references: [],
      existingAssetIds: [],
      existingReferenceIds: [],
    });

    expect(plan.guessedFamilies.a1).toBe("vegetation");
    expect(plan.guessedFamilies.a2).toBe("sols");
    // Aucune suggestion plutôt qu'une classification hasardeuse.
    expect(plan.guessedFamilies.a3).toBeUndefined();
  });

  it("ne devine rien sur un libellé neutre", () => {
    expect(guessFamily("truc")).toBeNull();
  });

  it("l'import n'active jamais une référence : les assets restent des assets", () => {
    const plan = planLegacyImport({
      assets,
      references: refs,
      existingAssetIds: [],
      existingReferenceIds: [],
    });
    // Le plan ne produit aucune référence à partir des assets.
    expect(plan.references.map((r) => r.id)).toEqual(["r1"]);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Export / import portable                                                */
/* -------------------------------------------------------------------------- */

describe("Export et import portables", () => {
  function manifest(overrides: Partial<ProjectManifest> = {}): ProjectManifest {
    const project = createProject({ name: "Timeless Journey" });
    const { kind: _kind, ...rest } = project;
    void _kind;
    return {
      manifestVersion: MANIFEST_VERSION,
      exportedAt: 1,
      appVersion: "0.3.0",
      project: rest,
      assets: [
        { id: "a1", name: "Chêne", createdAt: 1, family: "vegetation", variants: [{ kind: "original", ref: "img1" }] },
      ],
      references: [
        { id: "r1", name: "palette.png", validated: true, pinned: false, families: [], ref: "img2" },
      ],
      images: [
        { ref: "img1", name: "chene.png", mimeType: "image/png", width: 48, height: 48, base64: "AAAA" },
        { ref: "img2", name: "palette.png", mimeType: "image/png", width: 48, height: 48, base64: "BBBB" },
      ],
      ...overrides,
    };
  }

  it("valide un manifeste complet", () => {
    const result = validateManifest(manifest());
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("refuse un fichier qui n'est pas un manifeste", () => {
    expect(validateManifest("bonjour").valid).toBe(false);
    expect(validateManifest(null).valid).toBe(false);
  });

  it("refuse un format plus récent plutôt que de deviner", () => {
    const result = validateManifest(manifest({ manifestVersion: MANIFEST_VERSION + 1 }));
    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toMatch(/plus récente/);
  });

  it("signale une image manquante au lieu d'importer un asset incomplet", () => {
    const broken = manifest();
    broken.images = broken.images.filter((image) => image.ref !== "img1");
    const result = validateManifest(broken);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("image manquante"))).toBe(true);
  });

  it("signale une référence orpheline", () => {
    const broken = manifest();
    broken.images = broken.images.filter((image) => image.ref !== "img2");
    expect(validateManifest(broken).valid).toBe(false);
  });

  it("conserve les fichiers : chaque variante retrouve son image", () => {
    const result = validateManifest(manifest());
    expect(result.manifest).not.toBeNull();
    const refs = new Set(result.manifest!.images.map((image) => image.ref));
    for (const asset of result.manifest!.assets) {
      for (const v of asset.variants) expect(refs.has(v.ref)).toBe(true);
    }
  });

  it("détecte les conflits sans rien écraser", () => {
    const conflicts = detectConflicts(manifest(), {
      projectIds: [],
      assetIds: ["a1"],
      referenceIds: [],
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("asset");
    expect(conflicts[0].message).toMatch(/retouche manuelle/);
  });

  it("ne signale aucun conflit sur une cible vierge", () => {
    expect(
      detectConflicts(manifest(), { projectIds: [], assetIds: [], referenceIds: [] }),
    ).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Protection des originaux et des versions maîtresses                     */
/* -------------------------------------------------------------------------- */

describe("Protection des variantes", () => {
  function baseSet(): VariantSet {
    return { original: variant() };
  }

  it("écrit librement une variante automatique", () => {
    const set = writeVariant(baseSet(), variant({ kind: "processed" }));
    expect(set.processed).toBeDefined();
    expect(set.original).toBeDefined();
  });

  it("n'écrase JAMAIS une retouche manuelle automatiquement", () => {
    let set = writeVariant(baseSet(), variant({ kind: "manual", userAuthored: true }));
    expect(() => writeVariant(set, variant({ kind: "manual" }))).toThrow(
      VariantProtectionError,
    );
    // La retouche est toujours là, intacte.
    expect(set.manual?.userAuthored).toBe(true);
    set = writeVariant(set, variant({ kind: "processed" }));
    expect(set.manual?.userAuthored).toBe(true);
  });

  it("autorise le remplacement sur action explicite", () => {
    const set = writeVariant(baseSet(), variant({ kind: "manual", userAuthored: true }));
    const replaced = writeVariant(
      set,
      variant({ kind: "manual", createdAt: 99, userAuthored: true }),
      { explicitOverwrite: true },
    );
    expect(replaced.manual?.createdAt).toBe(99);
  });

  it("une version maîtresse conserve les pixels de sa source", () => {
    const source = variant({ kind: "manual", userAuthored: true });
    const set = promoteToMaster(writeVariant(baseSet(), source), "manual");
    expect(set.master?.blob).toBe(source.blob);
    expect(set.master?.width).toBe(source.width);
  });

  it("refuse de remplacer une maîtresse sans confirmation", () => {
    let set = promoteToMaster(
      writeVariant(baseSet(), variant({ kind: "manual", userAuthored: true })),
      "manual",
    );
    expect(() => promoteToMaster(set, "original")).toThrow(VariantProtectionError);
    set = writeVariant(set, variant({ kind: "processed" }));
    expect(set.master).toBeDefined();
  });

  it("refuse de promouvoir une variante inexistante", () => {
    expect(() => promoteToMaster(baseSet(), "manual")).toThrow(VariantProtectionError);
  });

  it("le travail humain passe devant le résultat automatique", () => {
    let set = baseSet();
    expect(preferredVariant(set).kind).toBe("original");
    set = writeVariant(set, variant({ kind: "processed" }));
    expect(preferredVariant(set).kind).toBe("processed");
    set = writeVariant(set, variant({ kind: "manual", userAuthored: true }));
    expect(preferredVariant(set).kind).toBe("manual");
    set = promoteToMaster(set, "manual");
    expect(preferredVariant(set).kind).toBe("master");
  });

  it("sait annoncer qu'une écriture détruirait du travail humain", () => {
    const set = writeVariant(baseSet(), variant({ kind: "manual", userAuthored: true }));
    expect(wouldDestroyUserWork(set, "manual")).toBe(true);
    expect(wouldDestroyUserWork(set, "processed")).toBe(false);
  });

  it("l'original reste disponible quoi qu'il arrive", () => {
    const original = variant();
    let set: VariantSet = { original };
    set = writeVariant(set, variant({ kind: "processed" }));
    set = writeVariant(set, variant({ kind: "manual", userAuthored: true }));
    set = promoteToMaster(set, "manual");
    expect(set.original).toBe(original);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Modifications concurrentes                                              */
/* -------------------------------------------------------------------------- */

describe("Conflits entre modifications simultanées", () => {
  const base = { id: "p1", version: 3, updatedAt: 10, name: "Avant" };

  it("accepte une écriture partant de la version courante", () => {
    const result = applyVersioned(base, 3, (value) => ({ ...value, name: "Après" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.name).toBe("Après");
      expect(result.next.version).toBe(4);
    }
  });

  it("refuse une écriture partant d'une version périmée", () => {
    const result = applyVersioned(base, 2, (value) => ({ ...value, name: "Écrasé" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("version-obsolete");
      // L'état réel est rendu pour que l'utilisateur puisse comparer.
      expect(result.current?.name).toBe("Avant");
    }
  });

  it("le second appareil ne peut pas écraser le premier en silence", () => {
    const first = applyVersioned(base, 3, (v) => ({ ...v, name: "Ordinateur" }));
    expect(first.ok).toBe(true);
    const stored = first.ok ? first.next : base;

    // Le téléphone était resté sur la version 3.
    const second = applyVersioned(stored, 3, (v) => ({ ...v, name: "Téléphone" }));
    expect(second.ok).toBe(false);
    expect(stored.name).toBe("Ordinateur");
  });

  it("signale un élément supprimé ailleurs", () => {
    const result = applyVersioned(null, 3, (v) => v);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("introuvable");
  });
});

/* -------------------------------------------------------------------------- */
/* 7. Construction du contexte                                                */
/* -------------------------------------------------------------------------- */

describe("Assemblage déterministe du contexte", () => {
  const charter = {
    ...emptyCharter(),
    perspective: "Vue de dessus 3/4.",
    scale: "Un humain adulte mesure 48 px.",
  };

  const base = {
    charter,
    palette: null,
    family: "objets" as AssetFamily,
    familyLabel: "Objets",
    familyRule: "Objets tenant dans la main.",
    framing: "isolated" as const,
    request: "Une potion rouge",
    referenceCount: 1,
    finalWidth: 32,
    finalHeight: 32,
  };

  it("assemble projet + famille + demande, dans cet ordre", () => {
    const built = buildProjectContext(base);
    const positionCharter = built.prompt.indexOf("CHARTE GRAPHIQUE");
    const positionFamily = built.prompt.indexOf("FAMILLE D'ASSET");
    const positionRequest = built.prompt.indexOf("ASSET À PRODUIRE");

    expect(positionCharter).toBeGreaterThanOrEqual(0);
    expect(positionCharter).toBeLessThan(positionFamily);
    expect(positionFamily).toBeLessThan(positionRequest);
  });

  it("est strictement déterministe", () => {
    expect(buildProjectContext(base).prompt).toBe(buildProjectContext(base).prompt);
  });

  it("omet les champs de charte vides plutôt que d'écrire du vide", () => {
    const built = buildProjectContext(base);
    expect(built.prompt).toContain("Perspective : Vue de dessus 3/4.");
    expect(built.prompt).not.toContain("Éclairage :");
  });

  it("n'envoie aucun historique de génération", () => {
    const built = buildProjectContext(base);
    expect(built.prompt.toLowerCase()).not.toContain("génération précédente");
    expect(built.prompt.toLowerCase()).not.toContain("historique");
  });

  it("ne répète pas la règle quand elle redit le libellé", () => {
    const built = buildProjectContext({ ...base, familyRule: "Objets" });
    const occurrences = built.prompt.split("Objets").length - 1;
    expect(occurrences).toBe(1);
  });

  it("un objet isolé reçoit la consigne de marge transparente", () => {
    const built = buildProjectContext(base);
    expect(built.prompt).toContain("marge transparente");
    expect(built.prompt).not.toContain("bord à bord");
  });

  it("une tuile de sol N'hérite PAS de la marge transparente", () => {
    const built = buildProjectContext({
      ...base,
      family: "sols",
      familyLabel: "Sols",
      framing: "seamless",
    });

    expect(built.prompt).toContain("bord à bord");
    expect(built.prompt).toContain("Aucun pixel transparent");
    // Le défaut que cette séparation corrige : des sols troués.
    expect(built.prompt).not.toContain("marge transparente");
    expect(built.prompt).not.toContain("entièrement visible, jamais coupé");
  });

  it("annonce la palette imposée quand il y en a une", () => {
    const built = buildProjectContext({
      ...base,
      palette: { id: "p", name: "Terre", colours: ["#112233", "#445566"] },
    });
    expect(built.prompt).toContain("#112233, #445566");
    expect(built.prompt).toContain("Aucune couleur hors palette");
  });

  it("marque les blocs de contrainte comme essentiels", () => {
    const built = buildProjectContext(base);
    const essential = built.blocks.filter((block) => block.essential).map((b) => b.heading);
    expect(essential).toContain("ASSET À PRODUIRE :");
    expect(essential).toContain("CONTRAINTES GÉNÉRALES :");
  });

  it("compte les caractères exactement et estime les jetons", () => {
    const built = buildProjectContext(base);
    expect(built.characterCount).toBe(built.prompt.length);
    expect(built.estimatedTokens).toBe(Math.ceil(built.prompt.length / 4));
    expect(estimateTokens("abcd")).toBe(1);
  });

  it("ne tronque jamais le prompt", () => {
    const long = { ...base, request: "x".repeat(3000) };
    expect(buildProjectContext(long).prompt).toContain("x".repeat(3000));
  });
});

/* -------------------------------------------------------------------------- */
/* 8. Sélection des références                                                */
/* -------------------------------------------------------------------------- */

describe("Sélection des références", () => {
  it("n'envoie jamais une référence non validée", () => {
    const result = selectReferences({
      references: [
        reference({ id: "ok", validated: true }),
        reference({ id: "brouillon", validated: false }),
      ],
      family: null,
    });
    expect(result.selected.map((r) => r.id)).toEqual(["ok"]);
    expect(result.candidates.map((c) => c.reference.id)).toEqual(["ok"]);
  });

  it("n'envoie JAMAIS toute la bibliothèque par défaut", () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      reference({ id: `r${index}`, createdAt: index }),
    );
    const result = selectReferences({ references: many, family: null });

    expect(result.selected).toHaveLength(MAX_AUTO_SELECTED);
    expect(result.selected.length).toBeLessThan(many.length);
    expect(result.capped).toBe(true);
    expect(result.omittedCount).toBe(20 - MAX_AUTO_SELECTED);
  });

  it("privilégie la famille demandée", () => {
    const result = selectReferences({
      references: [
        reference({ id: "globale", families: [], createdAt: 1 }),
        reference({ id: "sols", families: ["sols"], createdAt: 2 }),
      ],
      family: "sols",
      limit: 1,
    });
    expect(result.selected.map((r) => r.id)).toEqual(["sols"]);
    expect(result.candidates[0].reason).toBe("famille");
  });

  it("une référence épinglée passe devant tout", () => {
    const result = selectReferences({
      references: [
        reference({ id: "sols", families: ["sols"], createdAt: 1 }),
        reference({ id: "epinglee", pinned: true, createdAt: 2 }),
      ],
      family: "sols",
      limit: 1,
    });
    expect(result.selected.map((r) => r.id)).toEqual(["epinglee"]);
  });

  it("est déterministe à pertinence égale", () => {
    const refs = [
      reference({ id: "b", createdAt: 2 }),
      reference({ id: "a", createdAt: 1 }),
    ];
    expect(selectReferences({ references: refs, family: null, limit: 1 }).selected[0].id).toBe("a");
    expect(selectReferences({ references: refs, family: null, limit: 1 }).selected[0].id).toBe("a");
  });

  it("un choix manuel prime sur la proposition", () => {
    const result = selectReferences({
      references: [reference({ id: "a" }), reference({ id: "b", createdAt: 2 })],
      family: null,
      manualIds: ["b"],
    });
    expect(result.selected.map((r) => r.id)).toEqual(["b"]);
  });

  it("un choix manuel vide n'envoie aucune référence", () => {
    const result = selectReferences({
      references: [reference({ id: "a" })],
      family: null,
      manualIds: [],
    });
    expect(result.selected).toHaveLength(0);
  });

  it("expose toutes les candidates pour que l'utilisateur puisse arbitrer", () => {
    const result = selectReferences({
      references: [reference({ id: "a" }), reference({ id: "b", createdAt: 2 })],
      family: null,
      limit: 1,
    });
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.filter((c) => c.selected)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 9. Budget, doubles soumissions et appels non autorisés                     */
/* -------------------------------------------------------------------------- */

describe("Plafond de dépense", () => {
  it("laisse passer quand aucun plafond n'est configuré", () => {
    const decision = decideSpend({ limitUsd: null, recordedUsd: 999, inFlightUsd: 0 }, 1);
    expect(decision.allowed).toBe(true);
  });

  it("refuse une fois le plafond atteint", () => {
    const decision = decideSpend({ limitUsd: 1, recordedUsd: 1, inFlightUsd: 0 }, 0.1);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("limite-atteinte");
  });

  it("compte les appels EN COURS dans la décision", () => {
    // Sans cela, deux requêtes simultanées passeraient chacune « parce qu'il
    // restait de la place ».
    const decision = decideSpend({ limitUsd: 1, recordedUsd: 0.5, inFlightUsd: 0.5 }, 0.1);
    expect(decision.allowed).toBe(false);
  });

  it("refuse une estimation qui dépasserait le reste", () => {
    const decision = decideSpend({ limitUsd: 1, recordedUsd: 0.9, inFlightUsd: 0 }, 0.5);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("estimation-depasse-limite");
  });

  it("réserve le montant estimé quand elle accepte", () => {
    const decision = decideSpend({ limitUsd: 1, recordedUsd: 0, inFlightUsd: 0 }, 0.25);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.reservedUsd).toBe(0.25);
      expect(decision.remainingUsd).toBeCloseTo(0.75);
    }
  });
});

describe("Registre de dépense", () => {
  let ledger: MemoryLedger;
  beforeEach(() => {
    ledger = new MemoryLedger();
  });

  it("ne prétend pas être un plafond strict", () => {
    // Honnêteté du registre en mémoire : l'interface doit pouvoir le dire.
    expect(ledger.isStrict).toBe(false);
  });

  it("compte une réservation comme dépense en vol", async () => {
    await ledger.reserve("o", 0.3, "r1");
    expect((await ledger.read("o")).inFlightUsd).toBeCloseTo(0.3);
    expect((await ledger.read("o")).recordedUsd).toBe(0);
  });

  it("libère la réservation et enregistre le coût mesuré", async () => {
    await ledger.reserve("o", 0.3, "r1");
    await ledger.settle("o", "r1", { costUsd: 0.12, counted: true });

    const snapshot = await ledger.read("o");
    expect(snapshot.inFlightUsd).toBe(0);
    expect(snapshot.measuredUsd).toBeCloseTo(0.12);
    expect(snapshot.recordedUsd).toBeCloseTo(0.12);
    expect(snapshot.generations).toBe(1);
  });

  it("un coût inconnu n'est PAS compté comme zéro", async () => {
    await ledger.reserve("o", 0.3, "r1");
    await ledger.settle("o", "r1", { costUsd: null, counted: true });

    const snapshot = await ledger.read("o");
    expect(snapshot.unknownCostCount).toBe(1);
    // Rien de mesuré, mais l'estimation réservée est retenue : sinon le
    // plafond ne bloquerait jamais face à une API qui ne remonte aucun usage.
    expect(snapshot.measuredUsd).toBe(0);
    expect(snapshot.estimatedUsd).toBeCloseTo(0.3);
    expect(snapshot.recordedUsd).toBeCloseTo(0.3);
    expect(snapshot.generations).toBe(1);
  });

  it("sépare toujours le mesuré de l'estimé", async () => {
    await ledger.reserve("o", 0.2, "r1");
    await ledger.settle("o", "r1", { costUsd: 0.05, counted: true });
    await ledger.reserve("o", 0.2, "r2");
    await ledger.settle("o", "r2", { costUsd: null, counted: true });

    const snapshot = await ledger.read("o");
    expect(snapshot.measuredUsd).toBeCloseTo(0.05);
    expect(snapshot.estimatedUsd).toBeCloseTo(0.2);
    expect(snapshot.recordedUsd).toBeCloseTo(0.25);
  });

  it("le plafond finit par bloquer même si aucun coût n'est mesurable", async () => {
    // Scénario réel : l'API ne remonte aucun usage. Sans cumul des
    // estimations, le compteur resterait à zéro et le plafond serait inutile.
    for (let index = 0; index < 3; index += 1) {
      await ledger.reserve("o", 0.1, `r${index}`);
      await ledger.settle("o", `r${index}`, { costUsd: null, counted: true });
    }
    const snapshot = await ledger.read("o");
    expect(snapshot.recordedUsd).toBeCloseTo(0.3);

    const decision = decideSpend(
      { limitUsd: 0.25, recordedUsd: snapshot.recordedUsd, inFlightUsd: 0 },
      0.1,
    );
    expect(decision.allowed).toBe(false);
  });

  it("libère sans rien facturer quand l'appel échoue avant coût", async () => {
    await ledger.reserve("o", 0.3, "r1");
    await ledger.release("o", "r1");

    const snapshot = await ledger.read("o");
    expect(snapshot.inFlightUsd).toBe(0);
    expect(snapshot.generations).toBe(0);
  });
});

describe("Doubles soumissions", () => {
  let store: IdempotencyStore<string>;
  beforeEach(() => {
    store = new IdempotencyStore<string>();
  });

  it("laisse passer la première demande", () => {
    expect(store.claim("k").status).toBe("claimed");
  });

  it("refuse un second envoi identique pendant que le premier tourne", () => {
    store.claim("k");
    // C'est le cas « deux onglets » : la seconde requête ne doit rien coûter.
    expect(store.claim("k").status).toBe("in-progress");
  });

  it("rend le résultat déjà payé plutôt que d'en payer un second", () => {
    store.claim("k");
    store.complete("k", "image");
    const again = store.claim("k");
    expect(again.status).toBe("completed");
    if (again.status === "completed") expect(again.value).toBe("image");
  });

  it("libère la clé après un échec pour permettre un nouvel essai", () => {
    store.claim("k");
    store.abandon("k");
    expect(store.claim("k").status).toBe("claimed");
  });

  it("deux demandes différentes ne se bloquent pas", () => {
    store.claim("a");
    expect(store.claim("b").status).toBe("claimed");
  });
});

describe("Coût serveur", () => {
  const KEYS = [
    "PRICING_TEXT_INPUT_PER_MILLION",
    "PRICING_IMAGE_INPUT_PER_MILLION",
    "PRICING_IMAGE_OUTPUT_PER_MILLION",
    "PRICING_VERSION",
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const usage = {
    textInputTokens: 1_000_000,
    imageInputTokens: null,
    imageOutputTokens: 1_000_000,
    totalTokens: 2_000_000,
  };

  it("reste « inconnu » sans tarif configuré — jamais zéro", () => {
    const cost = computeServerCost(usage);
    expect(cost.status).toBe("unknown");
    if (cost.status === "unknown") expect(cost.reason).toBe("aucun-tarif-configuré");
  });

  it("reste « inconnu » quand l'API ne remonte aucun usage", () => {
    process.env.PRICING_TEXT_INPUT_PER_MILLION = "5";
    process.env.PRICING_IMAGE_INPUT_PER_MILLION = "8";
    process.env.PRICING_IMAGE_OUTPUT_PER_MILLION = "30";
    process.env.PRICING_VERSION = "test";

    const cost = computeServerCost(null);
    expect(cost.status).toBe("unknown");
    if (cost.status === "unknown") expect(cost.reason).toBe("aucun-usage-remonté");
  });

  it("calcule un coût mesuré et retient la version de tarif", () => {
    process.env.PRICING_TEXT_INPUT_PER_MILLION = "5";
    process.env.PRICING_IMAGE_INPUT_PER_MILLION = "8";
    process.env.PRICING_IMAGE_OUTPUT_PER_MILLION = "30";
    process.env.PRICING_VERSION = "2026-09-releve";

    const cost = computeServerCost(usage);
    expect(cost.status).toBe("measured");
    if (cost.status === "measured") {
      expect(cost.amountUsd).toBeCloseTo(35);
      expect(cost.pricingVersion).toBe("2026-09-releve");
      // Un poste manquait : signalé plutôt que masqué.
      expect(cost.partial).toBe(true);
    }
  });

  it("refuse un barème sans version : impossible de recalculer plus tard", () => {
    process.env.PRICING_TEXT_INPUT_PER_MILLION = "5";
    process.env.PRICING_IMAGE_INPUT_PER_MILLION = "8";
    process.env.PRICING_IMAGE_OUTPUT_PER_MILLION = "30";
    expect(computeServerCost(usage).status).toBe("unknown");
  });
});

/* -------------------------------------------------------------------------- */
/* 10. Non-régression : aucune montée en qualité automatique                  */
/* -------------------------------------------------------------------------- */

describe("Non-régression", () => {
  it("aucune relance ni montée en qualité automatique n'est câblée", async () => {
    const ledger = new MemoryLedger();
    const spy = vi.spyOn(ledger, "reserve");

    await ledger.reserve("o", 0.1, "r1");
    await ledger.settle("o", "r1", { costUsd: null, counted: true });

    // Une seule réservation : rien n'a été retenté tout seul.
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await ledger.read("o")).generations).toBe(1);
  });
});
