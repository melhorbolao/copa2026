-- Adiciona configuração de ativação dos pontos de artilharia no ranking geral.
-- Padrão: false (pontos não são contabilizados até o admin ativar na página Artilharia).

insert into public.tournament_settings (key, value)
values ('artillary_points_active', 'false')
on conflict (key) do nothing;
