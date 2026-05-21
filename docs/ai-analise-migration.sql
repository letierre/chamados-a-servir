-- ═══════════════════════════════════════════════════════════════════
-- ANÁLISE IA — tabela de histórico de análises geradas
-- Execute no SQL Editor do Supabase.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ai_analyses (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at timestamptz NOT NULL DEFAULT now(),
  week_start   date        NOT NULL,  -- domingo analisado
  content      text        NOT NULL,  -- texto da análise em markdown
  trigger_type text        NOT NULL DEFAULT 'manual', -- 'manual' | 'cron'
  created_by   uuid        REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_analyses_generated_at
  ON public.ai_analyses(generated_at DESC);

ALTER TABLE public.ai_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_analyses_select" ON public.ai_analyses;
DROP POLICY IF EXISTS "ai_analyses_insert" ON public.ai_analyses;

-- Leitura: qualquer usuário autenticado
CREATE POLICY "ai_analyses_select"
  ON public.ai_analyses FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Inserção via UI (trigger manual): usuário autenticado
CREATE POLICY "ai_analyses_insert"
  ON public.ai_analyses FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Obs: inserções pelo cron usam service_role key, que bypassa RLS.
