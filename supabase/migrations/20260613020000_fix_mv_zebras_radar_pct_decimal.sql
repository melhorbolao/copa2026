-- ================================================================
-- CORREÇÃO: mv_zebras_radar — percentuais com 1 casa decimal
-- Antes: ROUND(...)::INT  → 0.497% arredondava para 0 (inteiro)
-- Depois: ROUND(..., 1)   → 0.497% arredonda para 0.5 (decimal)
-- ================================================================
-- COMO EXECUTAR:
--   Supabase Dashboard → SQL Editor → colar e rodar este arquivo.
-- ================================================================

-- Recria a MV com ROUND(..., 1) nos percentuais
DROP MATERIALIZED VIEW IF EXISTS mv_zebras_radar CASCADE;

CREATE MATERIALIZED VIEW mv_zebras_radar AS
SELECT
  m.id                                                  AS match_id,
  m.match_number,
  m.team_home,
  m.team_away,
  m.flag_home,
  m.flag_away,
  m.match_datetime,
  m.betting_deadline,
  m.phase,
  m.group_name,
  m.round,
  m.city,
  m.is_brazil,
  COUNT(b.id)::INT                                      AS total_bets,

  -- Contagens brutas
  COUNT(b.id) FILTER (WHERE b.score_home > b.score_away)::INT  AS home_count,
  COUNT(b.id) FILTER (WHERE b.score_home = b.score_away)::INT  AS draw_count,
  COUNT(b.id) FILTER (WHERE b.score_away > b.score_home)::INT  AS away_count,

  -- Percentuais com 1 decimal (corrige ROUND(0.497)::INT = 0 → ROUND(0.497,1) = 0.5)
  CASE WHEN COUNT(b.id) > 0 THEN
    ROUND(100.0 * COUNT(b.id) FILTER (WHERE b.score_home > b.score_away)
          / COUNT(b.id), 1)
  ELSE 0 END                                            AS home_pct,

  CASE WHEN COUNT(b.id) > 0 THEN
    ROUND(100.0 * COUNT(b.id) FILTER (WHERE b.score_home = b.score_away)
          / COUNT(b.id), 1)
  ELSE 0 END                                            AS draw_pct,

  CASE WHEN COUNT(b.id) > 0 THEN
    ROUND(100.0 * COUNT(b.id) FILTER (WHERE b.score_away > b.score_home)
          / COUNT(b.id), 1)
  ELSE 0 END                                            AS away_pct

FROM matches m
LEFT JOIN bets b ON b.match_id = m.id
WHERE
  m.score_home IS NULL               -- jogo sem resultado oficial
  AND m.team_home <> 'TBD'           -- times já definidos
  AND m.team_away <> 'TBD'
  AND m.betting_deadline <= now()    -- prazo encerrado: apostas visíveis
GROUP BY
  m.id, m.match_number, m.team_home, m.team_away,
  m.flag_home, m.flag_away, m.match_datetime, m.betting_deadline,
  m.phase, m.group_name, m.round, m.city, m.is_brazil;

-- Obrigatório para REFRESH CONCURRENTLY (migração futura se necessário)
CREATE UNIQUE INDEX uix_mv_zebras_radar_match_id
  ON mv_zebras_radar (match_id);

-- Apoio para filtros de fase e grupo
CREATE INDEX ix_mv_zebras_radar_phase_group
  ON mv_zebras_radar (phase, group_name);
