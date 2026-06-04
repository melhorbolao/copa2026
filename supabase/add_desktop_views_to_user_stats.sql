-- Adiciona desktop_views e mobile_views à view de engajamento por usuário
-- CREATE OR REPLACE não permite inserir colunas no meio — precisa recriar
DROP VIEW IF EXISTS public.vw_analytics_user_stats;
CREATE VIEW public.vw_analytics_user_stats AS
SELECT
  user_id,
  COUNT(*)::int                                                     AS total_views,
  COUNT(*) FILTER (WHERE device_type = 'desktop')::int              AS desktop_views,
  COUNT(*) FILTER (WHERE device_type = 'mobile')::int               AS mobile_views,
  MAX(created_at)                                                   AS last_action,
  MODE() WITHIN GROUP (ORDER BY path)                               AS favorite_page
FROM public.page_views
WHERE user_id IS NOT NULL
GROUP BY user_id;

GRANT SELECT ON public.vw_analytics_user_stats TO service_role;
