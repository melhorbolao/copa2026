-- View de acessos agregados por dia (horário de Brasília)
CREATE OR REPLACE VIEW public.vw_analytics_daily AS
SELECT
  (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
  COUNT(*)::int                  AS total_views,
  COUNT(DISTINCT user_id)::int   AS unique_users
FROM public.page_views
GROUP BY 1
ORDER BY 1;

GRANT SELECT ON public.vw_analytics_daily TO service_role;
