-- Gestão de visibilidade de páginas
-- Execute no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS page_visibility (
  id             uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  page_name      text    UNIQUE NOT NULL,
  label          text    NOT NULL,
  show_for_admin boolean NOT NULL DEFAULT true,
  show_for_users boolean NOT NULL DEFAULT false
);

ALTER TABLE page_visibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "page_visibility_select" ON page_visibility;
CREATE POLICY "page_visibility_select"
  ON page_visibility FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "page_visibility_service" ON page_visibility;
CREATE POLICY "page_visibility_service"
  ON page_visibility FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO page_visibility (page_name, label, show_for_admin, show_for_users) VALUES
  ('palpites',      'Meus Palpites', true, true),
  ('tabela',        'Minha Tabela',  true, true),
  ('acopa',         'A Copa',        true, false),
  ('classificacao', 'Ranking',       true, false),
  ('participantes', 'Participantes', true, true),
  ('pontuacao',     'Pontuação',     true, true),
  ('regulamento',   'Regulamento',   true, true)
ON CONFLICT (page_name) DO NOTHING;
