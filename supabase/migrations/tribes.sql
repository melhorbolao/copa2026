-- Tabela de Tribos
CREATE TABLE IF NOT EXISTS tribes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tabela de Junção: Participante ↔ Tribo (M:N)
CREATE TABLE IF NOT EXISTS participant_tribes (
  tribe_id       uuid NOT NULL REFERENCES tribes(id)       ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  PRIMARY KEY (tribe_id, participant_id)
);

-- RLS
ALTER TABLE tribes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_tribes ENABLE ROW LEVEL SECURITY;

-- Leitura liberada para usuários autenticados (client-side fetch no destaque)
CREATE POLICY "authenticated can read tribes"
  ON tribes FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated can read participant_tribes"
  ON participant_tribes FOR SELECT TO authenticated USING (true);
