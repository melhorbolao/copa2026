-- Políticas de RLS para third_place_bets
-- A tabela foi criada fora das migrations rastreadas e ficou sem políticas,
-- o que impedia usuários autenticados de ler seus próprios palpites.

ALTER TABLE public.third_place_bets ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer autenticado pode ver todos os palpites (paridade com group_bets)
DROP POLICY IF EXISTS "third_place_bets: leitura de todos autenticados" ON public.third_place_bets;
CREATE POLICY "third_place_bets: leitura de todos autenticados"
  ON public.third_place_bets FOR SELECT
  TO authenticated
  USING (true);

-- Escrita irrestrita para o service_role (admin / server actions)
DROP POLICY IF EXISTS "third_place_bets: service_role tudo" ON public.third_place_bets;
CREATE POLICY "third_place_bets: service_role tudo"
  ON public.third_place_bets FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
