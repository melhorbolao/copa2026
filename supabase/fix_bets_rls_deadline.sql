-- Corrige políticas SELECT das tabelas de apostas para bloquear leitura de
-- palpites alheios antes do prazo (betting_deadline).
--
-- Usa participant_id → user_participants para verificar "palpite próprio",
-- evitando dependência de user_id que pode não existir em todos os ambientes.
--
-- Regra: o usuário sempre lê os próprios palpites; palpites dos outros
-- só são visíveis depois que o prazo da partida (ou do bônus) passou.

-- ── bets ──────────────────────────────────────────────────────────────────────
drop policy if exists "bets: leitura de todos autenticados"    on public.bets;
drop policy if exists "bets: leitura após prazo ou próprios"   on public.bets;

create policy "bets: leitura após prazo ou próprios"
  on public.bets for select
  to authenticated
  using (
    -- próprio palpite: participante vinculado ao usuário logado
    exists (
      select 1 from public.user_participants up
      where up.user_id        = auth.uid()
        and up.participant_id = bets.participant_id
    )
    -- palpite alheio: só visível após prazo da partida
    or exists (
      select 1 from public.matches m
      where m.id              = bets.match_id
        and m.betting_deadline <= now()
    )
  );

-- ── group_bets ────────────────────────────────────────────────────────────────
drop policy if exists "group_bets: leitura de todos autenticados"    on public.group_bets;
drop policy if exists "group_bets: leitura após prazo ou próprios"   on public.group_bets;

create policy "group_bets: leitura após prazo ou próprios"
  on public.group_bets for select
  to authenticated
  using (
    exists (
      select 1 from public.user_participants up
      where up.user_id        = auth.uid()
        and up.participant_id = group_bets.participant_id
    )
    or exists (
      select 1 from public.matches m
      where m.phase = 'group' and m.round = 1
        and m.betting_deadline <= now()
      limit 1
    )
  );

-- ── tournament_bets ───────────────────────────────────────────────────────────
drop policy if exists "tournament_bets: leitura de todos autenticados"    on public.tournament_bets;
drop policy if exists "tournament_bets: leitura após prazo ou próprios"   on public.tournament_bets;

create policy "tournament_bets: leitura após prazo ou próprios"
  on public.tournament_bets for select
  to authenticated
  using (
    exists (
      select 1 from public.user_participants up
      where up.user_id        = auth.uid()
        and up.participant_id = tournament_bets.participant_id
    )
    or exists (
      select 1 from public.matches m
      where m.phase = 'group' and m.round = 1
        and m.betting_deadline <= now()
      limit 1
    )
  );

-- ── third_place_bets ──────────────────────────────────────────────────────────
drop policy if exists "third_place_bets: leitura de todos autenticados"    on public.third_place_bets;
drop policy if exists "third_place_bets: leitura após prazo ou próprios"   on public.third_place_bets;

create policy "third_place_bets: leitura após prazo ou próprios"
  on public.third_place_bets for select
  to authenticated
  using (
    exists (
      select 1 from public.user_participants up
      where up.user_id        = auth.uid()
        and up.participant_id = third_place_bets.participant_id
    )
    or exists (
      select 1 from public.matches m
      where m.phase = 'group' and m.round = 1
        and m.betting_deadline <= now()
      limit 1
    )
  );
