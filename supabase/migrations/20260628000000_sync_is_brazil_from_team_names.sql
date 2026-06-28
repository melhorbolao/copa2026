-- ================================================================
-- MIGRAÇÃO: Sincroniza is_brazil com base nos nomes dos times.
--
-- Problema: jogos de mata-mata são inseridos com team_home='TBD'
-- e is_brazil=false. Quando o admin atualiza os times para o nome
-- real ('Brasil'), is_brazil não era recalculado automaticamente,
-- fazendo com que o multiplicador ×2 não fosse aplicado.
--
-- Fix:
--   1. Atualiza todos os registros existentes (retroativo).
--   2. Cria trigger BEFORE INSERT OR UPDATE para manter is_brazil
--      sempre sincronizado com team_home / team_away.
--
-- COMO EXECUTAR:
--   Supabase Dashboard → SQL Editor → colar e rodar este arquivo.
-- ================================================================

-- 1. Atualiza todos os jogos existentes
UPDATE public.matches
SET is_brazil = (team_home = 'Brasil' OR team_away = 'Brasil');

-- 2. Função do trigger
CREATE OR REPLACE FUNCTION fn_sync_is_brazil_from_teams()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_brazil := (NEW.team_home = 'Brasil' OR NEW.team_away = 'Brasil');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Trigger: dispara antes de INSERT ou UPDATE de team_home/team_away
DROP TRIGGER IF EXISTS trg_sync_is_brazil_from_teams ON public.matches;
CREATE TRIGGER trg_sync_is_brazil_from_teams
  BEFORE INSERT OR UPDATE OF team_home, team_away
  ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_is_brazil_from_teams();
