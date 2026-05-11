-- ═══════════════════════════════════════════════════════════
-- MIGRAÇÃO — histórico de documentos gerados por usuário
-- Rode no SQL Editor do Supabase.
-- ═══════════════════════════════════════════════════════════

-- 1) Tabela de histórico
create table if not exists public.generated_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  report_type text not null,
  ward_name text,
  created_at timestamptz not null default now()
);

-- 2) Índice para buscar por usuário (mais recentes primeiro)
create index if not exists idx_generated_documents_user
  on public.generated_documents(user_id, created_at desc);

-- 3) RLS — cada usuário vê apenas seus próprios documentos
alter table public.generated_documents enable row level security;

drop policy if exists "gd_select_own" on public.generated_documents;
drop policy if exists "gd_insert_own" on public.generated_documents;
drop policy if exists "gd_delete_own" on public.generated_documents;

create policy "gd_select_own"
  on public.generated_documents for select
  using (auth.uid() = user_id);

create policy "gd_insert_own"
  on public.generated_documents for insert
  with check (auth.uid() = user_id);

create policy "gd_delete_own"
  on public.generated_documents for delete
  using (auth.uid() = user_id);
