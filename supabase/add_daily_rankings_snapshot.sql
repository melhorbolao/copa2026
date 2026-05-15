-- ================================================================
-- Snapshots diários de ranking — "Sobe e Desce"
-- Execute no Supabase SQL Editor
-- ================================================================

-- ── 1. Tabela principal ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_rankings_snapshot (
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date  DATE        NOT NULL,
  participant_id UUID        NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  rank           INTEGER     NOT NULL,
  pts_total      INTEGER     NOT NULL DEFAULT 0,
  pts_matches    INTEGER     NOT NULL DEFAULT 0,
  pts_groups     INTEGER     NOT NULL DEFAULT 0,
  pts_thirds     INTEGER     NOT NULL DEFAULT 0,
  pts_tournament INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (snapshot_date, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_date
  ON daily_rankings_snapshot (snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_snapshot_participant
  ON daily_rankings_snapshot (participant_id);

-- ── 2. RLS ──────────────────────────────────────────────────────
ALTER TABLE daily_rankings_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read snapshots" ON daily_rankings_snapshot;
CREATE POLICY "authenticated can read snapshots"
  ON daily_rankings_snapshot FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "service_role full access to snapshots" ON daily_rankings_snapshot;
CREATE POLICY "service_role full access to snapshots"
  ON daily_rankings_snapshot FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ── 3. Função: snapshot mais recente por participante até uma data ─
CREATE OR REPLACE FUNCTION get_rankings_at_date(p_date date)
RETURNS TABLE(
  participant_id uuid,
  rank           integer,
  pts_total      integer,
  pts_matches    integer,
  pts_groups     integer,
  pts_thirds     integer,
  pts_tournament integer,
  snapshot_date  date
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT DISTINCT ON (participant_id)
    participant_id, rank, pts_total,
    pts_matches, pts_groups, pts_thirds, pts_tournament,
    snapshot_date
  FROM daily_rankings_snapshot
  WHERE snapshot_date <= p_date
  ORDER BY participant_id, snapshot_date DESC;
$$;
