-- Restaura label correto da página classificacaoMB
UPDATE page_visibility
SET label = 'Classificação MB', sort_order = 45
WHERE page_name = 'classificacaoMB';

-- Se não existir a linha, cria
INSERT INTO page_visibility (page_name, label, show_for_admin, show_for_users, sort_order)
VALUES ('classificacaoMB', 'Classificação MB', true, false, 45)
ON CONFLICT (page_name) DO NOTHING;
