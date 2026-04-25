-- Eliminação de seleções (para riscado nas apostas G4)
ALTER TABLE teams ADD COLUMN IF NOT EXISTS is_eliminated boolean NOT NULL DEFAULT false;

-- Eliminação de artilheiros (para riscado na coluna Artilheiro)
ALTER TABLE top_scorer_mapping ADD COLUMN IF NOT EXISTS is_eliminated boolean NOT NULL DEFAULT false;

-- Página Classificação MB
INSERT INTO page_visibility (page_name, label, show_for_admin, show_for_users, sort_order)
VALUES ('classificacaoMB', 'Classificação MB', true, false, 45)
ON CONFLICT (page_name) DO NOTHING;

-- Vagas de premiação (padrão 8; altere conforme o regulamento)
INSERT INTO tournament_settings (key, value)
VALUES ('prize_spots', '8')
ON CONFLICT (key) DO NOTHING;
