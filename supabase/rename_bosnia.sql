-- Renomeia "Bósnia-Herz." → "Bósnia" em todas as tabelas
-- Execute no Supabase SQL Editor

UPDATE matches
SET team_home = 'Bósnia'
WHERE team_home IN ('Bósnia-Herz.', 'Bósnia e Herzegovina', 'Bósnia-Herzegovina');

UPDATE matches
SET team_away = 'Bósnia'
WHERE team_away IN ('Bósnia-Herz.', 'Bósnia e Herzegovina', 'Bósnia-Herzegovina');

UPDATE group_bets
SET first_place = 'Bósnia'
WHERE first_place IN ('Bósnia-Herz.', 'Bósnia e Herzegovina', 'Bósnia-Herzegovina');

UPDATE group_bets
SET second_place = 'Bósnia'
WHERE second_place IN ('Bósnia-Herz.', 'Bósnia e Herzegovina', 'Bósnia-Herzegovina');

UPDATE tournament_bets
SET champion = 'Bósnia'
WHERE champion IN ('Bósnia-Herz.', 'Bósnia e Herzegovina', 'Bósnia-Herzegovina');

UPDATE tournament_bets
SET runner_up = 'Bósnia'
WHERE runner_up IN ('Bósnia-Herz.', 'Bósnia e Herzegovina', 'Bósnia-Herzegovina');

UPDATE tournament_bets
SET semi1 = 'Bósnia'
WHERE semi1 IN ('Bósnia-Herz.', 'Bósnia e Herzegovina', 'Bósnia-Herzegovina');

UPDATE tournament_bets
SET semi2 = 'Bósnia'
WHERE semi2 IN ('Bósnia-Herz.', 'Bósnia e Herzegovina', 'Bósnia-Herzegovina');

UPDATE third_place_bets
SET team = 'Bósnia'
WHERE team IN ('Bósnia-Herz.', 'Bósnia e Herzegovina', 'Bósnia-Herzegovina');
