-- View agregada para o radar de possíveis zebras (aba "Possíveis Zebras").
-- Retorna APENAS contagens anônimas por jogo futuro — sem expor participantes.
-- SECURITY INVOKER: ao ser chamada via service_role, o WHERE deadline > now()
-- ainda se aplica, garantindo que só jogos futuros sejam retornados.
--
-- Opcional: a página /zebras já faz o mesmo cálculo server-side via TypeScript.
-- Criar esta view melhora performance em bolões com muitos participantes.

CREATE OR REPLACE VIEW public.vw_potential_upsets
WITH (security_invoker = on)
AS
SELECT
  m.id                                                                   AS match_id,
  m.team_home,
  m.team_away,
  m.flag_home,
  m.flag_away,
  m.match_datetime,
  m.betting_deadline,
  m.phase,
  m.group_name,
  m.round,
  m.city,
  COUNT(b.id)::int                                                        AS total_bets,
  COUNT(CASE WHEN b.score_home > b.score_away THEN 1 END)::int           AS home_count,
  COUNT(CASE WHEN b.score_home = b.score_away THEN 1 END)::int           AS draw_count,
  COUNT(CASE WHEN b.score_home < b.score_away THEN 1 END)::int           AS away_count
FROM public.matches m
LEFT JOIN public.bets b ON b.match_id = m.id
WHERE m.betting_deadline > now()
  AND m.team_home <> 'TBD'
  AND m.team_away <> 'TBD'
GROUP BY
  m.id, m.team_home, m.team_away, m.flag_home, m.flag_away,
  m.match_datetime, m.betting_deadline, m.phase, m.group_name, m.round, m.city
HAVING COUNT(b.id) > 0;

-- Apenas usuários autenticados podem consultar a view
GRANT SELECT ON public.vw_potential_upsets TO authenticated;
