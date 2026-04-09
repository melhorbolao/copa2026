-- ================================================================
-- MIGRAÇÃO: Separação User (Auth) ↔ Participant (Jogo)
-- Execute no Supabase SQL Editor, em ordem, verificando cada bloco
-- ================================================================

-- ── BLOCO 1: Criar tabela participants ────────────────────────
CREATE TABLE IF NOT EXISTS participants (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  apelido     TEXT        NOT NULL,
  bio         TEXT,
  paid        BOOLEAN     NOT NULL DEFAULT false,
  padrinho    TEXT,
  observacao  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── BLOCO 2: Criar tabela de junção user_participants ─────────
CREATE TABLE IF NOT EXISTS user_participants (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  participant_id UUID        NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  is_primary     BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, participant_id)
);

-- Garante que cada participante tem exatamente um usuário primário
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_per_participant
  ON user_participants(participant_id)
  WHERE is_primary = true;

-- ── BLOCO 3: Migrar usuários aprovados → participants ─────────
-- Cada usuário aprovado vira 1 participante (is_primary=true)
DO $$
DECLARE
  u RECORD;
  new_p_id UUID;
BEGIN
  FOR u IN
    SELECT id, name, apelido, paid, padrinho, observacao, created_at
    FROM users
    WHERE status = 'aprovado'
      AND id NOT IN (SELECT user_id FROM user_participants)
  LOOP
    INSERT INTO participants (apelido, bio, paid, padrinho, observacao, created_at)
    VALUES (
      COALESCE(NULLIF(TRIM(u.apelido), ''), u.name),
      NULL,
      COALESCE(u.paid, false),
      u.padrinho,
      u.observacao,
      u.created_at
    )
    RETURNING id INTO new_p_id;

    INSERT INTO user_participants (user_id, participant_id, is_primary)
    VALUES (u.id, new_p_id, true);
  END LOOP;
END $$;

-- Verificação: SELECT COUNT(*) FROM participants; deve ser = aprovados
-- SELECT COUNT(*) FROM user_participants WHERE is_primary = true; deve ser igual

-- ── BLOCO 4: Adicionar participant_id às tabelas de apostas ───
ALTER TABLE bets             ADD COLUMN IF NOT EXISTS participant_id UUID REFERENCES participants(id) ON DELETE CASCADE;
ALTER TABLE group_bets       ADD COLUMN IF NOT EXISTS participant_id UUID REFERENCES participants(id) ON DELETE CASCADE;
ALTER TABLE tournament_bets  ADD COLUMN IF NOT EXISTS participant_id UUID REFERENCES participants(id) ON DELETE CASCADE;
ALTER TABLE third_place_bets ADD COLUMN IF NOT EXISTS participant_id UUID REFERENCES participants(id) ON DELETE CASCADE;

-- ── BLOCO 5: Preencher participant_id a partir de user_id ──────
UPDATE bets b
SET participant_id = up.participant_id
FROM user_participants up
WHERE b.user_id = up.user_id AND up.is_primary = true
  AND b.participant_id IS NULL;

UPDATE group_bets gb
SET participant_id = up.participant_id
FROM user_participants up
WHERE gb.user_id = up.user_id AND up.is_primary = true
  AND gb.participant_id IS NULL;

UPDATE tournament_bets tb
SET participant_id = up.participant_id
FROM user_participants up
WHERE tb.user_id = up.user_id AND up.is_primary = true
  AND tb.participant_id IS NULL;

UPDATE third_place_bets tpb
SET participant_id = up.participant_id
FROM user_participants up
WHERE tpb.user_id = up.user_id AND up.is_primary = true
  AND tpb.participant_id IS NULL;

-- Verificação: os 4 SELECTs abaixo devem retornar 0
-- SELECT COUNT(*) FROM bets             WHERE participant_id IS NULL;
-- SELECT COUNT(*) FROM group_bets       WHERE participant_id IS NULL;
-- SELECT COUNT(*) FROM tournament_bets  WHERE participant_id IS NULL;
-- SELECT COUNT(*) FROM third_place_bets WHERE participant_id IS NULL;

-- ── BLOCO 6: Tornar participant_id NOT NULL ────────────────────
ALTER TABLE bets             ALTER COLUMN participant_id SET NOT NULL;
ALTER TABLE group_bets       ALTER COLUMN participant_id SET NOT NULL;
ALTER TABLE tournament_bets  ALTER COLUMN participant_id SET NOT NULL;
ALTER TABLE third_place_bets ALTER COLUMN participant_id SET NOT NULL;

-- ── BLOCO 7: Recriar constraints únicas por participant_id ─────
-- Remova os nomes antigos se existirem (ajuste o nome conforme seu schema)
ALTER TABLE bets             DROP CONSTRAINT IF EXISTS bets_user_id_match_id_key;
ALTER TABLE group_bets       DROP CONSTRAINT IF EXISTS group_bets_user_id_group_name_key;
ALTER TABLE tournament_bets  DROP CONSTRAINT IF EXISTS tournament_bets_user_id_key;
ALTER TABLE third_place_bets DROP CONSTRAINT IF EXISTS third_place_bets_user_id_group_name_key;

ALTER TABLE bets             ADD CONSTRAINT bets_participant_match_uniq       UNIQUE (participant_id, match_id);
ALTER TABLE group_bets       ADD CONSTRAINT group_bets_participant_group_uniq UNIQUE (participant_id, group_name);
ALTER TABLE tournament_bets  ADD CONSTRAINT tournament_bets_participant_uniq  UNIQUE (participant_id);
ALTER TABLE third_place_bets ADD CONSTRAINT third_place_participant_group_uniq UNIQUE (participant_id, group_name);

-- ── BLOCO 8: Remover user_id das tabelas de apostas ───────────
-- (só execute após confirmar que tudo está OK)
ALTER TABLE bets             DROP COLUMN IF EXISTS user_id;
ALTER TABLE group_bets       DROP COLUMN IF EXISTS user_id;
ALTER TABLE tournament_bets  DROP COLUMN IF EXISTS user_id;
ALTER TABLE third_place_bets DROP COLUMN IF EXISTS user_id;

-- ── BLOCO 9: RLS policies para participants e user_participants ─
ALTER TABLE participants    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_participants ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário autenticado pode ler participantes (para ranking)
CREATE POLICY "participants_select_authenticated"
  ON participants FOR SELECT
  TO authenticated
  USING (true);

-- Usuário só pode ler seus próprios vínculos
CREATE POLICY "user_participants_select_own"
  ON user_participants FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Service role tem acesso total (para actions de admin)
CREATE POLICY "participants_service_all"
  ON participants FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "user_participants_service_all"
  ON user_participants FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
