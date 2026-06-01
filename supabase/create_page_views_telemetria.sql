-- ═══════════════════════════════════════════════════════════════════════════
-- TELEMETRIA NATIVA: TABELA page_views + VIEW DE AGREGAÇÃO
-- Aplicar no Supabase SQL Editor (uma vez por ambiente)
-- ═══════════════════════════════════════════════════════════════════════════

-- Tabela principal de rastreamento de rotas
CREATE TABLE IF NOT EXISTS page_views (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        REFERENCES users(id) ON DELETE SET NULL,
  path        text        NOT NULL,
  device_type text        NOT NULL CHECK (device_type IN ('mobile', 'desktop')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Índices obrigatórios — tabela cresce a cada clique de cada usuário
CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_views_path       ON page_views (path);
CREATE INDEX IF NOT EXISTS idx_page_views_user_id    ON page_views (user_id);

ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;

-- Usuários autenticados inserem apenas seus próprios registros
CREATE POLICY "authenticated insert own page_view"
  ON page_views FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- service_role tem acesso total (leitura admin + escrita futura via backend)
CREATE POLICY "service role full access page_views"
  ON page_views FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── VIEW: contagens agregadas por página ──────────────────────────────────
-- Evita GROUP BY pesado no frontend; usada exclusivamente pelo painel admin.
CREATE OR REPLACE VIEW public.vw_analytics_page_counters AS
SELECT
  path,
  COUNT(*)                                              AS total_views,
  COUNT(DISTINCT user_id)                               AS unique_users,
  COUNT(*) FILTER (WHERE device_type = 'mobile')        AS mobile_views,
  COUNT(*) FILTER (WHERE device_type = 'desktop')       AS desktop_views,
  ROUND(
    COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0),
    1
  )                                                     AS pct_traffic
FROM page_views
GROUP BY path
ORDER BY total_views DESC;

GRANT SELECT ON public.vw_analytics_page_counters TO service_role;
