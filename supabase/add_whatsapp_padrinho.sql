-- Novos campos na tabela users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS whatsapp   TEXT,
  ADD COLUMN IF NOT EXISTS padrinho   TEXT CHECK (padrinho IN ('Bruninho','Cadu','Daniel','Guga','Luizinho','Medel','Nando "Sapo"','Teixeira')),
  ADD COLUMN IF NOT EXISTS observacao TEXT,
  ADD COLUMN IF NOT EXISTS is_manual  BOOLEAN NOT NULL DEFAULT FALSE;

-- Migra phone → whatsapp para usuários existentes
UPDATE public.users SET whatsapp = phone WHERE whatsapp IS NULL AND phone IS NOT NULL;

-- Necessário para cadastro manual (participantes sem conta de login).
-- Remove a FK que exige correspondência com auth.users:
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_fkey;
