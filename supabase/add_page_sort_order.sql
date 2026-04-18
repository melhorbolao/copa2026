-- Adiciona coluna de ordenação à tabela page_visibility
ALTER TABLE page_visibility ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

-- Inicializa com a ordem padrão atual
UPDATE page_visibility SET sort_order = CASE page_name
  WHEN 'palpites'      THEN 1
  WHEN 'tabela'        THEN 2
  WHEN 'acopa'         THEN 3
  WHEN 'classificacao' THEN 4
  WHEN 'participantes' THEN 5
  WHEN 'pontuacao'     THEN 6
  WHEN 'regulamento'   THEN 7
  ELSE 99
END;
