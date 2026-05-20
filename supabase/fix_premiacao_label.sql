-- Garante que classificacaoMB existe na tabela com o label correto
INSERT INTO page_visibility (page_name, label, show_for_admin, show_for_users, sort_order)
VALUES ('classificacaoMB', 'Premiação MB', true, false, 55)
ON CONFLICT (page_name) DO UPDATE
  SET label = 'Premiação MB',
      sort_order = 55;
