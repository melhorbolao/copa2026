-- Atualiza labels da tabela scoring_rules conforme regulamento revisado

UPDATE scoring_rules SET label = 'Acertar o 4º lugar (cumulativo)'              WHERE key = 'bonus_quarto';
UPDATE scoring_rules SET label = 'Acertar o 3º lugar (cumulativo)'              WHERE key = 'bonus_terceiro';
UPDATE scoring_rules SET label = 'Bônus zebra G4 (cumulativo)'                  WHERE key = 'bonus_zebra_g4';
UPDATE scoring_rules SET label = 'Bônus zebra: cravar 1º do grupo (cumulativo)' WHERE key = 'bonus_zebra_grupo_1';
UPDATE scoring_rules SET label = 'Acertar 3º do grupo classificado (cumulativo)' WHERE key = 'terceiro_classificado';
UPDATE scoring_rules SET label = 'Acertar cada semifinalista'                   WHERE key = 'semifinalista';
UPDATE scoring_rules SET label = 'Acertar cada finalista (cumulativo)'          WHERE key = 'bonus_finalista';
UPDATE scoring_rules SET label = 'Bônus zebra no jogo (cumulativo)'             WHERE key = 'bonus_zebra_jogo';
