-- ============================================================================
-- Asset Generator — migration 0002 : opérations atomiques de budget
-- ============================================================================
-- Versionnée et NON DESTRUCTIVE : elle ne crée que des fonctions et des
-- colonnes, et se rejoue sans dégât.
--
-- POURQUOI DES FONCTIONS PLUTÔT QUE DES REQUÊTES CÔTÉ APPLICATION
-- ---------------------------------------------------------------
-- « Lire le compteur, décider, écrire » depuis l'application laisse une fenêtre
-- entre la lecture et l'écriture. Deux instances serverless qui traitent deux
-- requêtes au même instant y liraient toutes deux « il reste de la place » et
-- passeraient ensemble.
--
-- Les fonctions ci-dessous font la lecture, la décision et l'écriture DANS UNE
-- SEULE transaction, avec un verrou de ligne. C'est ce qui rend la réservation
-- correcte entre plusieurs instances, et pas seulement dans un processus.
-- ============================================================================

-- Colonnes ajoutées pour distinguer coût mesuré et coût estimé.
alter table public.spend_ledger
  add column if not exists measured_usd numeric(12, 6) not null default 0;
alter table public.spend_ledger
  add column if not exists estimated_usd numeric(12, 6) not null default 0;

-- ---------------------------------------------------------------------------
-- Réservation atomique
-- ---------------------------------------------------------------------------
-- Renvoie true si la réservation est accordée, false si le plafond l'interdit.
-- Le plafond est passé en paramètre : il vient de la configuration serveur,
-- jamais du client.
create or replace function public.reserve_spend(
  p_owner    uuid,
  p_request  text,
  p_amount   numeric,
  p_limit    numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recorded  numeric;
  v_inflight  numeric;
  v_unknown   integer;
  v_gens      integer;
  v_measured  numeric;
  v_estimated numeric;
begin
  -- Crée la ligne si besoin, puis la VERROUILLE : toute autre transaction
  -- portant sur le même compte attend ici.
  insert into public.spend_ledger (owner_id) values (p_owner)
    on conflict (owner_id) do nothing;

  select measured_usd, estimated_usd, unknown_cost_count, generations
    into v_measured, v_estimated, v_unknown, v_gens
    from public.spend_ledger
   where owner_id = p_owner
     for update;

  v_recorded := v_measured + v_estimated;

  select coalesce(sum(amount_usd), 0) into v_inflight
    from public.spend_reservations
   where owner_id = p_owner;

  -- Une réservation déjà posée sous ce request_id est rendue telle quelle :
  -- un renvoi ne double pas la réservation.
  if exists (select 1 from public.spend_reservations where request_id = p_request) then
    return jsonb_build_object(
      'allowed', true, 'duplicate', true,
      'recorded_usd', v_recorded, 'in_flight_usd', v_inflight,
      'measured_usd', v_measured, 'estimated_usd', v_estimated,
      'unknown_cost_count', v_unknown, 'generations', v_gens
    );
  end if;

  if p_limit is not null and (v_recorded + v_inflight + p_amount) > p_limit then
    return jsonb_build_object(
      'allowed', false, 'duplicate', false,
      'recorded_usd', v_recorded, 'in_flight_usd', v_inflight,
      'measured_usd', v_measured, 'estimated_usd', v_estimated,
      'unknown_cost_count', v_unknown, 'generations', v_gens,
      'remaining_usd', greatest(0, p_limit - v_recorded - v_inflight)
    );
  end if;

  insert into public.spend_reservations (request_id, owner_id, amount_usd)
  values (p_request, p_owner, p_amount);

  return jsonb_build_object(
    'allowed', true, 'duplicate', false,
    'recorded_usd', v_recorded, 'in_flight_usd', v_inflight + p_amount,
    'measured_usd', v_measured, 'estimated_usd', v_estimated,
    'unknown_cost_count', v_unknown, 'generations', v_gens
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Clôture atomique
-- ---------------------------------------------------------------------------
-- p_cost null = coût inconnu. Dans ce cas l'estimation réservée est retenue :
-- l'appel a bien eu lieu et a bien coûté quelque chose. La compter à zéro
-- rendrait le plafond inopérant face à une API qui ne remonte aucun usage.
create or replace function public.settle_spend(
  p_owner   uuid,
  p_request text,
  p_cost    numeric,
  p_counted boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reserved numeric;
begin
  select amount_usd into v_reserved
    from public.spend_reservations
   where request_id = p_request and owner_id = p_owner;

  delete from public.spend_reservations
   where request_id = p_request and owner_id = p_owner;

  if p_counted then
    insert into public.spend_ledger (owner_id) values (p_owner)
      on conflict (owner_id) do nothing;

    if p_cost is null then
      update public.spend_ledger
         set estimated_usd      = estimated_usd + coalesce(v_reserved, 0),
             unknown_cost_count = unknown_cost_count + 1,
             generations        = generations + 1,
             updated_at         = now()
       where owner_id = p_owner;
    else
      update public.spend_ledger
         set measured_usd = measured_usd + p_cost,
             generations  = generations + 1,
             updated_at   = now()
       where owner_id = p_owner;
    end if;
  end if;

  return public.read_spend(p_owner);
end;
$$;

/*
 * Lecture des compteurs de dépense.
 *
 * SÉCURITÉ : cette fonction contourne RLS (security definer). Si elle acceptait
 * un compte arbitraire en paramètre tout en étant appelable par n'importe quel
 * compte connecté, chacun pourrait lire les dépenses des autres en devinant un
 * identifiant. Elle REFUSE donc tout compte autre que l'appelant, sauf lorsque
 * l'appel vient du serveur (clé de service, où auth.uid() est nul).
 */
create or replace function public.read_spend(p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_measured  numeric := 0;
  v_estimated numeric := 0;
  v_unknown   integer := 0;
  v_gens      integer := 0;
  v_inflight  numeric := 0;
begin
  -- auth.uid() est nul pour un appel serveur (clé de service) : autorisé.
  -- Un compte connecté ne peut lire QUE ses propres compteurs.
  if auth.uid() is not null and auth.uid() <> p_owner then
    raise exception 'read_spend: acces refuse a un autre compte'
      using errcode = '42501';
  end if;

  select measured_usd, estimated_usd, unknown_cost_count, generations
    into v_measured, v_estimated, v_unknown, v_gens
    from public.spend_ledger where owner_id = p_owner;

  select coalesce(sum(amount_usd), 0) into v_inflight
    from public.spend_reservations where owner_id = p_owner;

  return jsonb_build_object(
    'recorded_usd', coalesce(v_measured, 0) + coalesce(v_estimated, 0),
    'measured_usd', coalesce(v_measured, 0),
    'estimated_usd', coalesce(v_estimated, 0),
    'in_flight_usd', v_inflight,
    'unknown_cost_count', coalesce(v_unknown, 0),
    'generations', coalesce(v_gens, 0)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Idempotence atomique, valable entre instances
-- ---------------------------------------------------------------------------
-- La contrainte de clé primaire fait tout le travail : la première insertion
-- gagne, les suivantes voient l'état existant. Deux instances serverless
-- simultanées ne peuvent donc pas lancer deux fois la même génération.
create or replace function public.claim_idempotency(
  p_key   text,
  p_owner uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state    text;
  v_result   jsonb;
  v_owner    uuid;
  v_inserted text;
begin
  /*
   * L'insertion elle-même décide qui travaille : « RETURNING » ne renvoie une
   * ligne QUE si c'est nous qui l'avons créée. Déduire cela d'une fenêtre
   * temporelle (« créée il y a moins d'une seconde ») serait faux : deux
   * instances appelant dans la même seconde se croiraient toutes deux
   * légitimes et lanceraient deux générations facturées.
   */
  insert into public.idempotency_keys (key, owner_id, state)
  values (p_key, p_owner, 'in-progress')
  on conflict (key) do nothing
  returning key into v_inserted;

  if v_inserted is not null then
    return jsonb_build_object('status', 'claimed');
  end if;

  select state, result, owner_id into v_state, v_result, v_owner
    from public.idempotency_keys where key = p_key;

  -- Une clé appartenant à un autre compte n'est jamais rejouée : ce serait
  -- livrer à un compte un résultat payé par un autre.
  if v_owner is distinct from p_owner then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if v_state = 'completed' then
    return jsonb_build_object('status', 'completed', 'result', v_result);
  end if;

  -- La ligne existait déjà et n'est pas terminée : un autre appel la traite.
  return jsonb_build_object('status', 'in-progress');
end;
$$;

create or replace function public.complete_idempotency(
  p_key    text,
  p_owner  uuid,
  p_result jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  update public.idempotency_keys
     set state = 'completed', result = p_result
   where key = p_key and owner_id = p_owner;
$$;

create or replace function public.abandon_idempotency(
  p_key   text,
  p_owner uuid
) returns void
language sql
security definer
set search_path = public
as $$
  delete from public.idempotency_keys where key = p_key and owner_id = p_owner;
$$;

-- Les fonctions system ne sont appelables qu'avec la clé de service : aucun
-- droit n'est accordé aux rôles anon/authenticated.
revoke all on function public.reserve_spend(uuid, text, numeric, numeric) from public, anon, authenticated;
revoke all on function public.settle_spend(uuid, text, numeric, boolean) from public, anon, authenticated;
revoke all on function public.claim_idempotency(text, uuid) from public, anon, authenticated;
revoke all on function public.complete_idempotency(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.abandon_idempotency(text, uuid) from public, anon, authenticated;
-- `read_spend` reste lisible par le compte lui-même pour afficher son budget.
grant execute on function public.read_spend(uuid) to authenticated;
