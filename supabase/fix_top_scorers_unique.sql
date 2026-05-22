-- Remove duplicatas de top_scorers, mantendo a entrada com mais gols
-- (em empate, mantém a mais antiga).
DELETE FROM public.top_scorers
WHERE id NOT IN (
  SELECT DISTINCT ON (lower(player_name)) id
  FROM public.top_scorers
  ORDER BY lower(player_name), goals_count DESC, created_at ASC
);

-- Índice UNIQUE case-insensitive: bloqueia duplicatas no banco mesmo que o nome
-- venha com capitalização diferente (ex: "neymar jr" vs "Neymar Jr").
CREATE UNIQUE INDEX IF NOT EXISTS top_scorers_player_name_ci_unique
  ON public.top_scorers (lower(player_name));
