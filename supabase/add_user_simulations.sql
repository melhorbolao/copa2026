-- Tabela para armazenar simulações individuais por usuário
-- Cada linha representa um placar simulado (score_home × score_away) para um jogo.
-- RLS garante que cada usuário só acessa suas próprias simulações.

CREATE TABLE IF NOT EXISTS user_simulations (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL,
  match_id   UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  score_home SMALLINT,
  score_away SMALLINT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT user_simulations_user_match_unique UNIQUE(user_id, match_id)
);

CREATE INDEX IF NOT EXISTS user_simulations_user_id_idx ON user_simulations(user_id);

ALTER TABLE user_simulations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own simulations"
  ON user_simulations FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
