-- Adiciona coluna de foto aos artilheiros
-- Executar no SQL Editor do Supabase

ALTER TABLE public.top_scorers
  ADD COLUMN IF NOT EXISTS photo_url TEXT;
