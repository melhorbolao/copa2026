-- Adiciona coluna status na tabela users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'aprovacao_pendente'
  CHECK (status IN ('email_pendente', 'aprovacao_pendente', 'aprovado'));

-- Sincroniza com dados existentes
UPDATE public.users SET status = 'aprovado' WHERE approved = true;
