-- ================================================================
-- RPC save_bets_batch: aceita múltiplos saves de palpites de placar
-- numa única chamada (jsonb array). Reduz N requests para 1 quando
-- o usuário digita placares em rajada.
--
-- Formato do input:
--   p_bets jsonb = [
--     { "match_id": "uuid", "score_home": 1, "score_away": 0 },
--     { "match_id": "uuid", "delete": true },
--     ...
--   ]
--
-- Retorno: jsonb { saved: int, deleted: int, skipped_expired: int }
-- ================================================================

CREATE OR REPLACE FUNCTION public.save_bets_batch(
  p_participant_id uuid,
  p_bets           jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bet     jsonb;
  v_deadline timestamptz;
  v_match_id uuid;
  v_saved    int := 0;
  v_deleted  int := 0;
  v_skipped  int := 0;
BEGIN
  IF NOT public._auth_owns_participant(p_participant_id) THEN
    RAISE EXCEPTION 'Não autorizado.';
  END IF;

  FOR v_bet IN SELECT jsonb_array_elements(p_bets) LOOP
    v_match_id := (v_bet->>'match_id')::uuid;
    SELECT betting_deadline INTO v_deadline FROM public.matches WHERE id = v_match_id;
    IF v_deadline IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    IF now() > v_deadline THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF (v_bet->>'delete')::boolean IS TRUE THEN
      DELETE FROM public.bets
      WHERE participant_id = p_participant_id AND match_id = v_match_id;
      v_deleted := v_deleted + 1;
    ELSE
      INSERT INTO public.bets (participant_id, match_id, score_home, score_away)
      VALUES (
        p_participant_id, v_match_id,
        (v_bet->>'score_home')::int,
        (v_bet->>'score_away')::int
      )
      ON CONFLICT (participant_id, match_id)
      DO UPDATE SET score_home = EXCLUDED.score_home, score_away = EXCLUDED.score_away;
      v_saved := v_saved + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('saved', v_saved, 'deleted', v_deleted, 'skipped_expired', v_skipped);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_bets_batch(uuid, jsonb) TO authenticated;
