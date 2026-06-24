-- Controle manual de pontuação por terceiro classificado.
-- Admin pode marcar "pontuar" por grupo antes de todos os jogos terminarem.
-- Quando todos os jogos da fase de grupos terminam, todos são auto-habilitados.

CREATE TABLE IF NOT EXISTS third_place_scoring (
  group_name CHAR(1)     NOT NULL,
  enabled    BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_name)
);

-- Pré-popula os 12 grupos com enabled = false
INSERT INTO third_place_scoring (group_name)
VALUES ('A'),('B'),('C'),('D'),('E'),('F'),('G'),('H'),('I'),('J'),('K'),('L')
ON CONFLICT (group_name) DO NOTHING;

-- RLS: qualquer autenticado pode ler; escrita via service role (server actions)
ALTER TABLE third_place_scoring ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read third_place_scoring"
  ON third_place_scoring FOR SELECT TO authenticated USING (true);
