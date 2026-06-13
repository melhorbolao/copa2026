-- =============================================================================
-- MIGRAÇÃO: fn_bet_distribution_by_match
-- Data: 2026-06-13
-- Objetivo: Retornar a distribuição agregada de palpites por jogo (H/D/A e total)
--           sem transferir os ~5.300 registros individuais para o Node.js.
--           Usado pelo Comparador para calcular colPopMap e detectar zebras em
--           jogos encerrados.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_bet_distribution_by_match()
RETURNS TABLE (
  match_id UUID,
  h        INT,
  d        INT,
  a        INT,
  total    INT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    match_id,
    COUNT(*) FILTER (WHERE score_home > score_away)::INT AS h,
    COUNT(*) FILTER (WHERE score_home = score_away)::INT AS d,
    COUNT(*) FILTER (WHERE score_away > score_home)::INT AS a,
    COUNT(*)::INT                                        AS total
  FROM bets
  GROUP BY match_id
$$;
