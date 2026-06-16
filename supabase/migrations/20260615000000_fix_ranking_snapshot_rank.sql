-- Corrige fn_get_ranking_snapshot para usar RANK() em vez de DENSE_RANK().
-- DENSE_RANK não pula posições em empates (ex: dois 10os → próximo é 11o).
-- RANK pula posições corretamente (ex: dois 10os → próximo é 12o),
-- alinhando com o comportamento do cliente em ClassificacaoMBClient.tsx.

CREATE OR REPLACE FUNCTION fn_get_ranking_snapshot(p_date DATE)
RETURNS TABLE (
  participant_id UUID,
  rank           BIGINT,
  pts_total      BIGINT,
  pts_matches    BIGINT,
  pts_groups     BIGINT,
  pts_thirds     BIGINT,
  pts_tournament BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    participant_id,
    RANK() OVER (ORDER BY pts_total DESC) AS rank,
    pts_total,
    pts_matches,
    pts_groups,
    pts_thirds,
    pts_tournament
  FROM (
    SELECT
      participant_id,
      SUM(pts_matches + pts_groups + pts_thirds + pts_tournament) AS pts_total,
      SUM(pts_matches)    AS pts_matches,
      SUM(pts_groups)     AS pts_groups,
      SUM(pts_thirds)     AS pts_thirds,
      SUM(pts_tournament) AS pts_tournament
    FROM participant_points_by_day
    WHERE event_date <= p_date
    GROUP BY participant_id
  ) totals
$$;
