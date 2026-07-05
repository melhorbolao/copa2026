-- ================================================================
-- MIGRAÇÃO: Trigger para refresh de mv_zebras_radar quando
-- betting_deadline de uma partida é alterado.
--
-- Problema: ao "liberar palpites" (alterar betting_deadline para o
-- passado), a mv_zebras_radar não era atualizada porque o trigger
-- existente só dispara em INSERT/UPDATE na tabela bets.
--
-- Fix: reutiliza fn_refresh_zebras_radar_throttled() com trigger
-- AFTER UPDATE OF betting_deadline ON matches.
--
-- COMO EXECUTAR:
--   Supabase Dashboard → SQL Editor → colar e rodar este arquivo.
-- ================================================================

DROP TRIGGER IF EXISTS trg_refresh_zebras_on_deadline_change ON matches;

CREATE TRIGGER trg_refresh_zebras_on_deadline_change
  AFTER UPDATE OF betting_deadline ON matches
  FOR EACH STATEMENT
  EXECUTE FUNCTION fn_refresh_zebras_radar_throttled();
