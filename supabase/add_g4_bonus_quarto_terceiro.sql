-- Atualiza valores dos classificados por grupo conforme novo regulamento
UPDATE scoring_rules SET points = 16 WHERE key = 'grupo_ordem_certa';
UPDATE scoring_rules SET points = 10 WHERE key = 'grupo_ordem_invertida';
UPDATE scoring_rules SET points =  8 WHERE key = 'grupo_primeiro_certo';
UPDATE scoring_rules SET points =  6 WHERE key = 'grupo_segundo_certo';
UPDATE scoring_rules SET points =  3 WHERE key = 'grupo_um_dos_dois';
UPDATE scoring_rules SET points =  3 WHERE key = 'terceiro_classificado';

-- Adiciona itens G4: 4º lugar e 3º lugar (se ainda não existirem)
INSERT INTO scoring_rules (key, label, points, category, is_zebra_bonus)
VALUES
  ('bonus_quarto',   'Acerto do 4º lugar',      4, 'g4_artilheiro', false),
  ('bonus_terceiro', 'Acerto do 3º lugar',       6, 'g4_artilheiro', false)
ON CONFLICT (key) DO UPDATE
  SET label   = EXCLUDED.label,
      points  = EXCLUDED.points,
      category = EXCLUDED.category;

-- Garante que os valores de artilheiro/finalistas/campeão estão corretos
UPDATE scoring_rules SET points = 18 WHERE key = 'artilheiro';
UPDATE scoring_rules SET points =  4 WHERE key = 'semifinalista';
UPDATE scoring_rules SET points =  8 WHERE key = 'bonus_finalista';
UPDATE scoring_rules SET points =  8 WHERE key = 'bonus_vice';
UPDATE scoring_rules SET points = 12 WHERE key = 'bonus_campeao';
