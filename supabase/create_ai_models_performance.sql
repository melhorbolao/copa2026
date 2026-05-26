-- Tabela para armazenar os palpites e metadados das IAs (benchmarking)
CREATE TABLE IF NOT EXISTS ai_models_performance (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  model_name   text        NOT NULL UNIQUE,
  model_version text,
  sort_order   int         NOT NULL DEFAULT 0,
  palpites     jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_models_performance ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário autenticado pode ler
CREATE POLICY "authenticated read ai_models"
  ON ai_models_performance FOR SELECT
  TO authenticated
  USING (true);

-- Apenas service_role pode escrever (via import admin)
CREATE POLICY "service role write ai_models"
  ON ai_models_performance FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
