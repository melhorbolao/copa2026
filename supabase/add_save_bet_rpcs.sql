-- ================================================================
-- RPCs para palpites: cada função consolida verificação de prazo
-- + upsert/delete em uma única roundtrip Supabase, eliminando o
-- SELECT prévio de betting_deadline que existia em actions.ts.
--
-- Todas correm com SECURITY DEFINER para bypassar RLS (igual a
-- createAuthAdminClient()), mas validam o participant_id contra o
-- auth.uid() chamador via user_participants.
-- ================================================================

-- Helper: confere se auth.uid() corresponde a um user vinculado
-- ao participant_id informado.
CREATE OR REPLACE FUNCTION public._auth_owns_participant(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_participants up
    WHERE up.participant_id = p_id AND up.user_id = auth.uid()
  );
$$;

-- ── save_bet ───────────────────────────────────────────────────
-- 1 query: verifica prazo + upsert
CREATE OR REPLACE FUNCTION public.save_bet(
  p_participant_id uuid,
  p_match_id       uuid,
  p_score_home     int,
  p_score_away     int
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deadline timestamptz;
BEGIN
  IF NOT public._auth_owns_participant(p_participant_id) THEN
    RAISE EXCEPTION 'Não autorizado.';
  END IF;
  IF p_score_home < 0 OR p_score_away < 0 THEN
    RAISE EXCEPTION 'Placar inválido';
  END IF;
  SELECT betting_deadline INTO v_deadline FROM public.matches WHERE id = p_match_id;
  IF v_deadline IS NULL THEN
    RAISE EXCEPTION 'Partida não encontrada';
  END IF;
  IF now() > v_deadline THEN
    RAISE EXCEPTION 'Prazo encerrado';
  END IF;
  INSERT INTO public.bets (participant_id, match_id, score_home, score_away)
  VALUES (p_participant_id, p_match_id, p_score_home, p_score_away)
  ON CONFLICT (participant_id, match_id)
  DO UPDATE SET score_home = EXCLUDED.score_home, score_away = EXCLUDED.score_away;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_bet(uuid, uuid, int, int) TO authenticated;

-- ── delete_bet ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_bet(
  p_participant_id uuid,
  p_match_id       uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deadline timestamptz;
BEGIN
  IF NOT public._auth_owns_participant(p_participant_id) THEN
    RAISE EXCEPTION 'Não autorizado.';
  END IF;
  SELECT betting_deadline INTO v_deadline FROM public.matches WHERE id = p_match_id;
  IF v_deadline IS NULL THEN
    RAISE EXCEPTION 'Partida não encontrada';
  END IF;
  IF now() > v_deadline THEN
    RAISE EXCEPTION 'Prazo encerrado';
  END IF;
  DELETE FROM public.bets WHERE participant_id = p_participant_id AND match_id = p_match_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_bet(uuid, uuid) TO authenticated;

-- ── save_group_bet ─────────────────────────────────────────────
-- Prazo dos palpites bonus = menor betting_deadline da rodada 1 dos grupos.
CREATE OR REPLACE FUNCTION public._bonus_deadline()
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT MIN(betting_deadline)
  FROM public.matches
  WHERE phase = 'group' AND round = 1;
$$;

CREATE OR REPLACE FUNCTION public.save_group_bet(
  p_participant_id uuid,
  p_group_name     text,
  p_first_place    text,
  p_second_place   text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deadline timestamptz;
BEGIN
  IF NOT public._auth_owns_participant(p_participant_id) THEN
    RAISE EXCEPTION 'Não autorizado.';
  END IF;
  IF p_first_place IS NULL OR p_second_place IS NULL OR p_first_place = '' OR p_second_place = '' THEN
    RAISE EXCEPTION 'Selecione os dois times.';
  END IF;
  IF p_first_place = p_second_place THEN
    RAISE EXCEPTION '1º e 2º devem ser times diferentes.';
  END IF;
  v_deadline := public._bonus_deadline();
  IF v_deadline IS NOT NULL AND now() > v_deadline THEN
    RAISE EXCEPTION 'Prazo encerrado.';
  END IF;
  INSERT INTO public.group_bets (participant_id, group_name, first_place, second_place)
  VALUES (p_participant_id, p_group_name, p_first_place, p_second_place)
  ON CONFLICT (participant_id, group_name)
  DO UPDATE SET first_place = EXCLUDED.first_place, second_place = EXCLUDED.second_place;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_group_bet(uuid, text, text, text) TO authenticated;

-- ── save_third_place_bet ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_third_place_bet(
  p_participant_id uuid,
  p_group_name     text,
  p_team           text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deadline timestamptz;
BEGIN
  IF NOT public._auth_owns_participant(p_participant_id) THEN
    RAISE EXCEPTION 'Não autorizado.';
  END IF;
  v_deadline := public._bonus_deadline();
  IF v_deadline IS NOT NULL AND now() > v_deadline THEN
    RAISE EXCEPTION 'Prazo encerrado.';
  END IF;
  INSERT INTO public.third_place_bets (participant_id, group_name, team)
  VALUES (p_participant_id, p_group_name, p_team)
  ON CONFLICT (participant_id, group_name)
  DO UPDATE SET team = EXCLUDED.team;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_third_place_bet(uuid, text, text) TO authenticated;

-- ── delete_third_place_bet ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_third_place_bet(
  p_participant_id uuid,
  p_group_name     text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deadline timestamptz;
BEGIN
  IF NOT public._auth_owns_participant(p_participant_id) THEN
    RAISE EXCEPTION 'Não autorizado.';
  END IF;
  v_deadline := public._bonus_deadline();
  IF v_deadline IS NOT NULL AND now() > v_deadline THEN
    RAISE EXCEPTION 'Prazo encerrado.';
  END IF;
  DELETE FROM public.third_place_bets
  WHERE participant_id = p_participant_id AND group_name = p_group_name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_third_place_bet(uuid, text) TO authenticated;
