-- ================================================================
-- Infraestrutura de pontuação em tempo real
-- Execute no Supabase SQL Editor
-- ================================================================

-- ── 1. Coluna points em third_place_bets ─────────────────────────
ALTER TABLE third_place_bets
  ADD COLUMN IF NOT EXISTS points integer NULL;

-- ── 2. Tabela de totais por participante ─────────────────────────
CREATE TABLE IF NOT EXISTS participant_scores (
  participant_id uuid        PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  pts_matches    integer     NOT NULL DEFAULT 0,
  pts_groups     integer     NOT NULL DEFAULT 0,
  pts_thirds     integer     NOT NULL DEFAULT 0,
  pts_tournament integer     NOT NULL DEFAULT 0,
  pts_total      integer     NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE participant_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "participant_scores_select_all" ON participant_scores;
CREATE POLICY "participant_scores_select_all"
  ON participant_scores FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "participant_scores_service_all" ON participant_scores;
CREATE POLICY "participant_scores_service_all"
  ON participant_scores FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_participant_scores_total
  ON participant_scores (pts_total DESC);

-- ── 3. Função SQL para recalcular o total de um participante ─────
-- Chamada pelo backend TypeScript após cada ciclo de scoring.
CREATE OR REPLACE FUNCTION refresh_participant_total(p_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_matches    integer;
  v_groups     integer;
  v_thirds     integer;
  v_tournament integer;
BEGIN
  SELECT COALESCE(SUM(points), 0) INTO v_matches
    FROM bets WHERE participant_id = p_id AND points IS NOT NULL;

  SELECT COALESCE(SUM(points), 0) INTO v_groups
    FROM group_bets WHERE participant_id = p_id AND points IS NOT NULL;

  SELECT COALESCE(SUM(points), 0) INTO v_thirds
    FROM third_place_bets WHERE participant_id = p_id AND points IS NOT NULL;

  SELECT COALESCE(points, 0) INTO v_tournament
    FROM tournament_bets WHERE participant_id = p_id AND points IS NOT NULL;

  INSERT INTO participant_scores
    (participant_id, pts_matches, pts_groups, pts_thirds, pts_tournament, pts_total, updated_at)
  VALUES
    (p_id, v_matches, v_groups, v_thirds, v_tournament,
     v_matches + v_groups + v_thirds + v_tournament, now())
  ON CONFLICT (participant_id) DO UPDATE SET
    pts_matches    = EXCLUDED.pts_matches,
    pts_groups     = EXCLUDED.pts_groups,
    pts_thirds     = EXCLUDED.pts_thirds,
    pts_tournament = EXCLUDED.pts_tournament,
    pts_total      = EXCLUDED.pts_total,
    updated_at     = now();
END;
$$;
