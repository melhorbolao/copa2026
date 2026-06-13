-- ================================================================
-- MIGRAÇÃO: MATERIALIZED VIEWS PARA PERFORMANCE I/O
-- Projeto: Bolão Copa | 2026-06-12
-- Sem pg_cron. I/O zero quando não há eventos.
--
-- COMO EXECUTAR:
--   Supabase Dashboard → SQL Editor → colar e rodar este arquivo.
-- ================================================================


-- ================================================================
-- SEÇÃO 1: TABELA DE THROTTLE
-- Controla o debounce de 30s do trigger de mv_zebras_radar.
-- ================================================================

CREATE TABLE IF NOT EXISTS mv_refresh_throttle (
  view_name    TEXT        PRIMARY KEY,
  last_refresh TIMESTAMPTZ NOT NULL DEFAULT '-infinity'::TIMESTAMPTZ
);

INSERT INTO mv_refresh_throttle (view_name)
VALUES ('mv_zebras_radar')
ON CONFLICT (view_name) DO NOTHING;


-- ================================================================
-- SEÇÃO 2: MATERIALIZED VIEW — CLASSIFICAÇÃO GERAL
-- Lê pontos de participant_scores (mantido pelo pipeline TypeScript).
-- Acrescenta cravadas, pontuados e posição com rank denso.
-- ================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_general_ranking AS
WITH bet_stats AS (
  SELECT
    b.participant_id,
    COUNT(*) FILTER (
      WHERE m.score_home IS NOT NULL
        AND b.score_home = m.score_home
        AND b.score_away = m.score_away
    )::INT                                              AS cravadas,
    COUNT(*) FILTER (
      WHERE b.points > 0
    )::INT                                              AS pontuados,
    COUNT(*) FILTER (
      WHERE m.score_home IS NOT NULL
    )::INT                                              AS jogos_finalizados
  FROM bets b
  INNER JOIN matches m ON m.id = b.match_id
  GROUP BY b.participant_id
)
SELECT
  p.id                                                  AS participant_id,
  p.apelido,
  COALESCE(ps.pts_matches,       0)::INT                AS pts_matches,
  COALESCE(ps.pts_groups,        0)::INT                AS pts_groups,
  COALESCE(ps.pts_thirds,        0)::INT                AS pts_thirds,
  COALESCE(ps.pts_tournament,    0)::INT                AS pts_tournament,
  COALESCE(ps.pts_total,         0)::INT                AS pts_total,
  COALESCE(bs.cravadas,          0)::INT                AS cravadas,
  COALESCE(bs.pontuados,         0)::INT                AS pontuados,
  COALESCE(bs.jogos_finalizados, 0)::INT                AS jogos_finalizados,
  DENSE_RANK() OVER (
    ORDER BY
      COALESCE(ps.pts_total, 0) DESC,
      COALESCE(bs.cravadas,  0) DESC        -- desempate primário: cravadas
  )::INT                                                AS posicao
FROM participants            p
LEFT JOIN participant_scores ps ON ps.participant_id = p.id
LEFT JOIN bet_stats           bs ON bs.participant_id = p.id;

-- Obrigatório para REFRESH CONCURRENTLY (migração futura se necessário)
CREATE UNIQUE INDEX IF NOT EXISTS uix_mv_general_ranking_participant_id
  ON mv_general_ranking (participant_id);

-- Apoio para leituras ordenadas pela página de classificação
CREATE INDEX IF NOT EXISTS ix_mv_general_ranking_posicao
  ON mv_general_ranking (posicao, pts_total DESC);


-- ================================================================
-- SEÇÃO 3: MATERIALIZED VIEW — RADAR DE ZEBRAS
-- Percentuais pré-calculados por jogo: prazo encerrado, sem placar.
-- NOW() é avaliado no momento de cada REFRESH.
-- ================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_zebras_radar AS
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

  -- Percentuais inteiros pré-calculados (Vitória A / Empate / Vitória B)
  CASE WHEN COUNT(b.id) > 0 THEN
    ROUND(100.0 * COUNT(b.id) FILTER (WHERE b.score_home > b.score_away)
          / COUNT(b.id))::INT
  ELSE 0 END                                            AS home_pct,

  CASE WHEN COUNT(b.id) > 0 THEN
    ROUND(100.0 * COUNT(b.id) FILTER (WHERE b.score_home = b.score_away)
          / COUNT(b.id))::INT
  ELSE 0 END                                            AS draw_pct,

  CASE WHEN COUNT(b.id) > 0 THEN
    ROUND(100.0 * COUNT(b.id) FILTER (WHERE b.score_away > b.score_home)
          / COUNT(b.id))::INT
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
CREATE UNIQUE INDEX IF NOT EXISTS uix_mv_zebras_radar_match_id
  ON mv_zebras_radar (match_id);

-- Apoio para filtros de fase e grupo
CREATE INDEX IF NOT EXISTS ix_mv_zebras_radar_phase_group
  ON mv_zebras_radar (phase, group_name);


-- ================================================================
-- SEÇÃO 4: TRIGGER — mv_general_ranking
-- Evento: participant_scores sofre INSERT, UPDATE ou DELETE
-- Sem debounce: alterações de placar são ações de admin (baixa freq.)
-- ================================================================

CREATE OR REPLACE FUNCTION fn_refresh_general_ranking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- REFRESH sem CONCURRENTLY: única opção válida dentro de triggers
  -- (CONCURRENTLY proibido em contexto de transação ativa).
  -- Lock exclusivo dura < 2ms para ~100 participantes.
  REFRESH MATERIALIZED VIEW mv_general_ranking;
  RETURN NULL;
END;
$$;

-- FOR EACH STATEMENT: uma única execução por instrução SQL,
-- não uma vez por linha — essencial se TypeScript atualizar
-- participantes em loop.
DROP TRIGGER IF EXISTS trg_refresh_ranking_on_scores ON participant_scores;
CREATE TRIGGER trg_refresh_ranking_on_scores
  AFTER INSERT OR UPDATE OR DELETE ON participant_scores
  FOR EACH STATEMENT
  EXECUTE FUNCTION fn_refresh_general_ranking();


-- ================================================================
-- SEÇÃO 5: TRIGGER — mv_zebras_radar (DEBOUNCE 30 segundos)
-- Evento: bets sofre INSERT ou UPDATE
-- No máximo um REFRESH a cada 30s, mesmo sob alta concorrência.
-- ================================================================

CREATE OR REPLACE FUNCTION fn_refresh_zebras_radar_throttled()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_refresh TIMESTAMPTZ;
  v_throttle     CONSTANT INTERVAL := '30 seconds';
BEGIN
  -- FOR UPDATE SKIP LOCKED: tenta adquirir lock exclusivo na linha
  -- de throttle de forma não-bloqueante.
  --   • Outra transação tem o lock (refresh em curso) → NOT FOUND
  --     → retorna NULL imediatamente. Zero contenção.
  --   • Conseguiu o lock → avança para verificação de debounce.
  SELECT last_refresh
  INTO   v_last_refresh
  FROM   mv_refresh_throttle
  WHERE  view_name = 'mv_zebras_radar'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;  -- refresh concorrente em andamento → skip
  END IF;

  -- Dentro da janela de 30s → skip
  IF now() - v_last_refresh < v_throttle THEN
    RETURN NULL;
  END IF;

  -- Janela aberta: grava timestamp ANTES do REFRESH.
  -- O lock no UPDATE é mantido até fim desta transação,
  -- bloqueando qualquer entrada concorrente durante o REFRESH.
  UPDATE mv_refresh_throttle
  SET    last_refresh = now()
  WHERE  view_name    = 'mv_zebras_radar';

  REFRESH MATERIALIZED VIEW mv_zebras_radar;

  RETURN NULL;
END;
$$;

-- FOR EACH STATEMENT: bulk insert de N palpites → 1 tentativa de
-- REFRESH, não N.
DROP TRIGGER IF EXISTS trg_refresh_zebras_on_bet ON bets;
CREATE TRIGGER trg_refresh_zebras_on_bet
  AFTER INSERT OR UPDATE ON bets
  FOR EACH STATEMENT
  EXECUTE FUNCTION fn_refresh_zebras_radar_throttled();


-- ================================================================
-- VERIFICAÇÃO FINAL: confirmar criação das estruturas
-- ================================================================

SELECT
  schemaname,
  matviewname,
  ispopulated
FROM pg_matviews
WHERE matviewname IN ('mv_general_ranking', 'mv_zebras_radar');

SELECT
  trigger_name,
  event_manipulation,
  event_object_table,
  action_timing,
  action_orientation
FROM information_schema.triggers
WHERE trigger_name IN (
  'trg_refresh_ranking_on_scores',
  'trg_refresh_zebras_on_bet'
)
ORDER BY trigger_name, event_manipulation;
