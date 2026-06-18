-- ============================================================
-- Migration: match_90min_results
-- Tabela de placares aos 90 minutos (sem acréscimos/prorrogação/pênaltis)
-- RLS: leitura pública, escrita apenas para admin
-- ============================================================

CREATE TABLE IF NOT EXISTS public.match_90min_results (
  match_id         UUID        PRIMARY KEY
                               REFERENCES public.matches(id) ON DELETE CASCADE,
  score_home_90min SMALLINT    NOT NULL CHECK (score_home_90min >= 0),
  score_away_90min SMALLINT    NOT NULL CHECK (score_away_90min >= 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.match_90min_results IS
  'Placar rigidamente aos 90:00 do tempo regulamentar, sem acréscimos, prorrogação ou pênaltis.';

ALTER TABLE public.match_90min_results ENABLE ROW LEVEL SECURITY;

-- Leitura pública para todos (anon + authenticated)
DROP POLICY IF EXISTS "90min: leitura pública" ON public.match_90min_results;
CREATE POLICY "90min: leitura pública"
  ON public.match_90min_results FOR SELECT
  TO anon, authenticated
  USING (true);

-- Escrita restrita a usuários com is_admin = true
DROP POLICY IF EXISTS "90min: admin insere"   ON public.match_90min_results;
DROP POLICY IF EXISTS "90min: admin atualiza" ON public.match_90min_results;
DROP POLICY IF EXISTS "90min: admin deleta"   ON public.match_90min_results;

CREATE POLICY "90min: admin insere"
  ON public.match_90min_results FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "90min: admin atualiza"
  ON public.match_90min_results FOR UPDATE
  TO authenticated
  USING  (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "90min: admin deleta"
  ON public.match_90min_results FOR DELETE
  TO authenticated
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_90min_match_id
  ON public.match_90min_results (match_id);
