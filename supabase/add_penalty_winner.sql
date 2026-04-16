-- Adiciona coluna penalty_winner à tabela matches
-- Registra o time vencedor nos pênaltis em jogos eliminatórios empatados.
-- Qualquer valor NULL significa que não houve pênaltis (ou ainda não registrado).

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS penalty_winner TEXT DEFAULT NULL;

COMMENT ON COLUMN public.matches.penalty_winner IS
  'Nome do time vencedor nos pênaltis (apenas jogos eliminatórios terminados em empate)';
