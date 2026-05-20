-- Corrige o prazo da Rodada 2 para 17/06/2026 23:59 (BRT) e
-- da Rodada 3 para 23/06/2026 23:59 (BRT).
-- 17/06 23:59 BRT = UTC-3 → 2026-06-18 02:59+00
-- 23/06 23:59 BRT = UTC-3 → 2026-06-24 02:59+00
--
-- Execute no SQL Editor do Supabase.

UPDATE public.matches
SET betting_deadline = '2026-06-18 02:59+00'
WHERE phase = 'group' AND round = 2;

UPDATE public.matches
SET betting_deadline = '2026-06-24 02:59+00'
WHERE phase = 'group' AND round = 3;
