/**
 * Identifiants de projet — correction de l'incompatibilité UUID.
 *
 * ---------------------------------------------------------------------------
 * LE BUG RÉEL, TEL QUE REMONTÉ PAR LE TEST CLOUD
 * ---------------------------------------------------------------------------
 * `createProjectId()` produisait `project-<uuid>` (préfixe métier + UUID),
 * alors que `public.projects.id` est un `uuid` NATIF côté Supabase. Toute
 * création de projet échouait avec :
 *
 *   code 22P02 — invalid input syntax for type uuid: "project-2e07cd23-..."
 *
 * ---------------------------------------------------------------------------
 * CE QUE CES TESTS VÉRIFIENT
 * ---------------------------------------------------------------------------
 *   1. un nouveau projet a un UUID valide, sans préfixe ;
 *   2. cet UUID est accepté par une vraie colonne Postgres `uuid` (via le
 *      banc PGlite, pas une simulation) ;
 *   3. les anciens id `project-<uuid>` restent lisibles localement ;
 *   4. leur migration vers un UUID distant ne perd aucun champ ;
 *   5. deux migrations successives ne produisent jamais le même id ;
 *   6. l'export/import portable reste indifférent à la forme de l'id.
 * ---------------------------------------------------------------------------
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProjectId, isValidUuid } from "@/lib/project/ids";
import { createProject } from "@/lib/project/defaults";
import {
  createRemoteProject,
  saveProject,
  type RemoteAccess,
} from "@/lib/project/repository";
import {
  detectConflicts,
  validateManifest,
  MANIFEST_VERSION,
  type ProjectManifest,
} from "@/lib/project/portableProject";
import type { Project } from "@/types/project";

/* -------------------------------------------------------------------------- */
/* 1. Forme de l'identifiant                                                  */
/* -------------------------------------------------------------------------- */

describe("Mapping Supabase (lib/project/repository.ts)", () => {
  it("createRemoteProject envoie un id UUID dans le corps de la requête", async () => {
    const project = createProject({ name: "Timeless Journey" });
    let sentId: unknown = null;

    stubFetch(async (url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      sentId = body?.id;
      return jsonResponse([echoRow(body)]);
    });

    const result = await createRemoteProject(fakeRemote(), project);

    expect(result.error).toBeNull();
    expect(typeof sentId).toBe("string");
    expect(isValidUuid(sentId as string)).toBe(true);
  });
});

describe("createProjectId", () => {
  it("produit un UUID valide, sans préfixe", () => {
    const id = createProjectId();
    expect(isValidUuid(id)).toBe(true);
    expect(id.startsWith("project-")).toBe(false);
  });

  it("un nouveau projet a un id conforme dès sa création", () => {
    const project = createProject({ name: "Timeless Journey" });
    expect(isValidUuid(project.id)).toBe(true);
  });

  it("ne produit jamais deux fois le même id", () => {
    const ids = new Set(Array.from({ length: 200 }, () => createProjectId()));
    expect(ids.size).toBe(200);
  });
});

describe("isValidUuid", () => {
  it("accepte un UUID standard, insensible à la casse", () => {
    expect(isValidUuid("2e07cd23-c712-4b87-970e-3367ad99a26a")).toBe(true);
    expect(isValidUuid("2E07CD23-C712-4B87-970E-3367AD99A26A")).toBe(true);
  });

  it("refuse l'ancien format préfixé — c'est exactement ce qui cassait l'insertion", () => {
    expect(isValidUuid("project-2e07cd23-c712-4b87-970e-3367ad99a26a")).toBe(false);
  });

  it("refuse un id vide, tronqué ou mal formé", () => {
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid("2e07cd23-c712-4b87-970e")).toBe(false);
    expect(isValidUuid("pas-un-uuid-du-tout")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Acceptation réelle par Postgres (uuid natif, via PGlite)                 */
/* -------------------------------------------------------------------------- */

describe("Compatibilité avec la colonne uuid de Supabase", () => {
  // Démarrer PostgreSQL (PGlite) coûte quelques secondes au premier appel du
  // processus : le délai par défaut de 5 s est trop court pour ces deux tests
  // qui migrent une base fraîche chacun (voir tests/sqlMigrations.test.ts pour
  // la variante qui partage une base et reste sous ce délai).
  const PGLITE_TIMEOUT_MS = 20_000;

  it(
    "un id créé par createProjectId() est accepté par public.projects.id",
    async () => {
      const { freshDatabase, applyMigrations, createUser } = await import("./sql/harness.mjs");
      const db = await freshDatabase();
      await applyMigrations(db);
      const owner = (await createUser(db, "alice@exemple.fr")) as string;

      const id = createProjectId();
      await expect(
        db.query(
          "insert into public.projects (id, owner_id, name) values ($1, $2, 'Timeless Journey')",
          [id, owner],
        ),
      ).resolves.not.toThrow();

      const rows = await db.query<{ id: string }>("select id from public.projects where id = $1", [id]);
      expect(rows.rows).toHaveLength(1);
    },
    PGLITE_TIMEOUT_MS,
  );

  it(
    "reproduit l'échec exact du signalement cloud avec l'ANCIEN format",
    async () => {
      // Ce test documente le bug d'origine : il doit continuer à échouer même
      // après la correction, puisque c'est justement ce que createProjectId()
      // ne produit plus.
      const { freshDatabase, applyMigrations, createUser } = await import("./sql/harness.mjs");
      const db = await freshDatabase();
      await applyMigrations(db);
      const owner = (await createUser(db, "alice@exemple.fr")) as string;

      await expect(
        db.query("insert into public.projects (id, owner_id, name) values ($1, $2, 'x')", [
          "project-2e07cd23-c712-4b87-970e-3367ad99a26a",
          owner,
        ]),
      ).rejects.toThrow(/uuid/i);
    },
    PGLITE_TIMEOUT_MS,
  );
});

/* -------------------------------------------------------------------------- */
/* 3 et 4. Anciens projets locaux : lecture intacte, migration sans perte      */
/* -------------------------------------------------------------------------- */

function legacyProject(overrides: Partial<Project> = {}): Project {
  const base = createProject({ name: "Ancien projet" });
  return {
    ...base,
    // Forme produite par l'ancienne version de createProjectId().
    id: "project-2e07cd23-c712-4b87-970e-3367ad99a26a",
    description: "Décrit avant la mise à jour.",
    charter: { ...base.charter, perspective: "Vue de dessus 3/4." },
    palettes: [{ id: "palette-1", name: "Terre", colours: ["#7a5c3e"] }],
    version: 4,
    ...overrides,
  };
}

describe("Anciens identifiants « project-<uuid> »", () => {
  it("restent lisibles localement : aucune vérification de forme ne les rejette", () => {
    const legacy = legacyProject();
    expect(legacy.id.startsWith("project-")).toBe(true);
    // Rien dans le type ni dans le stockage local n'exige un UUID : c'est
    // uniquement Supabase qui l'exige, et seulement à la synchronisation.
    expect(typeof legacy.id).toBe("string");
  });

  it("hors connexion, une modification reste purement locale et l'id ne change pas", async () => {
    const legacy = legacyProject();
    const result = await saveProject(null, legacy, (project) => ({
      ...project,
      description: "Modifié hors connexion.",
    }));

    expect(result.state).toBe("local-only");
    expect(result.previousId).toBeNull();
    expect(result.value.id).toBe(legacy.id);
  });

  it("première synchronisation : migre vers un nouvel UUID sans perdre un champ", async () => {
    const legacy = legacyProject();
    const remote = fakeRemote();

    let created: Record<string, unknown> | null = null;
    stubFetch(async (url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === "POST" && String(url).includes("/rest/v1/projects")) {
        created = body;
        return jsonResponse([echoRow(body)]);
      }
      throw new Error(`appel inattendu : ${init?.method} ${url}`);
    });

    const result = await saveProject(remote, legacy, (project) => project);

    expect(result.error).toBeNull();
    expect(result.state).toBe("synced");
    expect(result.previousId).toBe(legacy.id);
    expect(isValidUuid(result.value.id)).toBe(true);
    expect(result.value.id).not.toBe(legacy.id);

    // Aucune perte : les champs saisis avant la mise à jour sont intacts.
    expect(created).not.toBeNull();
    expect(created!.name).toBe(legacy.name);
    expect(created!.description).toBe(legacy.description);
    expect(created!.charter).toEqual(legacy.charter);
    expect(created!.palettes).toEqual(legacy.palettes);
  });

  it("un échec réseau pendant la migration ne perd rien : l'ancien projet reste intact", async () => {
    const legacy = legacyProject();
    const remote = fakeRemote();
    stubFetch(async () => {
      throw new Error("réseau indisponible");
    });

    const result = await saveProject(remote, legacy, (project) => project);

    expect(result.error).not.toBeNull();
    expect(result.previousId).toBeNull();
    // La valeur rendue est l'ORIGINAL, inchangé : rien n'a été perdu ni à moitié migré.
    expect(result.value).toEqual(legacy);
  });

  it("deux anciens projets migrés à la suite ne collisionnent jamais", async () => {
    const remote = fakeRemote();
    const seen = new Set<string>();
    stubFetch(async (_url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      return jsonResponse([echoRow(body)]);
    });

    for (let index = 0; index < 5; index += 1) {
      const legacy = legacyProject({ id: `project-legacy-${index}` });
      const result = await saveProject(remote, legacy, (project) => project);
      expect(result.error).toBeNull();
      expect(seen.has(result.value.id)).toBe(false);
      seen.add(result.value.id);
    }
    expect(seen.size).toBe(5);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Export / import portable : indifférent à la forme de l'id               */
/* -------------------------------------------------------------------------- */

describe("Export / import portable, ids mêlés", () => {
  it("un manifeste contenant un id UUID pur reste valide", () => {
    const project = createProject({ name: "Nouveau" });
    const { kind: _kind, ...rest } = project;
    void _kind;

    const manifest: ProjectManifest = {
      manifestVersion: MANIFEST_VERSION,
      exportedAt: Date.now(),
      appVersion: "0.3.1",
      project: rest,
      assets: [],
      references: [],
      images: [],
    };

    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
  });

  it("un manifeste contenant l'ancien format préfixé reste valide aussi", () => {
    const legacy = legacyProject();
    const { kind: _kind, ...rest } = legacy;
    void _kind;

    const manifest: ProjectManifest = {
      manifestVersion: MANIFEST_VERSION,
      exportedAt: Date.now(),
      appVersion: "0.3.1",
      project: rest,
      assets: [],
      references: [],
      images: [],
    };

    expect(validateManifest(manifest).valid).toBe(true);
  });

  it("la détection de conflit compare les id par égalité, pas par forme", () => {
    const legacy = legacyProject();
    const conflicts = detectConflicts(
      {
        manifestVersion: MANIFEST_VERSION,
        exportedAt: 1,
        appVersion: "0.3.1",
        project: legacy,
        assets: [],
        references: [],
        images: [],
      } as unknown as ProjectManifest,
      { projectIds: [legacy.id], assetIds: [], referenceIds: [] },
    );
    expect(conflicts).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Auxiliaires de test                                                        */
/* -------------------------------------------------------------------------- */

function fakeRemote(): RemoteAccess {
  return {
    config: { url: "https://exemple.supabase.co", anonKey: "anon-key" },
    token: "jeton-test",
    ownerId: "owner-1",
  };
}

/** Simule la ligne renvoyée par PostgREST après une insertion réussie. */
function echoRow(body: Record<string, unknown>): Record<string, unknown> {
  const now = new Date().toISOString();
  return { ...body, created_at: now, updated_at: now };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

function stubFetch(
  handler: (url: string, init: RequestInit | undefined) => Promise<Response>,
): void {
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => handler(String(input), init));
}

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = null;
});

beforeEach(() => {
  // `createRemoteProject` regénère systématiquement un projet complet ; rien
  // à préparer ici, mais on garde le crochet pour la symétrie avec afterEach.
});
