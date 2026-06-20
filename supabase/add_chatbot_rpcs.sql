-- RPCs seguras para o Assistente MB (Chatbot)
-- SECURITY DEFINER + retorno de JSON agregado:
-- a IA nunca recebe registros individuais de usuários.

-- Ranking consolidado: posição, apelido e pontos totais
CREATE OR REPLACE FUNCTION public.fn_chatbot_top_ranking(p_limit int DEFAULT 5)
RETURNS json
LANGUAGE sql
SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT COALESCE(json_agg(r ORDER BY r.posicao), '[]'::json)
  FROM (
    SELECT
      ROW_NUMBER() OVER (ORDER BY ps.pts_total DESC) AS posicao,
      p.apelido,
      ps.pts_total AS pontos
    FROM public.participant_scores ps
    JOIN public.participants p ON p.id = ps.participant_id
    ORDER BY ps.pts_total DESC
    LIMIT LEAST(p_limit, 10)
  ) r
$$;

GRANT EXECUTE ON FUNCTION public.fn_chatbot_top_ranking(int) TO authenticated;

-- Resumo de palpites por jogo: apenas contagens e distribuições agregadas
-- Nunca expõe palpites individuais
CREATE OR REPLACE FUNCTION public.fn_chatbot_bets_summary(p_match_id uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT json_build_object(
    'total_palpites', (SELECT COUNT(*) FROM public.bets WHERE match_id = p_match_id),
    'placar_mais_votado', (
      SELECT json_build_object('casa', score_home, 'fora', score_away, 'votos', COUNT(*))
      FROM public.bets
      WHERE match_id = p_match_id
      GROUP BY score_home, score_away
      ORDER BY COUNT(*) DESC
      LIMIT 1
    ),
    'top_5_placares', (
      SELECT COALESCE(json_agg(d ORDER BY d.votos DESC), '[]'::json)
      FROM (
        SELECT score_home AS casa, score_away AS fora, COUNT(*) AS votos
        FROM public.bets
        WHERE match_id = p_match_id
        GROUP BY score_home, score_away
        ORDER BY COUNT(*) DESC
        LIMIT 5
      ) d
    )
  )
$$;

GRANT EXECUTE ON FUNCTION public.fn_chatbot_bets_summary(uuid) TO authenticated;
