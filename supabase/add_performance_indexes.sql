-- ════════════════════════════════════════════════════════════════════════
-- OTIMIZAÇÃO DE PERFORMANCE — redução de Disk IO (Supabase Budget)
-- Execute no Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. betting_deadline: usado em subqueries RLS a cada INSERT/UPDATE de bets
CREATE INDEX IF NOT EXISTS idx_matches_betting_deadline
  ON public.matches (betting_deadline);

-- ── 2. Índice composto page_views (user + data): melhora GROUP BY user em views
CREATE INDEX IF NOT EXISTS idx_page_views_user_created
  ON public.page_views (user_id, created_at DESC);

-- ── 3. Índices standalone em participant_id
--    As constraints UNIQUE já cobrem (participant_id, match_id) como prefixo,
--    mas índices simples eliminam overhead quando não há filtro em match_id —
--    ex.: SUM(points) na função refresh_participant_total.
CREATE INDEX IF NOT EXISTS idx_bets_participant_id
  ON public.bets (participant_id);

CREATE INDEX IF NOT EXISTS idx_group_bets_participant_id
  ON public.group_bets (participant_id);

CREATE INDEX IF NOT EXISTS idx_third_place_bets_participant_id
  ON public.third_place_bets (participant_id);

-- ── 4. Views agregadas para o painel de Telemetria ───────────────────────────
-- Substituem o download de 36.000 linhas brutas por ~99 linhas pré-calculadas.

-- 4a. Engajamento por usuário (~60 linhas)
CREATE OR REPLACE VIEW public.vw_analytics_user_stats AS
SELECT
  user_id,
  COUNT(*)::int                              AS total_views,
  MAX(created_at)                            AS last_action,
  MODE() WITHIN GROUP (ORDER BY path)        AS favorite_page
FROM public.page_views
WHERE user_id IS NOT NULL
GROUP BY user_id;

GRANT SELECT ON public.vw_analytics_user_stats TO service_role;

-- 4b. Distribuição horária BRT (24 linhas)
CREATE OR REPLACE VIEW public.vw_analytics_hourly AS
SELECT
  ((EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo')::int + 24) % 24) AS hour_brt,
  COUNT(*)::int AS cnt
FROM public.page_views
GROUP BY 1
ORDER BY 1;

GRANT SELECT ON public.vw_analytics_hourly TO service_role;
