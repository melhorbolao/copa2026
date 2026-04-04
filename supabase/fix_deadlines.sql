-- ================================================================
-- Corrige prazos de apostas: 23:59 BRT da véspera do 1º jogo
-- de cada etapa. BRT = UTC-3, logo 23:59 BRT = 02:59 UTC+0 do
-- dia seguinte.
--
-- Execute no SQL Editor do Supabase.
-- ================================================================

UPDATE public.matches SET betting_deadline = '2026-06-11 02:59+00'
  WHERE phase = 'group' AND round = 1;

UPDATE public.matches SET betting_deadline = '2026-06-16 02:59+00'
  WHERE phase = 'group' AND round = 2;

UPDATE public.matches SET betting_deadline = '2026-06-23 02:59+00'
  WHERE phase = 'group' AND round = 3;

UPDATE public.matches SET betting_deadline = '2026-06-29 02:59+00'
  WHERE phase = 'round_of_32';

UPDATE public.matches SET betting_deadline = '2026-07-07 02:59+00'
  WHERE phase = 'round_of_16';

UPDATE public.matches SET betting_deadline = '2026-07-11 02:59+00'
  WHERE phase = 'quarterfinal';

UPDATE public.matches SET betting_deadline = '2026-07-14 02:59+00'
  WHERE phase = 'semifinal';

UPDATE public.matches SET betting_deadline = '2026-07-18 02:59+00'
  WHERE phase IN ('third_place', 'final');
