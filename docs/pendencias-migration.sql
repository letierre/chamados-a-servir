-- ═══════════════════════════════════════════════════════════════════
-- PENDÊNCIAS — funções para identificar lançamentos em atraso
-- Execute no SQL Editor do Supabase.
-- ═══════════════════════════════════════════════════════════════════

-- ─── get_all_pending() ──────────────────────────────────────────────
-- Retorna todas as combinações ala × indicador × semana que estão
-- pendentes: sem lançamento, sem revisão e sem ser semana de
-- conferência para aquele indicador.
-- Varre do primeiro registro existente até o último domingo.
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_all_pending();

CREATE OR REPLACE FUNCTION public.get_all_pending()
RETURNS TABLE (
  ward_id        uuid,
  ward_name      text,
  indicator_id   uuid,
  indicator_name text,
  indicator_slug text,
  order_index    int,
  week_start     date,
  weeks_overdue  int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  last_sunday AS (
    SELECT (CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::int)::date AS d
  ),
  first_entry AS (
    SELECT MIN(week_start) AS first_week FROM public.weekly_indicator_data
  ),
  sundays AS (
    SELECT gs::date AS week_start
    FROM first_entry
    CROSS JOIN generate_series(
      first_week,
      (SELECT d FROM last_sunday),
      '7 days'::interval
    ) gs
    WHERE first_week IS NOT NULL
  ),
  full_matrix AS (
    SELECT
      w.id           AS ward_id,
      w.name         AS ward_name,
      i.id           AS indicator_id,
      i.display_name AS indicator_name,
      i.slug         AS indicator_slug,
      i.order_index,
      s.week_start
    FROM public.wards w
    CROSS JOIN public.indicators i
    CROSS JOIN sundays s
    WHERE w.active = true
      AND i.active = true
  )
  SELECT
    fm.ward_id,
    fm.ward_name,
    fm.indicator_id,
    fm.indicator_name,
    fm.indicator_slug,
    fm.order_index,
    fm.week_start,
    ((SELECT d FROM last_sunday) - fm.week_start)::int / 7 AS weeks_overdue
  FROM full_matrix fm
  LEFT JOIN public.weekly_indicator_data wid
    ON  wid.ward_id      = fm.ward_id
    AND wid.indicator_id = fm.indicator_id
    AND wid.week_start   = fm.week_start
  LEFT JOIN public.weekly_reviews wr
    ON  wr.ward_id      = fm.ward_id
    AND wr.indicator_id = fm.indicator_id
    AND wr.week_start   = fm.week_start
  LEFT JOIN public.skip_weeks sw
    ON  sw.week_date    = fm.week_start
    AND sw.affects_slug = fm.indicator_slug
  WHERE wid.ward_id IS NULL   -- não lançado
    AND wr.ward_id   IS NULL  -- não revisado
    AND sw.id        IS NULL  -- não pulado por conferência
  ORDER BY fm.week_start DESC, fm.order_index, fm.ward_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_pending() TO authenticated;


-- ─── get_pending_count() ────────────────────────────────────────────
-- Retorna apenas o total de pendências (inteiro).
-- Usado pelo badge do menu lateral para evitar carregar toda a tabela.
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_pending_count();

CREATE OR REPLACE FUNCTION public.get_pending_count()
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  last_sunday AS (
    SELECT (CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::int)::date AS d
  ),
  first_entry AS (
    SELECT MIN(week_start) AS first_week FROM public.weekly_indicator_data
  ),
  sundays AS (
    SELECT gs::date AS week_start
    FROM first_entry
    CROSS JOIN generate_series(
      first_week,
      (SELECT d FROM last_sunday),
      '7 days'::interval
    ) gs
    WHERE first_week IS NOT NULL
  ),
  full_matrix AS (
    SELECT
      w.id  AS ward_id,
      i.id  AS indicator_id,
      i.slug AS indicator_slug,
      s.week_start
    FROM public.wards w
    CROSS JOIN public.indicators i
    CROSS JOIN sundays s
    WHERE w.active = true
      AND i.active = true
  )
  SELECT COUNT(*)::int
  FROM full_matrix fm
  LEFT JOIN public.weekly_indicator_data wid
    ON  wid.ward_id      = fm.ward_id
    AND wid.indicator_id = fm.indicator_id
    AND wid.week_start   = fm.week_start
  LEFT JOIN public.weekly_reviews wr
    ON  wr.ward_id      = fm.ward_id
    AND wr.indicator_id = fm.indicator_id
    AND wr.week_start   = fm.week_start
  LEFT JOIN public.skip_weeks sw
    ON  sw.week_date    = fm.week_start
    AND sw.affects_slug = fm.indicator_slug
  WHERE wid.ward_id IS NULL
    AND wr.ward_id   IS NULL
    AND sw.id        IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_count() TO authenticated;
