-- Artilheiros reais da Copa (crowd-managed com auditoria)
-- Executar no SQL Editor do Supabase

CREATE TABLE IF NOT EXISTS public.top_scorers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT        NOT NULL,
  team        TEXT        NOT NULL DEFAULT '',
  goals_count INTEGER     NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.top_scorers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "top_scorers: leitura autenticada"
  ON public.top_scorers FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "top_scorers: update autenticado"
  ON public.top_scorers FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "top_scorers: insert autenticado"
  ON public.top_scorers FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "top_scorers: delete admin"
  ON public.top_scorers FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true));

-- Realtime: clientes subscrevem a mudanças de gols em tempo real
ALTER PUBLICATION supabase_realtime ADD TABLE public.top_scorers;
