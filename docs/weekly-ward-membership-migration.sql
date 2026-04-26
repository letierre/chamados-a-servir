-- ═══════════════════════════════════════════════════════════
-- MIGRAÇÃO — histórico semanal do total de membros por ala
-- Antes: cada lançamento sobrescrevia wards.membership_count.
-- Agora: cada lançamento vira uma linha em weekly_ward_membership,
-- e um trigger mantém wards.membership_count = última semana lançada.
-- Rode no SQL Editor do Supabase.
-- ═══════════════════════════════════════════════════════════

-- 1) Tabela de histórico
create table if not exists public.weekly_ward_membership (
  id uuid primary key default gen_random_uuid(),
  ward_id uuid not null references public.wards(id) on delete cascade,
  week_start date not null,
  membership_count int not null check (membership_count >= 0 and membership_count <= 10000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (ward_id, week_start)
);

-- 2) Índice para ranquear "última semana" rapidamente
create index if not exists idx_weekly_ward_membership_ward_week
  on public.weekly_ward_membership(ward_id, week_start desc);

-- 3) RLS — acesso para usuários autenticados
alter table public.weekly_ward_membership enable row level security;

drop policy if exists "wwm_select_authenticated"  on public.weekly_ward_membership;
drop policy if exists "wwm_insert_authenticated"  on public.weekly_ward_membership;
drop policy if exists "wwm_update_authenticated"  on public.weekly_ward_membership;
drop policy if exists "wwm_delete_authenticated"  on public.weekly_ward_membership;

create policy "wwm_select_authenticated"
  on public.weekly_ward_membership for select
  using (auth.uid() is not null);

create policy "wwm_insert_authenticated"
  on public.weekly_ward_membership for insert
  with check (auth.uid() is not null);

create policy "wwm_update_authenticated"
  on public.weekly_ward_membership for update
  using (auth.uid() is not null);

create policy "wwm_delete_authenticated"
  on public.weekly_ward_membership for delete
  using (auth.uid() is not null);

-- 4) Trigger: depois de qualquer insert/update na tabela de histórico,
--    sincroniza wards.membership_count com o valor da semana mais recente
--    daquela ala. Assim, dashboard e qualquer leitura existente continuam
--    funcionando sem precisar mudar.
create or replace function public.sync_ward_membership_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.wards w
  set membership_count = sub.membership_count
  from (
    select membership_count
    from public.weekly_ward_membership
    where ward_id = NEW.ward_id
    order by week_start desc
    limit 1
  ) sub
  where w.id = NEW.ward_id;
  return NEW;
end;
$$;

drop trigger if exists trg_sync_ward_membership_count on public.weekly_ward_membership;
create trigger trg_sync_ward_membership_count
  after insert or update on public.weekly_ward_membership
  for each row
  execute function public.sync_ward_membership_count();

-- 5) Backfill: cria uma linha inicial de histórico para cada ala que já
--    tem membership_count cadastrado, datada do domingo passado.
--    Assim o "Último lançado" do form aparece corretamente desde o início.
insert into public.weekly_ward_membership (ward_id, week_start, membership_count)
select
  w.id,
  (current_date - (extract(dow from current_date))::int)::date as last_sunday,
  w.membership_count
from public.wards w
where w.membership_count is not null and w.membership_count > 0
on conflict (ward_id, week_start) do nothing;

-- 6) RPC para buscar o último lançamento de uma ala (mais simples no front)
drop function if exists public.get_latest_ward_membership(uuid);
create or replace function public.get_latest_ward_membership(p_ward_id uuid)
returns table (week_start date, membership_count int)
language sql
security definer
set search_path = public
as $$
  select week_start, membership_count
  from public.weekly_ward_membership
  where ward_id = p_ward_id
  order by week_start desc
  limit 1;
$$;

grant execute on function public.get_latest_ward_membership(uuid) to authenticated;
