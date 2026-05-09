-- ================================================================
-- Remove a página 'tabela' do controle de visibilidade.
-- Agora 'Minha Tabela' é uma aba dentro de 'palpites' e o acesso
-- é governado pela visibilidade de 'palpites'.
-- Execute uma vez no SQL Editor.
-- ================================================================
DELETE FROM public.page_visibility WHERE page_name = 'tabela';
