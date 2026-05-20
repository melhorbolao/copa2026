-- Reverte o prazo da Rodada 1 de 08/06 para 10/06/2026 23:59 (BRT).
-- 10/06 23:59 BRT = UTC-3 → 2026-06-11 02:59+00
--
-- Execute no SQL Editor do Supabase.

UPDATE public.matches
SET betting_deadline = '2026-06-11 02:59+00'
WHERE phase = 'group' AND round = 1;
