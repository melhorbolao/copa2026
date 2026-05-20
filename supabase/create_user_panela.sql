-- ================================================================
-- Minha Panela — mini-grupos privados por participante
-- Execute no Supabase SQL Editor
-- ================================================================

CREATE TABLE IF NOT EXISTS public.user_panela (
  owner_participant_id  uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  member_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_participant_id, member_participant_id),
  CHECK (owner_participant_id <> member_participant_id)
);

CREATE INDEX IF NOT EXISTS idx_user_panela_owner
  ON public.user_panela (owner_participant_id);

-- RLS
ALTER TABLE public.user_panela ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access to user_panela" ON public.user_panela;
CREATE POLICY "service_role full access to user_panela"
  ON public.user_panela FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
