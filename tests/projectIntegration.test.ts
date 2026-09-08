/**
 * Parcours complet du mode projet.
 *
 * Ces tests exercent les routes réelles et l'enchaînement des modules, pas des
 * fonctions isolées. Ils tournent en mode maquette : aucun appel payant.
 *
 * CE QU'ILS NE COUVRENT PAS : la synchronisation Supabase réelle. Sans projet
 * Supabase configuré, aucun test ici ne peut prouver qu'un projet se retrouve
 * sur un autre appareil. Les tests correspondants sont décrits dans le bilan,
 * à exécuter une fois la configuration faite.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkReadiness,
  generationIdempotency,
  guardGeneration,
  settleGeneration,
} from "@/lib/budget/guard";
import { MemoryLedger } from "@/lib/budget/ledger";
import { buildRequestKey, parseRequestKey } from "@/lib/generation/requestIntent";
import { buildGenerationRequest } from "@/lib/generation/payload";
import { buildProjectContext } from "@/lib/project/contextBuilder";
import { createProject, familyRuleOf } from "@/lib/project/defaults";
import { selectReferences } from "@/lib/project/referenceSelection";
import { promoteToMaster, writeVariant, type AssetVariant, type VariantSet } from "@/lib/library/variants";
import { validateManifest, MANIFEST_VERSION, type ProjectManifest } from "@/lib/project/portableProject";
import { planLegacyImport } from "@/lib/project/legacyImport";
import { SYNCED_SCOPE, SYNC_HINTS } from "@/lib/project/repository";
import { FAMILY_LABELS } from "@/types/project";
import type { ProjectReference } from "@/types/project";
import type { GenerationSettings } from "@/lib/generation/payload";
import type { StylePack } from "@/types/domain";

/* -------------------------------------------------------------------------- */
/* Environnement                                                              */
/* -------------------------------------------------------------------------- */

const ENV_KEYS = [
  "MOCK_OPENAI",
  "GENERATION_ALLOWLIST",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GENERATION_SPEND_LIMIT_USD",
  "GENERATION_ESTIMATED_COST_USD",
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  // Le cache d'idempotence est un singleton de module : sans remise à zéro, un
  // test hériterait des clés du précédent.
  generationIdempotency.reset();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function post(headers: Record<string, string> = {}): Request {
  return new Request("https://exemple.fr/api/generate", { method: "POST", headers });
}

const SETTINGS: GenerationSettings = {
  finalSizeEnabled: true,
  finalWidth: 32,
  finalHeight: 32,
  qualityMode: "auto",
  pixelPipeline: "grid",
  size: "auto",
  quality: "auto",
  background: "transparent",
  outputFormat: "png",
};

const PACK: StylePack = {
  id: "pack-1",
  name: "Pack",
  context: "Pixel art.",
  categories: [],
  createdAt: 1,
  updatedAt: 1,
};

function reference(overrides: Partial<ProjectReference> = {}): ProjectReference {
  return {
    kind: "project-reference",
    id: "ref-1",
    projectId: "p1",
    ownerId: null,
    name: "ref.png",
    mimeType: "image/png",
    width: 48,
    height: 48,
    size: 10,
    validated: true,
    pinned: false,
    families: [],
    createdAt: 1,
    blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* 1. Le socle est fermé par défaut                                           */
/* -------------------------------------------------------------------------- */

describe("Sécurité par défaut", () => {
  it("bloque la génération réelle quand rien n'est configuré", () => {
    const readiness = checkReadiness();
    expect(readiness.mockMode).toBe(false);
    expect(readiness.canGenerate).toBe(false);
    expect(readiness.blockers.length).toBeGreaterThan(0);
  });

  it("nomme précisément chaque configuration manquante", () => {
    const blockers = checkReadiness().blockers.join(" ");
    expect(blockers).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(blockers).toContain("GENERATION_ALLOWLIST");
    expect(blockers).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("refuse l'appel plutôt que de retomber sur un compteur en mémoire", async () => {
    await expect(
      guardGeneration(post(), { idempotencyKey: null, projectId: "p1" }),
    ).rejects.toThrow(/bloquée par sécurité/);
  });

  it("une liste d'autorisation absente suffit à bloquer", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    // Tout est là SAUF la liste : on doit refuser.
    const readiness = checkReadiness();
    expect(readiness.canGenerate).toBe(false);
    expect(readiness.blockers.join(" ")).toContain("GENERATION_ALLOWLIST");
  });

  it("le mode maquette reste ouvert : il ne coûte rien", () => {
    process.env.MOCK_OPENAI = "1";
    const readiness = checkReadiness();
    expect(readiness.mockMode).toBe(true);
    expect(readiness.canGenerate).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Répétition accidentelle ≠ nouvelle variante                             */
/* -------------------------------------------------------------------------- */

describe("Intention d'une demande", () => {
  const content = {
    mode: "single" as const,
    prompt: "Une potion rouge",
    parameters: [32, 32, "auto"],
    referenceIds: ["r1"],
  };

  it("un renvoi identique produit la MÊME clé", () => {
    const a = buildRequestKey({ ownerId: "u1", projectId: "p1", attempt: 0, content });
    const b = buildRequestKey({ ownerId: "u1", projectId: "p1", attempt: 0, content });
    expect(a).toBe(b);
  });

  it("une nouvelle variante produit une clé DIFFÉRENTE, à contenu identique", () => {
    const first = buildRequestKey({ ownerId: "u1", projectId: "p1", attempt: 0, content });
    const variant = buildRequestKey({ ownerId: "u1", projectId: "p1", attempt: 1, content });
    expect(variant).not.toBe(first);
  });

  it("une empreinte de contenu seule ne distinguerait pas les deux", () => {
    // Le contenu est rigoureusement identique : seule l'intention change.
    const a = buildRequestKey({ ownerId: "u1", projectId: "p1", attempt: 0, content });
    const b = buildRequestKey({ ownerId: "u1", projectId: "p1", attempt: 1, content });
    expect(parseRequestKey(a)?.digest).toBe(parseRequestKey(b)?.digest);
    expect(parseRequestKey(a)?.attempt).not.toBe(parseRequestKey(b)?.attempt);
  });

  it("deux comptes ne partagent jamais une clé", () => {
    const mine = buildRequestKey({ ownerId: "u1", projectId: "p1", attempt: 0, content });
    const theirs = buildRequestKey({ ownerId: "u2", projectId: "p1", attempt: 0, content });
    expect(mine).not.toBe(theirs);
    expect(parseRequestKey(mine)?.ownerId).toBe("u1");
  });

  it("deux projets ne partagent jamais une clé", () => {
    const a = buildRequestKey({ ownerId: "u1", projectId: "p1", attempt: 0, content });
    const b = buildRequestKey({ ownerId: "u1", projectId: "p2", attempt: 0, content });
    expect(a).not.toBe(b);
  });

  it("refuse une clé mal formée", () => {
    expect(parseRequestKey("nimportequoi")).toBeNull();
    expect(parseRequestKey("v2:u:p:0:abc")).toBeNull();
    expect(parseRequestKey("v1:u:p:-1:abc")).toBeNull();
  });
});

describe("Propriété d'une demande (mode maquette)", () => {
  beforeEach(() => {
    process.env.MOCK_OPENAI = "1";
  });

  const content = {
    mode: "single" as const,
    prompt: "x",
    parameters: [],
    referenceIds: [],
  };

  it("refuse une clé forgée pour un autre compte", async () => {
    const foreign = buildRequestKey({
      ownerId: "quelqu-un-dautre",
      projectId: "p1",
      attempt: 0,
      content,
    });

    await expect(
      guardGeneration(post({ "x-idempotency-key": foreign }), {
        idempotencyKey: foreign,
        projectId: "p1",
      }),
    ).rejects.toThrow(/n'appartient pas à votre compte/);
  });

  it("refuse une clé forgée pour un autre projet", async () => {
    const otherProject = buildRequestKey({
      ownerId: "local-owner",
      projectId: "autre-projet",
      attempt: 0,
      content,
    });

    await expect(
      guardGeneration(post({ "x-idempotency-key": otherProject }), {
        idempotencyKey: otherProject,
        projectId: "p1",
      }),
    ).rejects.toThrow(/n'appartient pas à votre compte ou à ce projet/);
  });

  it("bloque un second envoi identique, puis rejoue le résultat payé", async () => {
    const key = buildRequestKey({
      ownerId: "local-owner",
      projectId: "p1",
      attempt: 0,
      content,
    });
    const ledger = new MemoryLedger();

    const first = await guardGeneration(post(), {
      idempotencyKey: key,
      projectId: "p1",
      ledger,
    });
    expect(first.kind).toBe("proceed");

    // Second onglet, pendant que le premier travaille.
    await expect(
      guardGeneration(post(), { idempotencyKey: key, projectId: "p1", ledger }),
    ).rejects.toThrow(/déjà en cours/);

    if (first.kind !== "proceed") throw new Error("garde inattendu");
    await settleGeneration(first.context, {
      costUsd: 0.02,
      counted: true,
      result: { image: "déjà payée" },
    });

    // Une fois terminée, le renvoi rend le résultat au lieu de refacturer.
    const replay = await guardGeneration(post(), {
      idempotencyKey: key,
      projectId: "p1",
      ledger,
    });
    expect(replay.kind).toBe("replay");
    if (replay.kind === "replay") {
      expect(replay.result).toEqual({ image: "déjà payée" });
    }

    // Une seule génération facturée malgré trois envois.
    expect((await ledger.read("local-owner")).generations).toBe(1);
  });

  it("une nouvelle variante volontaire passe et est facturée", async () => {
    const ledger = new MemoryLedger();
    const base = { ownerId: "local-owner", projectId: "p1", content };

    const first = await guardGeneration(post(), {
      idempotencyKey: buildRequestKey({ ...base, attempt: 0 }),
      projectId: "p1",
      ledger,
    });
    if (first.kind !== "proceed") throw new Error("garde inattendu");
    await settleGeneration(first.context, { costUsd: 0.02, counted: true, result: { a: 1 } });

    const variant = await guardGeneration(post(), {
      idempotencyKey: buildRequestKey({ ...base, attempt: 1 }),
      projectId: "p1",
      ledger,
    });
    expect(variant.kind).toBe("proceed");
    if (variant.kind !== "proceed") throw new Error("garde inattendu");
    await settleGeneration(variant.context, { costUsd: 0.02, counted: true, result: { a: 2 } });

    expect((await ledger.read("local-owner")).generations).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Réservations concurrentes                                               */
/* -------------------------------------------------------------------------- */

describe("Réservations budgétaires concurrentes", () => {
  beforeEach(() => {
    process.env.MOCK_OPENAI = "1";
    process.env.GENERATION_SPEND_LIMIT_USD = "0.25";
    process.env.GENERATION_ESTIMATED_COST_USD = "0.10";
  });

  it("trois demandes simultanées ne franchissent pas ensemble le plafond", async () => {
    const ledger = new MemoryLedger();
    const content = { mode: "single" as const, prompt: "x", parameters: [], referenceIds: [] };

    const attempts = [0, 1, 2].map((attempt) =>
      guardGeneration(post(), {
        idempotencyKey: buildRequestKey({
          ownerId: "local-owner",
          projectId: "p1",
          attempt,
          content,
        }),
        projectId: "p1",
        ledger,
      }).then(
        (outcome) => ({ ok: true as const, outcome }),
        (error: Error) => ({ ok: false as const, error }),
      ),
    );

    const results = await Promise.all(attempts);
    const accepted = results.filter((result) => result.ok);

    // 0,25 $ de plafond, 0,10 $ réservé par appel : deux passent, pas trois.
    expect(accepted).toHaveLength(2);
    expect((await ledger.read("local-owner")).inFlightUsd).toBeCloseTo(0.2);
  });

  it("libérer une réservation rend la place disponible", async () => {
    const ledger = new MemoryLedger();
    await ledger.reserve("local-owner", 0.2, "r1", null);
    expect((await ledger.read("local-owner")).inFlightUsd).toBeCloseTo(0.2);
    await ledger.release("local-owner", "r1");
    expect((await ledger.read("local-owner")).inFlightUsd).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Génération rattachée au projet et à ses règles figées                   */
/* -------------------------------------------------------------------------- */

describe("Génération rattachée au projet", () => {
  it("emporte le projet et le numéro d'essai", () => {
    const built = buildGenerationRequest({
      pack: PACK,
      category: null,
      request: "Une potion",
      settings: SETTINGS,
      references: [],
      ownerId: "u1",
      projectId: "projet-timeless",
      attempt: 2,
    });

    expect(built.ownerId).toBe("u1");
    expect(built.projectId).toBe("projet-timeless");
    expect(built.attempt).toBe(2);
  });

  it("reste compatible avec l'existant quand rien n'est fourni", () => {
    const built = buildGenerationRequest({
      pack: PACK,
      category: null,
      request: "Une potion",
      settings: SETTINGS,
      references: [],
    });
    expect(built.projectId).toBe("sans-projet");
    expect(built.attempt).toBe(0);
  });

  it("modifier la charte ensuite ne réécrit pas le contexte déjà produit", () => {
    const project = createProject({ name: "Timeless Journey" });
    project.charter.perspective = "Vue de dessus.";

    const rule = familyRuleOf(project, "objets");
    const before = buildProjectContext({
      charter: project.charter,
      palette: null,
      family: "objets",
      familyLabel: FAMILY_LABELS.objets,
      familyRule: rule.rule,
      framing: rule.framing,
      request: "Une potion",
      referenceCount: 0,
      finalWidth: 32,
      finalHeight: 32,
    });

    // Le contexte figé est une CHAÎNE : la charte peut changer, il ne bouge pas.
    const frozen = before.prompt;
    project.charter.perspective = "Vue de côté.";

    expect(frozen).toContain("Vue de dessus.");
    expect(frozen).not.toContain("Vue de côté.");
  });

  it("les sols n'héritent pas des contraintes des objets", () => {
    const project = createProject({ name: "P" });
    const sols = familyRuleOf(project, "sols");
    const objets = familyRuleOf(project, "objets");

    const sol = buildProjectContext({
      charter: project.charter,
      palette: null,
      family: "sols",
      familyLabel: FAMILY_LABELS.sols,
      familyRule: sols.rule,
      framing: sols.framing,
      request: "Herbe",
      referenceCount: 0,
      finalWidth: 32,
      finalHeight: 32,
    });

    const objet = buildProjectContext({
      charter: project.charter,
      palette: null,
      family: "objets",
      familyLabel: FAMILY_LABELS.objets,
      familyRule: objets.rule,
      framing: objets.framing,
      request: "Potion",
      referenceCount: 0,
      finalWidth: 32,
      finalHeight: 32,
    });

    expect(sol.prompt).toContain("bord à bord");
    expect(sol.prompt).not.toContain("marge transparente");
    expect(objet.prompt).toContain("marge transparente");
    expect(objet.prompt).not.toContain("bord à bord");
  });

  it("n'envoie que les références validées et pertinentes", () => {
    const selection = selectReferences({
      references: [
        reference({ id: "validee-sols", families: ["sols"] }),
        reference({ id: "validee-objets", families: ["objets"], createdAt: 2 }),
        reference({ id: "brouillon", validated: false, createdAt: 3 }),
      ],
      family: "sols",
      limit: 1,
    });

    expect(selection.selected.map((entry) => entry.id)).toEqual(["validee-sols"]);
    expect(selection.candidates.some((c) => c.reference.id === "brouillon")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Conservation des fichiers                                               */
/* -------------------------------------------------------------------------- */

describe("Conservation des fichiers", () => {
  function variant(overrides: Partial<AssetVariant> = {}): AssetVariant {
    return {
      kind: "original",
      blob: new Blob([new Uint8Array([9, 9, 9])], { type: "image/png" }),
      width: 32,
      height: 32,
      mimeType: "image/png",
      createdAt: 1,
      userAuthored: false,
      ...overrides,
    };
  }

  it("un cycle complet préserve l'original et la retouche", () => {
    const original = variant();
    let set: VariantSet = { original };

    set = writeVariant(set, variant({ kind: "processed" }));
    const manual = variant({ kind: "manual", userAuthored: true });
    set = writeVariant(set, manual);
    set = promoteToMaster(set, "manual");
    // Un nouveau traitement automatique arrive : il ne touche rien d'humain.
    set = writeVariant(set, variant({ kind: "processed", createdAt: 99 }));

    expect(set.original).toBe(original);
    expect(set.manual).toBe(manual);
    expect(set.master?.blob).toBe(manual.blob);
  });

  it("l'export puis la relecture conservent chaque image", () => {
    const manifest: ProjectManifest = {
      manifestVersion: MANIFEST_VERSION,
      exportedAt: 1,
      appVersion: "0.3.0",
      project: (() => {
        const { kind: _kind, ...rest } = createProject({ name: "Timeless Journey" });
        void _kind;
        return rest;
      })(),
      assets: [
        {
          id: "a1",
          name: "Potion",
          createdAt: 1,
          family: "objets",
          variants: [
            { kind: "original", ref: "i1" },
            { kind: "master", ref: "i2" },
          ],
        },
      ],
      references: [
        { id: "r1", name: "ref.png", validated: true, pinned: false, families: [], ref: "i3" },
      ],
      images: [
        { ref: "i1", name: "o.png", mimeType: "image/png", width: 32, height: 32, base64: "AAA" },
        { ref: "i2", name: "m.png", mimeType: "image/png", width: 32, height: 32, base64: "BBB" },
        { ref: "i3", name: "r.png", mimeType: "image/png", width: 48, height: 48, base64: "CCC" },
      ],
    };

    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);

    // Chaque variante et chaque référence retrouve bien son image.
    const byRef = new Map(result.manifest!.images.map((image) => [image.ref, image]));
    expect(byRef.get("i2")?.base64).toBe("BBB");
    for (const asset of result.manifest!.assets) {
      for (const v of asset.variants) expect(byRef.has(v.ref)).toBe(true);
    }
    for (const r of result.manifest!.references) expect(byRef.has(r.ref)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Migration de l'ancienne bibliothèque, sans suppression                  */
/* -------------------------------------------------------------------------- */

describe("Migration de l'ancienne bibliothèque", () => {
  const source = [
    { id: "a1", name: "Chêne", createdAt: 1 },
    { id: "a2", name: "Potion", createdAt: 2 },
    { id: "a3", name: "Tuile de sol", createdAt: 3 },
  ];

  it("copie sans rien retirer de la source", () => {
    const before = JSON.stringify(source);
    const plan = planLegacyImport({
      assets: source,
      references: [],
      existingAssetIds: [],
      existingReferenceIds: [],
    });

    expect(plan.assets).toHaveLength(3);
    // La source n'est pas mutée : c'est une copie, jamais un déplacement.
    expect(JSON.stringify(source)).toBe(before);
  });

  it("rejouer l'import ne duplique rien", () => {
    const first = planLegacyImport({
      assets: source,
      references: [],
      existingAssetIds: [],
      existingReferenceIds: [],
    });
    const second = planLegacyImport({
      assets: source,
      references: [],
      existingAssetIds: first.assets.map((asset) => asset.id),
      existingReferenceIds: [],
    });

    expect(second.assets).toHaveLength(0);
    expect(second.skippedAssets).toBe(3);
  });

  it("aucun asset repris ne devient une référence validée", () => {
    const plan = planLegacyImport({
      assets: source,
      references: [],
      existingAssetIds: [],
      existingReferenceIds: [],
    });
    // Le plan ne produit aucune référence à partir des assets.
    expect(plan.references).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. Honnêteté de l'état de synchronisation                                  */
/* -------------------------------------------------------------------------- */

describe("Ce que « Synchronisé » promet", () => {
  it("annonce explicitement ce qui NE suit PAS d'un appareil à l'autre", () => {
    // Aujourd'hui, seule la table `projects` part au serveur. Dire simplement
    // « Synchronisé » laisserait croire que les images suivent aussi.
    expect(SYNCED_SCOPE.localOnly).toContain("références validées");
    expect(SYNCED_SCOPE.localOnly).toContain("bibliothèque d'assets");
    expect(SYNC_HINTS.synced).toMatch(/restent pour l'instant sur cet appareil/);
  });

  it("ne présente jamais « local uniquement » comme une mise à l'abri", () => {
    expect(SYNC_HINTS["local-only"]).toMatch(/ne suivront pas sur un autre appareil/);
  });

  it("dit clairement qu'une erreur n'a RIEN enregistré à distance", () => {
    expect(SYNC_HINTS.error).toMatch(/PAS enregistrée à distance/);
  });
});
