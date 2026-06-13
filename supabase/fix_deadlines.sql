-- ================================================================
-- Corrige prazos de apostas (BRT = UTC-3):
-- R1:      10/06 23:59 BRT → 2026-06-11 02:59+00
-- R2:      18/06 07:59 BRT → 2026-06-18 10:59+00  (prazo alterado)
-- R3:      24/06 07:59 BRT → 2026-06-24 10:59+00  (prazo alterado)
-- Demais:  véspera 23:59 BRT → 02:59 UTC do dia seguinte.
--
-- Execute no SQL Editor do Supabase.
-- ================================================================

UPDATE public.matches SET betting_deadline = '2026-06-11 02:59+00'
  WHERE phase = 'group' AND round = 1;

UPDATE public.matches SET betting_deadline = '2026-06-18 10:59+00'
  WHERE phase = 'group' AND round = 2;

UPDATE public.matches SET betting_deadline = '2026-06-24 10:59+00'
  WHERE phase = 'group' AND round = 3;

UPDATE public.matches SET betting_deadline = '2026-06-28 02:59+00'
  WHERE phase = 'round_of_32';

UPDATE public.matches SET betting_deadline = '2026-07-04 02:59+00'
  WHERE phase = 'round_of_16';

UPDATE public.matches SET betting_deadline = '2026-07-09 02:59+00'
  WHERE phase = 'quarterfinal';

UPDATE public.matches SET betting_deadline = '2026-07-14 02:59+00'
  WHERE phase = 'semifinal';

UPDATE public.matches SET betting_deadline = '2026-07-18 02:59+00'
  WHERE phase IN ('third_place', 'final');
