-- ============================================================
-- Rastreamento de prazos de palpites para Relatório de Auditoria
-- Execute no SQL Editor do Supabase
-- ============================================================

-- ── 1. updated_at em tabelas de bônus ────────────────────────

ALTER TABLE public.group_bets
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.tournament_bets
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.third_place_bets
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Triggers de updated_at para as novas colunas
DROP TRIGGER IF EXISTS group_bets_set_updated_at      ON public.group_bets;
DROP TRIGGER IF EXISTS tournament_bets_set_updated_at ON public.tournament_bets;
DROP TRIGGER IF EXISTS third_place_bets_set_updated_at ON public.third_place_bets;

CREATE TRIGGER group_bets_set_updated_at
  BEFORE UPDATE ON public.group_bets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER tournament_bets_set_updated_at
  BEFORE UPDATE ON public.tournament_bets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER third_place_bets_set_updated_at
  BEFORE UPDATE ON public.third_place_bets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. Tabela prediction_logs ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.prediction_logs (
  participant_id  uuid        NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  deadline_key    text        NOT NULL,  -- 'group_r1', 'group_r2', 'group_r3', 'bonus', 'round_of_32', etc.
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz NULL,      -- primeira vez que todos palpites do prazo foram preenchidos
  PRIMARY KEY (participant_id, deadline_key)
);

COMMENT ON TABLE public.prediction_logs IS
  'Rastreamento de última alteração e primeira conclusão de palpites por prazo (deadline_key).';
COMMENT ON COLUMN public.prediction_logs.completed_at IS
  'Primeiro instante em que todos os palpites obrigatórios do prazo foram detectados como preenchidos. Nunca alterado após gravado.';

-- ── 3. Helper: converte match_id em deadline_key ──────────────

CREATE OR REPLACE FUNCTION public.get_deadline_key_for_match(p_match_id uuid)
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT CASE phase
    WHEN 'group' THEN 'group_r' || round::text
    ELSE phase::text
  END
  FROM public.matches
  WHERE id = p_match_id;
$$;

-- ── 4. Helper: verifica se participante completou um prazo ────

CREATE OR REPLACE FUNCTION public.check_prediction_completion(
  p_participant_id uuid,
  p_deadline_key   text
)
RETURNS boolean
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_total_groups integer;
  v_gb_count     integer;
  v_tb_count     integer;
  v_trn_count    integer;
  v_round        integer;
  v_total        integer;
  v_filled       integer;
BEGIN
  -- Bloco bônus: group_bets + third_place_bets + tournament_bets
  IF p_deadline_key = 'bonus' THEN
    SELECT COUNT(DISTINCT group_name) INTO v_total_groups
    FROM public.matches WHERE phase = 'group';

    SELECT COUNT(*) INTO v_gb_count
    FROM public.group_bets WHERE participant_id = p_participant_id;

    SELECT COUNT(*) INTO v_tb_count
    FROM public.third_place_bets WHERE participant_id = p_participant_id;

    SELECT COUNT(*) INTO v_trn_count
    FROM public.tournament_bets WHERE participant_id = p_participant_id;

    RETURN v_total_groups > 0
      AND v_gb_count  >= v_total_groups
      AND v_tb_count  >= v_total_groups
      AND v_trn_count >= 1;
  END IF;

  -- Rodadas da fase de grupos: 'group_r1', 'group_r2', 'group_r3'
  IF p_deadline_key LIKE 'group_r%' THEN
    v_round := SUBSTRING(p_deadline_key FROM 8)::integer;

    SELECT COUNT(*) INTO v_total
    FROM public.matches WHERE phase = 'group' AND round = v_round;

    SELECT COUNT(*) INTO v_filled
    FROM public.bets b
    JOIN public.matches m ON m.id = b.match_id
    WHERE b.participant_id = p_participant_id
      AND m.phase = 'group' AND m.round = v_round;
  ELSE
    -- Fases de mata-mata: 'round_of_32', 'round_of_16', 'quarterfinal', etc.
    SELECT COUNT(*) INTO v_total
    FROM public.matches WHERE phase = p_deadline_key::match_phase;

    SELECT COUNT(*) INTO v_filled
    FROM public.bets b
    JOIN public.matches m ON m.id = b.match_id
    WHERE b.participant_id = p_participant_id
      AND m.phase = p_deadline_key::match_phase;
  END IF;

  RETURN v_total > 0 AND v_filled >= v_total;
END;
$$;

-- ── 5. Trigger function: bets → prediction_logs ───────────────

CREATE OR REPLACE FUNCTION public.trg_bets_update_prediction_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_key      text;
  v_complete boolean;
BEGIN
  -- Ignora updates que só alteram pontuação (não o placar)
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.score_home IS NOT DISTINCT FROM OLD.score_home)
    AND (NEW.score_away IS NOT DISTINCT FROM OLD.score_away) THEN
      RETURN NEW;
    END IF;
  END IF;

  v_key := public.get_deadline_key_for_match(NEW.match_id);
  IF v_key IS NULL THEN RETURN NEW; END IF;

  v_complete := public.check_prediction_completion(NEW.participant_id, v_key);

  INSERT INTO public.prediction_logs (participant_id, deadline_key, last_updated_at, completed_at)
  VALUES (
    NEW.participant_id,
    v_key,
    now(),
    CASE WHEN v_complete THEN now() ELSE NULL END
  )
  ON CONFLICT (participant_id, deadline_key) DO UPDATE
  SET last_updated_at = now(),
      completed_at = CASE
        WHEN v_complete AND prediction_logs.completed_at IS NULL THEN now()
        ELSE prediction_logs.completed_at
      END;

  RETURN NEW;
END;
$$;

-- ── 6. Trigger function: bônus → prediction_logs ─────────────

CREATE OR REPLACE FUNCTION public.trg_bonus_update_prediction_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_complete boolean;
BEGIN
  v_complete := public.check_prediction_completion(NEW.participant_id, 'bonus');

  INSERT INTO public.prediction_logs (participant_id, deadline_key, last_updated_at, completed_at)
  VALUES (
    NEW.participant_id,
    'bonus',
    now(),
    CASE WHEN v_complete THEN now() ELSE NULL END
  )
  ON CONFLICT (participant_id, deadline_key) DO UPDATE
  SET last_updated_at = now(),
      completed_at = CASE
        WHEN v_complete AND prediction_logs.completed_at IS NULL THEN now()
        ELSE prediction_logs.completed_at
      END;

  RETURN NEW;
END;
$$;

-- ── 7. Instala triggers ───────────────────────────────────────

DROP TRIGGER IF EXISTS trg_bets_prediction_log         ON public.bets;
DROP TRIGGER IF EXISTS trg_group_bets_pred_log         ON public.group_bets;
DROP TRIGGER IF EXISTS trg_tournament_bets_pred_log    ON public.tournament_bets;
DROP TRIGGER IF EXISTS trg_third_place_bets_pred_log   ON public.third_place_bets;

CREATE TRIGGER trg_bets_prediction_log
  AFTER INSERT OR UPDATE ON public.bets
  FOR EACH ROW EXECUTE FUNCTION public.trg_bets_update_prediction_log();

CREATE TRIGGER trg_group_bets_pred_log
  AFTER INSERT OR UPDATE ON public.group_bets
  FOR EACH ROW EXECUTE FUNCTION public.trg_bonus_update_prediction_log();

CREATE TRIGGER trg_tournament_bets_pred_log
  AFTER INSERT OR UPDATE ON public.tournament_bets
  FOR EACH ROW EXECUTE FUNCTION public.trg_bonus_update_prediction_log();

CREATE TRIGGER trg_third_place_bets_pred_log
  AFTER INSERT OR UPDATE ON public.third_place_bets
  FOR EACH ROW EXECUTE FUNCTION public.trg_bonus_update_prediction_log();

-- ── 8. Backfill: popula logs com dados existentes ─────────────

-- Bets: usa updated_at real (já rastreado)
INSERT INTO public.prediction_logs (participant_id, deadline_key, last_updated_at)
SELECT
  b.participant_id,
  CASE m.phase
    WHEN 'group' THEN 'group_r' || m.round::text
    ELSE m.phase::text
  END AS deadline_key,
  MAX(b.updated_at) AS last_updated_at
FROM public.bets b
JOIN public.matches m ON m.id = b.match_id
GROUP BY b.participant_id, deadline_key
ON CONFLICT (participant_id, deadline_key) DO UPDATE
  SET last_updated_at = GREATEST(prediction_logs.last_updated_at, EXCLUDED.last_updated_at);

-- Bônus: usa now() pois os timestamps históricos não existiam
INSERT INTO public.prediction_logs (participant_id, deadline_key, last_updated_at)
SELECT participant_id, 'bonus', MAX(updated_at)
FROM public.group_bets
GROUP BY participant_id
ON CONFLICT (participant_id, deadline_key) DO UPDATE
  SET last_updated_at = GREATEST(prediction_logs.last_updated_at, EXCLUDED.last_updated_at);

INSERT INTO public.prediction_logs (participant_id, deadline_key, last_updated_at)
SELECT participant_id, 'bonus', MAX(updated_at)
FROM public.tournament_bets
GROUP BY participant_id
ON CONFLICT (participant_id, deadline_key) DO UPDATE
  SET last_updated_at = GREATEST(prediction_logs.last_updated_at, EXCLUDED.last_updated_at);

INSERT INTO public.prediction_logs (participant_id, deadline_key, last_updated_at)
SELECT participant_id, 'bonus', MAX(updated_at)
FROM public.third_place_bets
GROUP BY participant_id
ON CONFLICT (participant_id, deadline_key) DO UPDATE
  SET last_updated_at = GREATEST(prediction_logs.last_updated_at, EXCLUDED.last_updated_at);

-- Marca completed_at nos registros do backfill onde todos palpites já existem
UPDATE public.prediction_logs pl
SET completed_at = pl.last_updated_at
WHERE pl.completed_at IS NULL
  AND public.check_prediction_completion(pl.participant_id, pl.deadline_key);
