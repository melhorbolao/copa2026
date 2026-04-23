-- Fix: updated_at em bets só deve mudar quando o palpite (placar) muda,
-- não quando o recálculo de pontuação atualiza apenas a coluna `points`.

CREATE OR REPLACE FUNCTION public.bets_score_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.score_home IS DISTINCT FROM OLD.score_home)
  OR (NEW.score_away IS DISTINCT FROM OLD.score_away) THEN
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bets_set_updated_at ON public.bets;

CREATE TRIGGER bets_set_updated_at
  BEFORE UPDATE ON public.bets
  FOR EACH ROW EXECUTE PROCEDURE public.bets_score_updated_at();
