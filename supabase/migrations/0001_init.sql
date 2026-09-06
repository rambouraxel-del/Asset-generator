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

do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'project_references', 'assets', 'asset_variants',
    'generations', 'spend_reservations', 'idempotency_keys'
  ]
  loop
    execute format(
      'create policy if not exists %I on public.%I for all to authenticated
         using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
      t || '_owner_only', t
    );
  end loop;
end $$;

create policy if not exists spend_ledger_owner_only on public.spend_ledger
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- La liste d'autorisation est LISIBLE par les comptes connectés (pour savoir
-- si l'on est autorisé) mais MODIFIABLE par personne via l'API publique :
-- aucune policy d'écriture n'est créée. Seul le propriétaire du projet
-- Supabase peut l'alimenter, depuis le tableau de bord ou la clé de service.
create policy if not exists allowed_generators_read on public.allowed_generators
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
create policy if not exists asset_images_owner_read on storage.objects
  for select to authenticated
  using (bucket_id = 'asset-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy if not exists asset_images_owner_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'asset-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy if not exists asset_images_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'asset-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy if not exists asset_images_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'asset-images' and (storage.foldername(name))[1] = auth.uid()::text);
