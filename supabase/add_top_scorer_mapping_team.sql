-- Adiciona coluna de seleção ao mapeamento de artilheiros
-- Executar no SQL Editor do Supabase

ALTER TABLE public.top_scorer_mapping
  ADD COLUMN IF NOT EXISTS team TEXT;
