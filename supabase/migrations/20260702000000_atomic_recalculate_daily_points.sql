-- Corrige condição de corrida em participant_points_by_day.
--
-- Antes: recalculateDailyPoints() (Node.js) fazia DELETE de toda a tabela e
-- depois reinserção em vários lotes via chamadas HTTP separadas (sem
-- transação nem lock). Como essa reconstrução é disparada em background a
-- cada salvamento de placar, duas execuções concorrentes podiam se
-- entrelaçar: um DELETE de uma sobrepondo o INSERT mais recente da outra,
-- ou um leitor (fn_get_ranking_snapshot) acessando a tabela no meio da
-- janela DELETE→INSERT e vendo dados parciais. Isso produzia ranks
-- históricos incorretos no painel "Sobe e Desce" (ex: queda de 7 posições
-- quando o participante na verdade subiu).
--
-- Agora: toda a agregação + swap (DELETE + INSERT) roda dentro de uma
-- única função PL/pgSQL, ou seja, uma única transação — leitores nunca
-- veem estado parcial (MVCC). Um advisory lock transacional serializa
-- execuções concorrentes, garantindo que a última a rodar sempre reflita
-- os dados mais recentes de bets/matches.

CREATE OR REPLACE FUNCTION fn_recalculate_daily_points(p_up_to_date DATE DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  -- Chave arbitrária fixa: serializa chamadas concorrentes a esta função.
  -- Lock de transação — liberado automaticamente no commit/rollback, o que
  -- funciona mesmo chamando via PostgREST/RPC (sem sessão persistente).
  PERFORM pg_advisory_xact_lock(hashtext('fn_recalculate_daily_points'));

  -- DELETE e INSERT como instruções sequenciais separadas (não como CTEs
  -- combinados numa única query): dentro de um WITH, sub-statements que
  -- modificam a MESMA tabela rodam "concorrentemente" entre si por definição
  -- do Postgres, sem garantia de que o DELETE termine antes do INSERT —
  -- na prática isso causava "duplicate key" no INSERT. Como instruções
  -- plpgsql sequenciais, a ordem é garantida, e como ambas ficam na mesma
  -- transação da função, o efeito ainda é atômico para quem lê a tabela.
  DELETE FROM participant_points_by_day
  WHERE event_date >= '1900-01-01';

  INSERT INTO participant_points_by_day
    (event_date, participant_id, pts_matches, pts_groups, pts_thirds, pts_tournament)
  WITH match_info AS (
    SELECT
      id AS match_id,
      phase,
      group_name,
      (match_datetime AT TIME ZONE 'Etc/GMT+6')::date AS event_date
    FROM matches
  ),
  group_last_date AS (
    -- Última data (por data do jogo) de cada grupo — data "natural" de
    -- atribuição dos pontos de group_bets / third_place_bets.
    SELECT group_name, MAX(event_date) AS last_date
    FROM match_info
    WHERE phase = 'group' AND group_name IS NOT NULL
    GROUP BY group_name
  ),
  final_date AS (
    SELECT MAX(event_date) AS last_date
    FROM match_info
    WHERE phase = 'final'
  ),
  match_pts AS (
    SELECT mi.event_date, b.participant_id, SUM(b.points) AS pts
    FROM bets b
    JOIN match_info mi ON mi.match_id = b.match_id
    WHERE COALESCE(b.points, 0) <> 0
    GROUP BY mi.event_date, b.participant_id
  ),
  group_pts AS (
    -- "cap": pontos de datas futuras à p_up_to_date antecipam para p_up_to_date
    -- em vez de serem descartados (mesmo comportamento do JS original).
    SELECT
      CASE WHEN p_up_to_date IS NOT NULL AND gld.last_date > p_up_to_date
           THEN p_up_to_date ELSE gld.last_date END AS event_date,
      g.participant_id,
      SUM(g.points) AS pts
    FROM group_bets g
    JOIN group_last_date gld ON gld.group_name = g.group_name
    WHERE COALESCE(g.points, 0) <> 0
    GROUP BY 1, g.participant_id
  ),
  third_pts AS (
    SELECT
      CASE WHEN p_up_to_date IS NOT NULL AND gld.last_date > p_up_to_date
           THEN p_up_to_date ELSE gld.last_date END AS event_date,
      t.participant_id,
      SUM(t.points) AS pts
    FROM third_place_bets t
    JOIN group_last_date gld ON gld.group_name = t.group_name
    WHERE COALESCE(t.points, 0) <> 0
    GROUP BY 1, t.participant_id
  ),
  tournament_pts AS (
    SELECT eff.event_date, tb.participant_id, SUM(tb.points) AS pts
    FROM tournament_bets tb
    CROSS JOIN (
      SELECT CASE
        WHEN (SELECT last_date FROM final_date) IS NOT NULL THEN
          CASE WHEN p_up_to_date IS NOT NULL AND (SELECT last_date FROM final_date) > p_up_to_date
               THEN p_up_to_date ELSE (SELECT last_date FROM final_date) END
        ELSE p_up_to_date
      END AS event_date
    ) eff
    WHERE COALESCE(tb.points, 0) <> 0
      AND eff.event_date IS NOT NULL
    GROUP BY eff.event_date, tb.participant_id
  ),
  totals AS (
    SELECT event_date, participant_id,
           SUM(pts_matches)    AS pts_matches,
           SUM(pts_groups)     AS pts_groups,
           SUM(pts_thirds)     AS pts_thirds,
           SUM(pts_tournament) AS pts_tournament
    FROM (
      SELECT event_date, participant_id, pts AS pts_matches, 0 AS pts_groups, 0 AS pts_thirds, 0 AS pts_tournament FROM match_pts
      UNION ALL
      SELECT event_date, participant_id, 0, pts, 0, 0 FROM group_pts
      UNION ALL
      SELECT event_date, participant_id, 0, 0, pts, 0 FROM third_pts
      UNION ALL
      SELECT event_date, participant_id, 0, 0, 0, pts FROM tournament_pts
    ) combined
    GROUP BY event_date, participant_id
  )
  SELECT event_date, participant_id, pts_matches, pts_groups, pts_thirds, pts_tournament
  FROM totals
  WHERE p_up_to_date IS NULL OR event_date <= p_up_to_date;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Função de escrita: restringe execução ao service_role (chamada apenas via
-- código de servidor autenticado como admin), evitando que qualquer usuário
-- autenticado dispare reconstruções via RPC direto.
REVOKE ALL ON FUNCTION fn_recalculate_daily_points(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_recalculate_daily_points(DATE) TO service_role;
