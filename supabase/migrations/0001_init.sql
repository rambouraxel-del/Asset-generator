-- ============================================================================
-- Asset Generator — migration 0001 : socle multi-appareils
-- ============================================================================
-- Versionnée et NON DESTRUCTIVE : cette migration ne fait que créer. Elle ne
-- supprime aucune table, aucune colonne et aucune donnée. Elle est rejouable
-- (« if not exists » partout), ce qui la rend sûre à appliquer deux fois.
--
-- MODÈLE DE SÉCURITÉ
-- ------------------
-- Chaque ligne porte un `owner_id` égal à `auth.uid()`. Les politiques RLS
-- ci-dessous n'autorisent QUE le propriétaire. Aucune politique ne permet de
-- lire les données d'autrui, même en connaissant un identifiant.
--
-- Les images vivent dans un bucket PRIVÉ : elles ne sont jamais servies par
-- une URL publique, seulement par une URL signée à durée limitée générée côté
-- serveur.
--
-- S'INSCRIRE N'AUTORISE PAS À DÉPENSER : la table `allowed_generators` est la
-- seule porte vers le crédit API, et elle n'est pas alimentable par un compte
-- ordinaire.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Projets
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  description   text not null default '',
  charter       jsonb not null default '{}'::jsonb,
  palettes      jsonb not null default '[]'::jsonb,
  family_rules  jsonb not null default '[]'::jsonb,
  default_width  integer not null default 48,
  default_height integer not null default 48,
  archived      boolean not null default false,
  -- Concurrence optimiste : toute écriture doit fournir la version attendue.
  version       integer not null default 1,
  budget_limit_usd numeric(12, 4),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists projects_owner_idx on public.projects (owner_id, archived);

-- ---------------------------------------------------------------------------
-- Références validées
-- ---------------------------------------------------------------------------
create table if not exists public.project_references (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  storage_path text not null,
  mime_type   text not null,
  width       integer not null,
  height      integer not null,
  size_bytes  integer not null,
  -- Jamais mis à true automatiquement : c'est un acte explicite.
  validated   boolean not null default false,
  pinned      boolean not null default false,
  families    text[] not null default '{}',
  version     integer not null default 1,
  created_at  timestamptz not null default now()
);

create index if not exists project_references_project_idx
  on public.project_references (project_id, validated);

-- ---------------------------------------------------------------------------
-- Assets et leurs variantes
-- ---------------------------------------------------------------------------
create table if not exists public.assets (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  family      text,
  request     text not null default '',
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists assets_project_idx on public.assets (project_id, created_at desc);

-- Une ligne par variante : original, processed, manual, master.
-- La contrainte d'unicité empêche deux variantes du même type sur un asset,
-- donc empêche structurellement d'empiler deux « retouche manuelle ».
create table if not exists public.asset_variants (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid not null references public.assets (id) on delete cascade,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('original', 'processed', 'manual', 'master')),
  storage_path text not null,
  mime_type   text not null,
  width       integer not null,
  height      integer not null,
  -- true dès que la variante vient d'un geste humain : protège de l'écrasement.
  user_authored boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (asset_id, kind)
);

-- ---------------------------------------------------------------------------
-- Historique des générations — figé, jamais réécrit
-- ---------------------------------------------------------------------------
create table if not exists public.generations (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  owner_id     uuid not null references auth.users (id) on delete cascade,
  mode         text not null check (mode in ('single', 'sheet')),
  request      text not null,
  model        text not null,
  quality      text not null,
  generation_size text not null,
  -- Copie gelée des règles, références et paramètres employés.
  snapshot     jsonb not null,
  cost_status  text not null check (cost_status in ('measured', 'estimated', 'unknown')),
  cost_usd     numeric(12, 6),
  pricing_version text,
  usage        jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists generations_project_idx
  on public.generations (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Autorisation de dépense — s'inscrire ne suffit pas
-- ---------------------------------------------------------------------------
create table if not exists public.allowed_generators (
  identity   text primary key,
  note       text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Registre des dépenses — rend le plafond réellement contraignant
-- ---------------------------------------------------------------------------
create table if not exists public.spend_ledger (
  owner_id           uuid primary key references auth.users (id) on delete cascade,
  recorded_usd       numeric(12, 6) not null default 0,
  unknown_cost_count integer not null default 0,
  generations        integer not null default 0,
  updated_at         timestamptz not null default now()
);

-- Réservations des appels en vol : c'est ce qui empêche deux requêtes
-- simultanées de franchir ensemble un plafond que chacune croyait libre.
create table if not exists public.spend_reservations (
  request_id text primary key,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  amount_usd numeric(12, 6) not null,
  created_at timestamptz not null default now()
);

create index if not exists spend_reservations_owner_idx
  on public.spend_reservations (owner_id);

-- Clés d'idempotence : contrainte d'unicité = protection anti double-soumission
-- valable entre onglets ET entre instances serveur.
create table if not exists public.idempotency_keys (
  key        text primary key,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  state      text not null check (state in ('in-progress', 'completed')),
  result     jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Privilèges de table
-- ============================================================================
-- RLS filtre les LIGNES ; les privilèges autorisent l'accès à la TABLE. Il faut
-- les deux : sans GRANT, un compte connecté reçoit « permission denied » avant
-- même que RLS n'entre en jeu.
--
-- Supabase pose des privilèges par défaut sur le schéma `public`, mais s'y fier
-- rend la migration dépendante d'une configuration implicite. On les déclare
-- donc explicitement : la migration devient autonome et vérifiable.
--
-- `anon` (visiteur non connecté) ne reçoit RIEN : aucune donnée n'est
-- accessible sans compte.
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
  public.projects,
  public.project_references,
  public.assets,
  public.asset_variants,
  public.generations
to authenticated;

-- Compteurs : lecture seule pour le compte. Les écritures passent par les
-- fonctions système, appelées avec la clé de service.
grant select on public.spend_ledger, public.spend_reservations to authenticated;

-- Liste d'autorisation : lecture seule, jamais d'écriture par l'API publique.
grant select on public.allowed_generators to authenticated;

-- Clés d'idempotence : lecture seule ; seules les fonctions système écrivent.
grant select on public.idempotency_keys to authenticated;

-- ============================================================================
-- Row Level Security — tout est refusé par défaut, seul le propriétaire passe
-- ============================================================================
alter table public.projects            enable row level security;
alter table public.project_references  enable row level security;
alter table public.assets              enable row level security;
alter table public.asset_variants      enable row level security;
alter table public.generations         enable row level security;
alter table public.spend_ledger        enable row level security;
alter table public.spend_reservations  enable row level security;
alter table public.idempotency_keys    enable row level security;
alter table public.allowed_generators  enable row level security;

/*
 * PostgreSQL n'accepte PAS la clause « IF NOT EXISTS » sur une politique :
 * une telle instruction provoque une erreur de syntaxe et interrompt toute la
 * migration, laissant RLS activé SANS aucune politique.
 *
 * Pour rester rejouable, chaque politique est donc supprimée si elle existe,
 * puis recréée. C'est la seule forme idempotente valide, et elle ne détruit
 * aucune donnée : une politique est une règle d'accès, pas un contenu.
 */
do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'project_references', 'assets', 'asset_variants',
    'generations', 'spend_reservations', 'idempotency_keys'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_only', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
      t || '_owner_only', t
    );
  end loop;
end $$;

drop policy if exists spend_ledger_owner_only on public.spend_ledger;
create policy spend_ledger_owner_only on public.spend_ledger
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- La liste d'autorisation est LISIBLE par les comptes connectés (pour savoir
-- si l'on est autorisé) mais MODIFIABLE par personne via l'API publique :
-- aucune policy d'écriture n'est créée. Seul le propriétaire du projet
-- Supabase peut l'alimenter, depuis le tableau de bord ou la clé de service.
drop policy if exists allowed_generators_read on public.allowed_generators;
create policy allowed_generators_read on public.allowed_generators
  for select to authenticated using (true);

-- ============================================================================
-- Stockage privé des images
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('asset-images', 'asset-images', false)
on conflict (id) do nothing;

-- Chaque fichier vit sous « <owner_id>/... ». La politique compare le premier
-- segment du chemin à l'identifiant du compte : un compte ne peut donc ni lire
-- ni écrire hors de son propre dossier.
drop policy if exists asset_images_owner_read on storage.objects;
create policy asset_images_owner_read on storage.objects
  for select to authenticated
  using (bucket_id = 'asset-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists asset_images_owner_write on storage.objects;
create policy asset_images_owner_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'asset-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists asset_images_owner_update on storage.objects;
create policy asset_images_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'asset-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists asset_images_owner_delete on storage.objects;
create policy asset_images_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'asset-images' and (storage.foldername(name))[1] = auth.uid()::text);
