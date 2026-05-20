-- ═══════════════════════════════════════════════════════════════════════════
-- BLINDAGEM DE SEGURANÇA E POLÍTICA ANTI-SPOILER DE PALPITES
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Aplicar no Supabase SQL Editor (uma vez por ambiente).
-- Requer permissão de superusuário/postgres.

-- ── 1. Função: timestamp oficial do servidor ─────────────────────────────────
-- Permite que as páginas Next.js usem o relógio do banco ao validar deadlines,
-- eliminando o risco de manipulação do relógio do dispositivo do usuário.

CREATE OR REPLACE FUNCTION public.get_server_now()
  RETURNS timestamptz
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
AS $$
  SELECT now();
$$;

GRANT EXECUTE ON FUNCTION public.get_server_now()
  TO authenticated, anon, service_role;

-- ── 2. View: vw_public_predictions ───────────────────────────────────────────
-- Filtro de deadline em nível de banco de dados. Retorna apenas palpites
-- cujo prazo de aposta já passou OU que pertencem ao usuário autenticado.
--
-- SECURITY INVOKER: a view roda com as permissões de quem a chama.
-- → Usuários autenticados: combinado com as RLS policies da tabela base.
-- → service_role (admin Next.js): WHERE clause é sempre aplicado, então
--   mesmo consultas via service_role só retornam palpites pós-prazo ou
--   do próprio usuário (auth.uid() = null → cláusula "próprio" não casa,
--   mas deadline <= now() ainda filtra corretamente para consultas públicas).
--
-- As páginas de admin que precisam ver todos os palpites (Tabela MB em modo
-- teste, Comparador) continuam usando a tabela base 'bets' via service_role +
-- filtragem server-side em JS (filterBetsByDeadline), que é mais flexível
-- por respeitar também o flag releasedRounds. Esta view é uma camada extra
-- de proteção para o cliente autenticado (não-admin).

CREATE OR REPLACE VIEW public.vw_public_predictions
WITH (security_invoker = on)
AS
SELECT
  b.id,
  b.participant_id,
  b.match_id,
  b.score_home,
  b.score_away,
  b.points,
  b.created_at,
  b.updated_at,
  m.betting_deadline
FROM public.bets b
JOIN public.matches m ON m.id = b.match_id
WHERE
  -- Prazo já passou → palpite é público
  m.betting_deadline <= now()
  -- Prazo ainda aberto → só o próprio usuário vê seu palpite
  OR EXISTS (
    SELECT 1
    FROM public.user_participants up
    WHERE up.user_id        = auth.uid()
      AND up.participant_id = b.participant_id
  );

GRANT SELECT ON public.vw_public_predictions TO authenticated;

-- ── 3. Teste de intrusão (executar manualmente) ──────────────────────────────
-- Conectado como usuário comum (JWT de participante), execute:
--
--   SELECT * FROM vw_public_predictions
--   WHERE match_id = '<uuid_de_partida_com_prazo_aberto>'
--     AND participant_id != '<seu_participant_id>';
--
-- Resultado esperado: 0 linhas.
-- Qualquer resultado diferente indica falha na política.
--
-- Para testar via service_role (admin):
--   SELECT * FROM bets WHERE match_id = '<uuid_futuro>';  -- retorna tudo (por design)
--   SELECT * FROM vw_public_predictions WHERE match_id = '<uuid_futuro>';  -- 0 linhas
