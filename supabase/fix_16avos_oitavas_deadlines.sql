-- Corrige o prazo dos 16 avos para 28/06/2026 13:59 (BRT) e
-- das Oitavas para 04/07/2026 11:59 (BRT).
-- 28/06 13:59 BRT = UTC-3 → 2026-06-28 16:59+00
-- 04/07 11:59 BRT = UTC-3 → 2026-07-04 14:59+00
--
-- Execute no SQL Editor do Supabase.

UPDATE public.matches
SET betting_deadline = '2026-06-28 16:59+00'
WHERE phase = 'round_of_32';

UPDATE public.matches
SET betting_deadline = '2026-07-04 14:59+00'
WHERE phase = 'round_of_16';
