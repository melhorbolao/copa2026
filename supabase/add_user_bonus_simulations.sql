-- ================================================================
-- Tabelas para inputs diretos no Meu Simulador MB:
--   user_group_simulations       — 1º e 2º de cada grupo
--   user_third_simulations       — 8 terceiros classificados (por grupo)
--   user_tournament_simulations  — G4 + artilheiro
--
-- Cada usuário simula livremente (independente dos placares).
-- RLS: cada usuário gerencia apenas as próprias simulações.
-- ================================================================

-- ── 1º/2º de cada grupo ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_group_simulations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL,
  group_name   CHAR(1)     NOT NULL,
  first_place  TEXT        NOT NULL DEFAULT '',
  second_place TEXT        NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_group_sim_unique UNIQUE (user_id, group_name)
);
CREATE INDEX IF NOT EXISTS idx_user_group_sim_user ON public.user_group_simulations (user_id);

ALTER TABLE public.user_group_simulations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_group_sim: own"           ON public.user_group_simulations;
CREATE POLICY "user_group_sim: own"
  ON public.user_group_simulations FOR ALL TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Terceiros classificados (por grupo) ──────────────────────────
-- Para cada grupo, o usuário simula qual time terminou em 3º.
-- Os 4 grupos sem entrada (NULL/team='') ficam como "não se classifica".
-- 8 grupos com team preenchido = 8 terceiros classificados.
CREATE TABLE IF NOT EXISTS public.user_third_simulations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL,
  group_name   CHAR(1)     NOT NULL,
  team         TEXT        NOT NULL DEFAULT '',
  qualifies    BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_third_sim_unique UNIQUE (user_id, group_name)
);
CREATE INDEX IF NOT EXISTS idx_user_third_sim_user ON public.user_third_simulations (user_id);

ALTER TABLE public.user_third_simulations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_third_sim: own"           ON public.user_third_simulations;
CREATE POLICY "user_third_sim: own"
  ON public.user_third_simulations FOR ALL TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── G4 + artilheiro ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_tournament_simulations (
  user_id      UUID        PRIMARY KEY,
  champion     TEXT        NOT NULL DEFAULT '',
  runner_up    TEXT        NOT NULL DEFAULT '',
  semi1        TEXT        NOT NULL DEFAULT '',
  semi2        TEXT        NOT NULL DEFAULT '',
  top_scorer   TEXT        NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_tournament_simulations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_tournament_sim: own"           ON public.user_tournament_simulations;
CREATE POLICY "user_tournament_sim: own"
  ON public.user_tournament_simulations FOR ALL TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
