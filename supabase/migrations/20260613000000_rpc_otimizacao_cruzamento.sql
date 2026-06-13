-- =============================================================================
-- MIGRAÇÃO: RPCs de otimização de cruzamento de dados
-- Data: 2026-06-13
-- Objetivo: Transferir lógicas relacionais custosas do frontend (Next.js) para
--           o motor do PostgreSQL, reduzindo payload de rede em até 530×.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. fn_compare_participants
--    Retorna apenas os jogos onde dois participantes divergem no placar.
--    Substitui o fetchAll('bets') que baixava ~5.300 linhas para fazer o JOIN
--    em TypeScript; passa a retornar ~15 linhas de divergências.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_compare_participants(
  target_user_id    UUID,
  reference_user_id UUID
)
RETURNS TABLE (
  match_id        UUID,
  target_home     SMALLINT,
  target_away     SMALLINT,
  reference_home  SMALLINT,
  reference_away  SMALLINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    t.match_id,
    t.score_home  AS target_home,
    t.score_away  AS target_away,
    r.score_home  AS reference_home,
    r.score_away  AS reference_away
  FROM bets t
  JOIN bets r
    ON  r.match_id       = t.match_id
    AND r.participant_id = reference_user_id
  WHERE t.participant_id = target_user_id
    AND (t.score_home <> r.score_home
      OR t.score_away <> r.score_away)
$$;


-- -----------------------------------------------------------------------------
-- 2. fn_get_tribe_divergences
--    Para um participante vs. uma tribo inteira: retorna, por jogo, quantos
--    membros da tribo apostaram diferente — em valor absoluto e percentual.
--    Dado novo que não existia no frontend; viabiliza comparação "1 vs grupo"
--    sem baixar os palpites individuais de cada membro.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_get_tribe_divergences(
  target_user_id UUID,
  tribe_id_input UUID
)
RETURNS TABLE (
  match_id        UUID,
  target_home     SMALLINT,
  target_away     SMALLINT,
  tribe_size      BIGINT,
  divergent_count BIGINT,
  divergence_pct  NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    t.match_id,
    t.score_home                                              AS target_home,
    t.score_away                                             AS target_away,
    COUNT(*)                                                 AS tribe_size,
    COUNT(*) FILTER (
      WHERE m.score_home <> t.score_home
         OR m.score_away <> t.score_away
    )                                                        AS divergent_count,
    ROUND(
      COUNT(*) FILTER (
        WHERE m.score_home <> t.score_home
           OR m.score_away <> t.score_away
      ) * 100.0 / NULLIF(COUNT(*), 0),
      1
    )                                                        AS divergence_pct
  FROM bets t
  JOIN participant_tribes pt
    ON  pt.tribe_id = tribe_id_input
  JOIN bets m
    ON  m.match_id       = t.match_id
    AND m.participant_id = pt.participant_id
    AND m.participant_id <> target_user_id
  WHERE t.participant_id = target_user_id
  GROUP BY t.match_id, t.score_home, t.score_away
  HAVING COUNT(*) > 0
$$;


-- -----------------------------------------------------------------------------
-- 3. fn_get_ranking_snapshot
--    Agrega participant_points_by_day até uma data e retorna ranking com DENSE_RANK.
--    Substitui o loop de paginação em /api/rankings/snapshots/route.ts que baixava
--    até 12.800 linhas para agregar em Node.js; passa a retornar ~100 linhas.
-- -----------------------------------------------------------------------------
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
AS $$
  SELECT
    participant_id,
    DENSE_RANK() OVER (ORDER BY pts_total DESC) AS rank,
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
