-- Corrige o prazo da Rodada 2 para 18/06/2026 07:59 (BRT) e
-- da Rodada 3 para 24/06/2026 07:59 (BRT).
-- 18/06 07:59 BRT = UTC-3 → 2026-06-18 10:59+00
-- 24/06 07:59 BRT = UTC-3 → 2026-06-24 10:59+00
--
-- Execute no SQL Editor do Supabase.

UPDATE public.matches
SET betting_deadline = '2026-06-18 10:59+00'
WHERE phase = 'group' AND round = 2;

UPDATE public.matches
SET betting_deadline = '2026-06-24 10:59+00'
WHERE phase = 'group' AND round = 3;
