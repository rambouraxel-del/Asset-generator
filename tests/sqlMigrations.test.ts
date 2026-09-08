/**
 * Exécution RÉELLE des migrations dans PostgreSQL (PGlite, en mémoire).
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CES TESTS EXISTENT
 * ---------------------------------------------------------------------------
 * Le SQL a longtemps été « écrit mais jamais exécuté ». Une relecture attentive
 * avait laissé passer une instruction que PostgreSQL refuse
 * (« create policy if not exists »), qui aurait interrompu toute la migration
 * et laissé RLS actif SANS aucune politique. Seule une exécution réelle attrape
 * ce genre de défaut.
 *
 * ---------------------------------------------------------------------------
 * PORTÉE EXACTE
 * ---------------------------------------------------------------------------
 * COUVERT   : syntaxe, rejouabilité, non-destructivité, isolation par RLS,
 *             concurrence des réservations, comptabilité des coûts,
 *             idempotence entre appels simultanés.
 *
 * NON COUVERT : le vrai `auth.uid()` de Supabase (remplacé par une variable de
 *             session), le stockage de fichiers, et le comportement de
 *             PostgREST. Ces points exigent un projet Supabase réel.
 * ---------------------------------------------------------------------------
 */

import { beforeAll, describe, expect, it } from "vitest";

import {
  applyMigrations,
  asUser,
  createUser,
  freshDatabase,
} from "./sql/harness.mjs";

type Db = Awaited<ReturnType<typeof freshDatabase>>;

/** Ouvre une base migrée, avec deux comptes distincts. */
async function setup(): Promise<{ db: Db; alice: string; bob: string }> {
  const db = await freshDatabase();
  await applyMigrations(db);
  const alice = (await createUser(db, "alice@exemple.fr")) as string;
  const bob = (await createUser(db, "bob@exemple.fr")) as string;
  return { db, alice, bob };
}

/**
 * Base partagée par un bloc de tests.
 *
 * Démarrer PostgreSQL coûte environ deux secondes ; le faire à chaque test
 * rendrait la suite pénible à lancer. Les tests qui la partagent travaillent
 * chacun sur un COMPTE DIFFÉRENT, ce qui les isole aussi sûrement qu'une base
 * neuve — les compteurs et les clés sont tous portés par `owner_id`.
 */
function sharedDatabase() {
  let db: Db;
  let counter = 0;

  return {
    async start() {
      db = await freshDatabase();
      await applyMigrations(db);
    },
    get db() {
      return db;
    },
    /**
     * Nouveau compte ET préfixe de clé, propres à un test.
     *
     * Les clés de réservation et d'idempotence sont des clés PRIMAIRES
     * globales : sans préfixe distinct, deux tests partageant la base se
     * marcheraient dessus.
     */
    async newOwner(): Promise<{ owner: string; key: (name: string) => string }> {
      counter += 1;
      const index = counter;
      const owner = (await createUser(db, `compte-${index}@exemple.fr`)) as string;
      return { owner, key: (name: string) => `t${index}-${name}` };
    },
  };
}

/** Exécute une requête sous le rôle `authenticated`, au nom d'un compte. */
async function asAuthenticated(db: Db, uid: string, sql: string, params: unknown[] = []) {
  await db.exec("set role authenticated");
  try {
    return await asUser(db, uid, sql, params);
  } finally {
    await db.exec("reset role");
  }
}

describe("Migrations : exécution réelle", () => {
  it("s'applique sans erreur sur une base vierge", async () => {
    const db = await freshDatabase();
    await expect(applyMigrations(db)).resolves.not.toThrow();
  });

  it("crée toutes les tables attendues", async () => {
    const { db } = await setup();
    const rows = await db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname='public' order by 1",
    );
    const tables = rows.rows.map((row) => row.tablename);

    for (const expected of [
      "projects",
      "project_references",
      "assets",
      "asset_variants",
      "generations",
      "allowed_generators",
      "spend_ledger",
      "spend_reservations",
      "idempotency_keys",
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it("active RLS sur toutes les tables de données", async () => {
    const { db } = await setup();
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname='public' and c.relkind='r'`,
    );
    for (const row of rows.rows) {
      expect(row.relrowsecurity, `RLS désactivé sur ${row.relname}`).toBe(true);
    }
  });

  it("crée une politique par table protégée", async () => {
    const { db } = await setup();
    const rows = await db.query<{ tablename: string }>(
      "select tablename from pg_policies where schemaname='public'",
    );
    const covered = new Set(rows.rows.map((row) => row.tablename));

    // Sans politique, RLS actif refuse TOUT : l'application serait inutilisable.
    for (const table of [
      "projects",
      "project_references",
      "assets",
      "asset_variants",
      "generations",
      "spend_ledger",
      "spend_reservations",
      "idempotency_keys",
    ]) {
      expect(covered, `aucune politique sur ${table}`).toContain(table);
    }
  });

  it("crée les quatre politiques du bucket privé", async () => {
    const { db } = await setup();
    const rows = await db.query<{ policyname: string }>(
      "select policyname from pg_policies where schemaname='storage'",
    );
    expect(rows.rows).toHaveLength(4);
  });

  it("déclare le bucket comme PRIVÉ", async () => {
    const { db } = await setup();
    const rows = await db.query<{ public: boolean }>(
      "select public from storage.buckets where id='asset-images'",
    );
    expect(rows.rows[0]?.public).toBe(false);
  });

  it("est rejouable : deux applications de suite ne cassent rien", async () => {
    const { db } = await setup();
    await expect(applyMigrations(db)).resolves.not.toThrow();

    // Et toujours exactement une politique par table, pas de doublon.
    const rows = await db.query<{ count: string }>(
      "select count(*) as count from pg_policies where schemaname='public'",
    );
    expect(Number(rows.rows[0].count)).toBe(9);
  });

  it("ne détruit aucune donnée en se rejouant", async () => {
    const { db, alice } = await setup();
    await db.query(
      "insert into public.projects (owner_id, name) values ($1, 'Timeless Journey')",
      [alice],
    );

    await applyMigrations(db);

    const rows = await db.query<{ name: string }>("select name from public.projects");
    expect(rows.rows.map((row) => row.name)).toEqual(["Timeless Journey"]);
  });
});

describe("Isolation par RLS", () => {
  let db: Db;
  let alice: string;
  let bob: string;
  let projectId: string;

  beforeAll(async () => {
    const context = await setup();
    db = context.db;
    alice = context.alice;
    bob = context.bob;

    const created = await asAuthenticated(
      db,
      alice,
      "insert into public.projects (owner_id, name) values ($1, 'Projet Alice') returning id",
      [alice],
    );
    projectId = (created.rows[0] as { id: string }).id;
  });

  it("le propriétaire lit son projet", async () => {
    const rows = await asAuthenticated(db, alice, "select name from public.projects");
    expect(rows.rows).toHaveLength(1);
  });

  it("un autre compte NE VOIT PAS le projet", async () => {
    const rows = await asAuthenticated(db, bob, "select name from public.projects");
    expect(rows.rows).toHaveLength(0);
  });

  it("un autre compte ne peut pas modifier le projet", async () => {
    await asAuthenticated(
      db,
      bob,
      "update public.projects set name = 'Détourné' where id = $1",
      [projectId],
    );
    // Aucune ligne n'est visible pour Bob, donc aucune n'est modifiée.
    const rows = await asAuthenticated(db, alice, "select name from public.projects");
    expect((rows.rows[0] as { name: string }).name).toBe("Projet Alice");
  });

  it("un autre compte ne peut pas s'attribuer un projet", async () => {
    // `with check (owner_id = auth.uid())` doit refuser une insertion au nom d'autrui.
    await expect(
      asAuthenticated(
        db,
        bob,
        "insert into public.projects (owner_id, name) values ($1, 'Usurpé')",
        [alice],
      ),
    ).rejects.toThrow();
  });

  it("les générations d'un compte restent invisibles aux autres", async () => {
    await asAuthenticated(
      db,
      alice,
      `insert into public.generations
         (project_id, owner_id, mode, request, model, quality, generation_size, snapshot, cost_status)
       values ($1, $2, 'single', 'potion', 'gpt-image-2', 'low', '832x832', '{}'::jsonb, 'unknown')`,
      [projectId, alice],
    );

    expect((await asAuthenticated(db, alice, "select id from public.generations")).rows).toHaveLength(1);
    expect((await asAuthenticated(db, bob, "select id from public.generations")).rows).toHaveLength(0);
  });

  it("les dépenses d'un compte restent invisibles aux autres", async () => {
    await db.query("insert into public.spend_ledger (owner_id, measured_usd) values ($1, 1.5)", [alice]);

    expect((await asAuthenticated(db, alice, "select owner_id from public.spend_ledger")).rows).toHaveLength(1);
    expect((await asAuthenticated(db, bob, "select owner_id from public.spend_ledger")).rows).toHaveLength(0);
  });

  it("read_spend REFUSE de lire le compte d'autrui", async () => {
    // Faille corrigée : la fonction contourne RLS, elle doit donc vérifier
    // elle-même que l'appelant ne réclame que ses propres compteurs.
    await expect(
      asAuthenticated(db, bob, "select public.read_spend($1)", [alice]),
    ).rejects.toThrow(/acces refuse/i);
  });

  it("read_spend laisse un compte lire SES compteurs", async () => {
    const rows = await asAuthenticated(db, alice, "select public.read_spend($1) as spend", [alice]);
    const spend = (rows.rows[0] as { spend: { measured_usd: number } }).spend;
    expect(Number(spend.measured_usd)).toBeCloseTo(1.5);
  });

  it("read_spend reste appelable par le serveur (clé de service)", async () => {
    // auth.uid() est nul hors session authentifiée : c'est l'appel serveur.
    const rows = await db.query("select public.read_spend($1) as spend", [alice]);
    expect(rows.rows[0]).toBeDefined();
  });
});

describe("Budget : réservation atomique", () => {
  const shared = sharedDatabase();
  beforeAll(() => shared.start());

  it("accorde tant que le plafond le permet", async () => {
    const db = shared.db;
    const { owner: alice, key } = await shared.newOwner();
    const result = await db.query<{ out: { allowed: boolean } }>(
      "select public.reserve_spend($1, $2, 0.10, 0.25) as out",
      [alice, key("r1")],
    );
    expect(result.rows[0].out.allowed).toBe(true);
  });

  it("refuse au-delà du plafond, appels en vol compris", async () => {
    const db = shared.db;
    const { owner: alice, key } = await shared.newOwner();
    await db.query("select public.reserve_spend($1, $2, 0.10, 0.25)", [alice, key('r1')]);
    await db.query("select public.reserve_spend($1, $2, 0.10, 0.25)", [alice, key('r2')]);

    const third = await db.query<{ out: { allowed: boolean; remaining_usd: string } }>(
      "select public.reserve_spend($1, $2, 0.10, 0.25) as out",
      [alice, key('r3')],
    );
    // 0,25 $ de plafond, 0,10 $ par appel : deux passent, pas trois.
    expect(third.rows[0].out.allowed).toBe(false);
    expect(Number(third.rows[0].out.remaining_usd)).toBeCloseTo(0.05);
  });

  it("trois réservations simultanées n'en laissent passer que deux", async () => {
    const db = shared.db;
    const { owner: alice, key } = await shared.newOwner();
    const results = await Promise.all(
      ["a", "b", "c"].map((suffix) =>
        db.query<{ out: { allowed: boolean } }>(
          "select public.reserve_spend($1, $2, 0.10, 0.25) as out",
          [alice, key(suffix)],
        ),
      ),
    );
    const accepted = results.filter((result) => result.rows[0].out.allowed);
    expect(accepted).toHaveLength(2);
  });

  it("ne double pas une réservation renvoyée sous la même clé", async () => {
    const db = shared.db;
    const { owner: alice, key } = await shared.newOwner();
    await db.query("select public.reserve_spend($1, $2, 0.10, null)", [alice, key('r1')]);
    const again = await db.query<{ out: { duplicate: boolean } }>(
      "select public.reserve_spend($1, $2, 0.10, null) as out",
      [alice, key('r1')],
    );
    expect(again.rows[0].out.duplicate).toBe(true);

    const rows = await db.query<{ count: string }>(
      "select count(*) as count from public.spend_reservations where owner_id = $1",
      [alice],
    );
    expect(Number(rows.rows[0].count)).toBe(1);
  });

  it("sans plafond, rien n'est refusé", async () => {
    const db = shared.db;
    const { owner: alice, key } = await shared.newOwner();
    for (const loopKey of ["a", "b", "c", "d"]) {
      const result = await db.query<{ out: { allowed: boolean } }>(
        "select public.reserve_spend($1, $2, 5, null) as out",
        [alice, key(loopKey)],
      );
      expect(result.rows[0].out.allowed).toBe(true);
    }
  });
});

describe("Budget : clôture et comptabilité", () => {
  const shared = sharedDatabase();
  beforeAll(() => shared.start());

  it("enregistre un coût mesuré et libère la réservation", async () => {
    const db = shared.db;
    const { owner: alice, key } = await shared.newOwner();
    await db.query("select public.reserve_spend($1, $2, 0.10, null)", [alice, key('r1')]);
    const out = await db.query<{ out: Record<string, string | number> }>(
      "select public.settle_spend($1, $2, 0.03, true) as out",
      [alice, key('r1')],
    );

    expect(Number(out.rows[0].out.measured_usd)).toBeCloseTo(0.03);
    expect(Number(out.rows[0].out.estimated_usd)).toBe(0);
    expect(Number(out.rows[0].out.in_flight_usd)).toBe(0);
    expect(Number(out.rows[0].out.generations)).toBe(1);
  });

  it("un coût inconnu retient l'estimation réservée, jamais zéro", async () => {
    const db = shared.db;
    const { owner: alice, key } = await shared.newOwner();
    await db.query("select public.reserve_spend($1, $2, 0.10, null)", [alice, key('r1')]);
    const out = await db.query<{ out: Record<string, string | number> }>(
      "select public.settle_spend($1, $2, null, true) as out",
      [alice, key('r1')],
    );

    expect(Number(out.rows[0].out.measured_usd)).toBe(0);
    expect(Number(out.rows[0].out.estimated_usd)).toBeCloseTo(0.1);
    expect(Number(out.rows[0].out.unknown_cost_count)).toBe(1);
  });

  it("le plafond finit par bloquer même sans coût mesurable", async () => {
    const db = shared.db;
    const { owner: alice, key } = await shared.newOwner();
    for (const loopKey of ["a", "b"]) {
      await db.query("select public.reserve_spend($1, $2, 0.10, 0.25)", [alice, key(loopKey)]);
      await db.query("select public.settle_spend($1, $2, null, true)", [alice, key(loopKey)]);
    }
    const blocked = await db.query<{ out: { allowed: boolean } }>(
      "select public.reserve_spend($1, $2, 0.10, 0.25) as out",
      [alice, key('c')],
    );
    expect(blocked.rows[0].out.allowed).toBe(false);
  });

  it("une libération sans comptage ne facture rien", async () => {
    const db = shared.db;
    const { owner: alice, key } = await shared.newOwner();
    await db.query("select public.reserve_spend($1, $2, 0.10, null)", [alice, key('r1')]);
    const out = await db.query<{ out: Record<string, string | number> }>(
      "select public.settle_spend($1, $2, null, false) as out",
      [alice, key('r1')],
    );
    expect(Number(out.rows[0].out.generations)).toBe(0);
    expect(Number(out.rows[0].out.in_flight_usd)).toBe(0);
  });
});

describe("Idempotence entre instances", () => {
  const shared = sharedDatabase();
  beforeAll(() => shared.start());

  it("la première demande obtient la main", async () => {
    const db = shared.db;
    const { owner: alice, key } = await shared.newOwner();
    const out = await db.query<{ out: { status: string } }>(
      "select public.claim_idempotency($2, $1) as out",
      [alice, key("k1")],
    );
    expect(out.rows[0].out.status).toBe("claimed");
  });

  it("une seconde demande identique est refusée pendant le traitement", async () => {
    const db = shared.db;
    const { owner: alice, key } = await shared.newOwner();
    await db.query("select public.claim_idempotency($2, $1)", [alice, key("k1")]);
    const out = await db.query<{ out: { status: string } }>(
      "select public.claim_idempotency($2, $1) as out",
      [alice, key("k1")],
    );
    expect(out.rows[0].out.status).toBe("in-progress");
  });

  it("DEUX appels simultanés : un seul obtient la main", async () => {
    // Le défaut corrigé : l'ancienne version déduisait « qui a inséré » d'une
    // fenêtre d'une seconde, si bien que deux instances se croyaient toutes
    // deux légitimes et lançaient deux générations facturées.
    const db = shared.db;
    const { owner: alice, key } = await shared.newOwner();
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        db.query<{ out: { status: string } }>(
          "select public.claim_idempotency($2, $1) as out",
          [alice, key("course")],
        ),
      ),
    );
    const claimed = results.filter((r) => r.rows[0].out.status === "claimed");
    expect(claimed).toHaveLength(1);
  });

  it("une demande terminée rend son résultat au lieu d'être refaite", async () => {
    const db = shared.db;
    const { owner: alice, key } = await shared.newOwner();
    await db.query("select public.claim_idempotency($2, $1)", [alice, key("k1")]);
    await db.query("select public.complete_idempotency($3, $1, $2::jsonb)", [
      alice,
      JSON.stringify({ image: "deja-payee" }),
      key("k1"),
    ]);

    const out = await db.query<{ out: { status: string; result: { image: string } } }>(
      "select public.claim_idempotency($2, $1) as out",
      [alice, key("k1")],
    );
    expect(out.rows[0].out.status).toBe("completed");
    expect(out.rows[0].out.result.image).toBe("deja-payee");
  });

  it("un AUTRE compte ne récupère jamais le résultat", async () => {
    const db = shared.db;
    const { owner: alice, key } = await shared.newOwner();
    const { owner: bob } = await shared.newOwner();
    await db.query("select public.claim_idempotency($2, $1)", [alice, key("k1")]);
    await db.query("select public.complete_idempotency($3, $1, $2::jsonb)", [
      alice,
      JSON.stringify({ image: "secret-alice" }),
      key("k1"),
    ]);

    const out = await db.query<{ out: { status: string } }>(
      "select public.claim_idempotency($2, $1) as out",
      [bob, key("k1")],
    );
    expect(out.rows[0].out.status).toBe("forbidden");
  });

  it("abandonner libère la clé pour un nouvel essai", async () => {
    const db = shared.db;
    const { owner: alice, key } = await shared.newOwner();
    await db.query("select public.claim_idempotency($2, $1)", [alice, key("k1")]);
    await db.query("select public.abandon_idempotency($2, $1)", [alice, key('k1')]);

    const out = await db.query<{ out: { status: string } }>(
      "select public.claim_idempotency($2, $1) as out",
      [alice, key("k1")],
    );
    expect(out.rows[0].out.status).toBe("claimed");
  });

  it("un autre compte ne peut pas abandonner la clé d'autrui", async () => {
    const db = shared.db;
    const { owner: alice, key } = await shared.newOwner();
    const { owner: bob } = await shared.newOwner();
    await db.query("select public.claim_idempotency($2, $1)", [alice, key("k1")]);
    await db.query("select public.abandon_idempotency($2, $1)", [bob, key('k1')]);

    // La clé d'Alice est intacte : Bob n'a rien pu effacer.
    const out = await db.query<{ out: { status: string } }>(
      "select public.claim_idempotency($2, $1) as out",
      [alice, key("k1")],
    );
    expect(out.rows[0].out.status).toBe("in-progress");
  });
});
