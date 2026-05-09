-- ================================================================
-- RESET PARA INÍCIO DA COPA 2026 — operação destrutiva
-- Apaga: todos os palpites, todas as pontuações, todos os resultados
-- Mantém: usuários, participantes, jogos (tabela da Copa), configs
-- ================================================================
-- COMO RODAR: Supabase Dashboard → SQL Editor → New query → cola tudo → Run
-- ================================================================

BEGIN;

-- ── 1. Snapshot do que será apagado (aparece no output antes do TRUNCATE) ──
DO $$
DECLARE
  v_bets             bigint;
  v_group_bets       bigint;
  v_tournament_bets  bigint;
  v_third_place_bets bigint;
  v_scores           bigint;
  v_simulations      bigint;
  v_attendance       bigint;
  v_photos           bigint;
  v_email_logs       bigint;
  v_matches_played   bigint;
BEGIN
  SELECT count(*) INTO v_bets             FROM public.bets;
  SELECT count(*) INTO v_group_bets       FROM public.group_bets;
  SELECT count(*) INTO v_tournament_bets  FROM public.tournament_bets;
  SELECT count(*) INTO v_third_place_bets FROM public.third_place_bets;
  SELECT count(*) INTO v_scores           FROM public.participant_scores;
  SELECT count(*) INTO v_simulations      FROM public.user_simulations;
  SELECT count(*) INTO v_attendance       FROM public.stadium_attendance;
  SELECT count(*) INTO v_photos           FROM public.stadium_photos;
  SELECT count(*) INTO v_email_logs       FROM public.email_logs;
  SELECT count(*) INTO v_matches_played   FROM public.matches
    WHERE score_home IS NOT NULL OR score_away IS NOT NULL OR penalty_winner IS NOT NULL;

  RAISE NOTICE '── SNAPSHOT ANTES DO RESET ──';
  RAISE NOTICE 'bets:              %', v_bets;
  RAISE NOTICE 'group_bets:        %', v_group_bets;
  RAISE NOTICE 'tournament_bets:   %', v_tournament_bets;
  RAISE NOTICE 'third_place_bets:  %', v_third_place_bets;
  RAISE NOTICE 'participant_scores:%', v_scores;
  RAISE NOTICE 'user_simulations:  %', v_simulations;
  RAISE NOTICE 'stadium_attendance:%', v_attendance;
  RAISE NOTICE 'stadium_photos:    %', v_photos;
  RAISE NOTICE 'email_logs:        %', v_email_logs;
  RAISE NOTICE 'matches com resultado: %', v_matches_played;
END $$;

-- ── 2. Limpa palpites e pontuações ──
TRUNCATE TABLE
  public.bets,
  public.group_bets,
  public.tournament_bets,
  public.third_place_bets,
  public.participant_scores,
  public.user_simulations
CASCADE;

-- ── 3. Limpa registros operacionais auxiliares ──
TRUNCATE TABLE
  public.stadium_attendance,
  public.stadium_photos,
  public.email_logs
CASCADE;

-- ── 4. Zera resultados oficiais nos jogos (mantém todas as linhas) ──
UPDATE public.matches
SET score_home     = NULL,
    score_away     = NULL,
    penalty_winner = NULL
WHERE score_home     IS NOT NULL
   OR score_away     IS NOT NULL
   OR penalty_winner IS NOT NULL;

-- ── 5. Verificação pós-reset ──
DO $$
DECLARE
  v_users        bigint;
  v_participants bigint;
  v_matches      bigint;
  v_bets_sum     bigint;
  v_results      bigint;
BEGIN
  SELECT count(*) INTO v_users        FROM public.users;
  SELECT count(*) INTO v_participants FROM public.participants;
  SELECT count(*) INTO v_matches      FROM public.matches;
  SELECT (SELECT count(*) FROM public.bets)
       + (SELECT count(*) FROM public.group_bets)
       + (SELECT count(*) FROM public.tournament_bets)
       + (SELECT count(*) FROM public.third_place_bets)
    INTO v_bets_sum;
  SELECT count(*) INTO v_results FROM public.matches
    WHERE score_home IS NOT NULL OR score_away IS NOT NULL OR penalty_winner IS NOT NULL;

  RAISE NOTICE '── ESTADO APÓS RESET ──';
  RAISE NOTICE 'users (mantidos):           %', v_users;
  RAISE NOTICE 'participants (mantidos):    %', v_participants;
  RAISE NOTICE 'matches (mantidos):         %', v_matches;
  RAISE NOTICE 'palpites totais (deve ser 0):    %', v_bets_sum;
  RAISE NOTICE 'matches com resultado (deve 0):  %', v_results;
END $$;

-- Para descartar tudo em vez de aplicar, troque COMMIT por ROLLBACK abaixo:
COMMIT;
