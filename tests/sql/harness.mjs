/**
 * Banc d'essai SQL — exécute réellement les migrations dans PostgreSQL (PGlite).
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE BANC PROUVE, ET CE QU'IL NE PROUVE PAS
 * ---------------------------------------------------------------------------
 * PROUVE : que les migrations s'exécutent sans erreur, qu'elles sont rejouables,
 * et que les fonctions de budget et d'idempotence se comportent correctement,
 * y compris sous appels concurrents.
 *
 * NE PROUVE PAS : le comportement des politiques RLS réelles, ni celui de
 * `auth.uid()`, ni le bucket de stockage. Ces éléments appartiennent à
 * Supabase, pas à PostgreSQL nu. Ils sont ici REMPLACÉS par des doublures
 * minimales pour que le reste puisse tourner — leur validation exige un vrai
 * projet Supabase.
 * ---------------------------------------------------------------------------
 */

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

/** Doublures des objets fournis par Supabase et absents d'un PostgreSQL nu. */
const SUPABASE_STUBS = `
-- Rôles créés par Supabase sur tout projet. Un PostgreSQL nu ne les a pas.
do $stub$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$stub$;

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- auth.uid() lit normalement une revendication du jeton. Ici, une variable de
-- session tient ce rôle : « aucune valeur » = appel serveur (clé de service).
create or replace function auth.uid() returns uuid
language plpgsql stable as $fn$
begin
  return nullif(current_setting('test.uid', true), '')::uuid;
exception when others then return null;
end;
$fn$;

create table if not exists storage.buckets (
  id text primary key, name text, public boolean default false
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid
);
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $fn$ select string_to_array(name, '/') $fn$;
`;

export async function freshDatabase() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  return db;
}

export function migration(name) {
  const sql = readFileSync(
    new URL(`../../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );
  /*
   * PGlite ne fournit pas l'extension pgcrypto ; Supabase, si. Elle n'est de
   * toute façon pas indispensable : `gen_random_uuid()` fait partie du cœur de
   * PostgreSQL depuis la version 13. On neutralise donc la ligne pour le banc
   * d'essai, sans toucher à la migration réellement livrée.
   */
  return sql.replace(/create extension if not exists "pgcrypto";/g, "");
}

/** Applique les deux migrations dans l'ordre. */
export async function applyMigrations(db) {
  await db.exec(migration("0001_init.sql"));
  await db.exec(migration("0002_spend_functions.sql"));
}

/** Crée un compte de test et renvoie son identifiant. */
export async function createUser(db, email) {
  const result = await db.query(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  return result.rows[0].id;
}

/** Exécute une requête « en tant que » un compte donné (ou le serveur). */
export async function asUser(db, uid, sql, params = []) {
  await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
  return db.query(sql, params);
}
