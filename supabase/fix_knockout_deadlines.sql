-- Corrige prazos das fases eliminatórias.
-- Regra: 23:59 BRT (UTC-3) = 02:59 UTC do dia SEGUINTE.
--
-- 16avos:  28/06 13:59 BRT = 28/06 16:59 UTC  (prazo alterado)
-- Oitavas: 04/07 11:59 BRT = 04/07 14:59 UTC  (prazo alterado)
-- Quartas: 08/07 23:59 BRT = 09/07 02:59 UTC
-- (Semis e Final já estavam corretas.)

UPDATE public.matches SET betting_deadline = '2026-06-28 16:59+00'
  WHERE phase = 'round_of_32';

UPDATE public.matches SET betting_deadline = '2026-07-04 14:59+00'
  WHERE phase = 'round_of_16';

UPDATE public.matches SET betting_deadline = '2026-07-09 02:59+00'
  WHERE phase = 'quarterfinal';
