-- Adiciona EP971 à lista de padrinhos permitidos
-- O CHECK constraint inline não tem nome explícito; o Postgres gera automaticamente.
-- Precisamos dropar pelo nome gerado e recriar.

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_padrinho_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_padrinho_check
  CHECK (padrinho IN (
    'Bruninho','Cadu','Daniel','EP971','Guga',
    'Luizinho','Medel','Nando "Sapo"','Teixeira'
  ));
