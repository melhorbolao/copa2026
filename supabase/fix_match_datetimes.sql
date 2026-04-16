-- Jogo 6 (Austrália x Turquia, Vancouver): datetime estava 1 dia adiantado
-- Errado: 13/06 04:00 UTC (13/06 01:00 BRT) → Correto: 14/06 04:00 UTC (14/06 01:00 BRT)
UPDATE matches
SET match_datetime = match_datetime + interval '1 day'
WHERE match_number = 6
  AND team_home = 'Austrália'
  AND team_away = 'Turquia';

-- Jogo 36 (Tunísia x Japão, Monterrey): datetime estava 1 dia adiantado
-- Errado: 20/06 04:00 UTC (20/06 01:00 BRT) → Correto: 21/06 04:00 UTC (21/06 01:00 BRT)
UPDATE matches
SET match_datetime = match_datetime + interval '1 day'
WHERE match_number = 36
  AND team_home = 'Tunísia'
  AND team_away = 'Japão';
