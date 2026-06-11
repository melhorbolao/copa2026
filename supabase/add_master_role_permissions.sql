-- =============================================================================
-- MIGRAÇÃO: Perfil Master + Controle Granular de Permissões para Admins
-- Aplicar no Supabase SQL Editor
-- =============================================================================

-- 1. Nova coluna role na tabela users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'admin', 'master'));

-- 2. Migra dados existentes: is_admin=true → role='admin'
UPDATE public.users
SET role = 'admin'
WHERE is_admin = true
  AND email != 'gmousinho@gmail.com';

-- 3. Define o usuário master vitalício
UPDATE public.users
SET role = 'master', is_admin = true
WHERE email = 'gmousinho@gmail.com';

-- 4. Trigger de proteção do papel master no banco de dados
CREATE OR REPLACE FUNCTION public.protect_master_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.role = 'master' AND NEW.role != 'master' THEN
    RAISE EXCEPTION 'O papel master não pode ser removido';
  END IF;
  IF NEW.role = 'master' AND NEW.email != 'gmousinho@gmail.com' THEN
    RAISE EXCEPTION 'Apenas gmousinho@gmail.com pode receber o papel master';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_master_role ON public.users;
CREATE TRIGGER enforce_master_role
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_master_role();

-- 5. Atualiza is_admin() para incluir o papel master
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER STABLE
AS $$
  SELECT coalesce(
    (SELECT role IN ('admin', 'master') FROM public.users WHERE id = auth.uid()),
    false
  );
$$;

-- 6. Cria is_master() ANTES das políticas RLS que a referenciam
CREATE OR REPLACE FUNCTION public.is_master()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER STABLE
AS $$
  SELECT coalesce(
    (SELECT role = 'master' FROM public.users WHERE id = auth.uid()),
    false
  );
$$;

-- 7. Tabela de permissões por Admin (criada depois das funções)
CREATE TABLE IF NOT EXISTS public.admin_permissions (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  allowed_pages text[]      NOT NULL DEFAULT '{}',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "master_full_access_permissions" ON public.admin_permissions;
DROP POLICY IF EXISTS "admin_read_own_permissions"     ON public.admin_permissions;

CREATE POLICY "master_full_access_permissions" ON public.admin_permissions
  FOR ALL USING (public.is_master());

CREATE POLICY "admin_read_own_permissions" ON public.admin_permissions
  FOR SELECT USING (user_id = auth.uid());
