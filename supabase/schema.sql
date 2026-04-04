-- ============================================================
-- Bolão Copa do Mundo 2026 — Schema completo
-- Execute no SQL Editor do Supabase
-- ============================================================

-- ── Extensões ────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Enum: fase da partida ────────────────────────────────────
do $$ begin
  create type match_phase as enum (
    'group',
    'round_of_32',
    'round_of_16',
    'quarterfinal',
    'semifinal',
    'third_place',
    'final'
  );
exception
  when duplicate_object then null;
end $$;

-- ============================================================
-- TABELA: users
-- Espelho do auth.users com campos adicionais do bolão.
-- Criada via trigger ao primeiro login OAuth.
-- ============================================================
create table if not exists public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text        not null,
  email       text        not null unique,
  provider    text        not null default 'google',
  approved    boolean     not null default false,
  paid        boolean     not null default false,
  is_admin    boolean     not null default false,
  created_at  timestamptz not null default now()
);

comment on table public.users is
  'Participantes do bolão. Requer aprovação e pagamento para apostas.';

-- ── Trigger: cria registro em public.users após signup OAuth ──
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, name, email, provider)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',  -- Google (maioria dos casos)
      new.raw_user_meta_data->>'name',        -- fallback de outros providers
      split_part(new.email, '@', 1)           -- último recurso: prefixo do e-mail
    ),
    new.email,
    coalesce(new.app_metadata->>'provider', 'google')
  )
  on conflict do nothing;   -- cobre id (PK) E email (UNIQUE) sem lançar exceção
  return new;
exception
  when others then
    -- Nunca deixa o trigger bloquear o fluxo de autenticação.
    -- Se a inserção falhar por qualquer motivo, o callback do Next.js
    -- cria o registro como fallback.
    return new;
end;
$$;

-- Garante que a função roda como superusuário (bypassa RLS)
alter function public.handle_new_user() owner to postgres;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- TABELA: matches
-- Partidas do torneio. Populada pelo admin antes do torneio.
-- ============================================================
create table if not exists public.matches (
  id               uuid        primary key default uuid_generate_v4(),
  match_number     integer     not null unique,
  phase            match_phase not null,
  group_name       char(1)     null,         -- 'A'..'H', null em mata-mata
  round            integer     null,          -- rodada dentro do grupo (1,2,3)
  team_home        text        not null,
  team_away        text        not null,
  flag_home        text        not null,      -- código ISO 3166-1 alpha-2
  flag_away        text        not null,
  match_datetime   timestamptz not null,
  city             text        not null,
  score_home       integer     null,          -- null enquanto não jogada
  score_away       integer     null,
  is_brazil        boolean     not null default false,
  betting_deadline timestamptz not null,      -- geralmente match_datetime - 5min

  constraint group_name_required_in_group check (
    (phase = 'group' and group_name is not null) or
    (phase <> 'group')
  )
);

comment on table public.matches is
  'Partidas oficiais da Copa 2026. Scores preenchidos pelo admin após cada jogo.';
comment on column public.matches.flag_home  is 'Código ISO-3166 alpha-2, ex: BR, AR, FR';
comment on column public.matches.flag_away  is 'Código ISO-3166 alpha-2';
comment on column public.matches.betting_deadline is
  'Após este instante apostas ficam bloqueadas para esta partida.';

-- ============================================================
-- TABELA: bets
-- Apostas de placar por usuário/partida.
-- ============================================================
create table if not exists public.bets (
  id          uuid        primary key default uuid_generate_v4(),
  user_id     uuid        not null references public.users(id) on delete cascade,
  match_id    uuid        not null references public.matches(id) on delete cascade,
  score_home  integer     not null check (score_home >= 0),
  score_away  integer     not null check (score_away >= 0),
  points      integer     null,        -- calculado pelo admin após o jogo
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (user_id, match_id)
);

comment on table public.bets is
  'Uma aposta de placar por (usuário, partida). Bloqueada após betting_deadline.';

-- ── Trigger: atualiza updated_at automaticamente ──────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bets_set_updated_at on public.bets;
create trigger bets_set_updated_at
  before update on public.bets
  for each row execute procedure public.set_updated_at();

-- ============================================================
-- TABELA: group_bets
-- Aposta de classificação de grupo (1º e 2º lugar).
-- ============================================================
create table if not exists public.group_bets (
  id           uuid    primary key default uuid_generate_v4(),
  user_id      uuid    not null references public.users(id) on delete cascade,
  group_name   char(1) not null,
  first_place  text    not null,
  second_place text    not null,
  points       integer null,

  unique (user_id, group_name),
  constraint different_teams check (first_place <> second_place)
);

comment on table public.group_bets is
  'Aposta do 1º e 2º colocado de cada grupo, por usuário.';

-- ============================================================
-- TABELA: tournament_bets
-- Apostas globais do torneio (campeão, artilheiro etc.).
-- ============================================================
create table if not exists public.tournament_bets (
  id         uuid    primary key default uuid_generate_v4(),
  user_id    uuid    not null references public.users(id) on delete cascade unique,
  champion   text    not null,
  runner_up  text    not null,
  semi1      text    not null,   -- 3º colocado (semi-finalista)
  semi2      text    not null,   -- 4º colocado (semi-finalista)
  top_scorer text    not null,
  points     integer null,

  constraint champion_ne_runner_up check (champion <> runner_up)
);

comment on table public.tournament_bets is
  'Aposta única por usuário para campeão, vice, semifinalistas e artilheiro.';

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.users          enable row level security;
alter table public.matches        enable row level security;
alter table public.bets           enable row level security;
alter table public.group_bets     enable row level security;
alter table public.tournament_bets enable row level security;

-- ── Helper: verifica se o usuário autenticado é admin ─────────
create or replace function public.is_admin()
returns boolean
language sql
security definer stable
as $$
  select coalesce(
    (select is_admin from public.users where id = auth.uid()),
    false
  );
$$;

-- ── Helper: verifica se usuário está aprovado e pagou ─────────
create or replace function public.is_active_participant()
returns boolean
language sql
security definer stable
as $$
  select coalesce(
    (select approved and paid from public.users where id = auth.uid()),
    false
  );
$$;

-- ────────────────────────────────────────────────────────────
-- POLÍTICAS: users
-- ────────────────────────────────────────────────────────────
drop policy if exists "users: leitura pública autenticada"   on public.users;
drop policy if exists "users: inserção pelo trigger"          on public.users;
drop policy if exists "users: atualização do próprio perfil" on public.users;
drop policy if exists "users: admin atualiza qualquer"       on public.users;

-- Qualquer usuário autenticado vê todos os participantes (para ranking)
create policy "users: leitura pública autenticada"
  on public.users for select
  to authenticated
  using (true);

-- O próprio usuário insere seu registro (via trigger service-role, mas
-- também permitimos INSERT direto para fallback)
create policy "users: inserção pelo trigger"
  on public.users for insert
  to authenticated
  with check (id = auth.uid());

-- Usuário atualiza apenas o próprio perfil (ex.: nome)
create policy "users: atualização do próprio perfil"
  on public.users for update
  to authenticated
  using  (id = auth.uid())
  with check (id = auth.uid());

-- Admin pode atualizar qualquer usuário (approved, paid, is_admin)
create policy "users: admin atualiza qualquer"
  on public.users for update
  to authenticated
  using  (public.is_admin())
  with check (public.is_admin());

-- ────────────────────────────────────────────────────────────
-- POLÍTICAS: matches
-- ────────────────────────────────────────────────────────────
drop policy if exists "matches: leitura pública autenticada" on public.matches;
drop policy if exists "matches: admin insere"                on public.matches;
drop policy if exists "matches: admin atualiza"              on public.matches;
drop policy if exists "matches: admin deleta"                on public.matches;

create policy "matches: leitura pública autenticada"
  on public.matches for select
  to authenticated
  using (true);

create policy "matches: admin insere"
  on public.matches for insert
  to authenticated
  with check (public.is_admin());

create policy "matches: admin atualiza"
  on public.matches for update
  to authenticated
  using  (public.is_admin())
  with check (public.is_admin());

create policy "matches: admin deleta"
  on public.matches for delete
  to authenticated
  using (public.is_admin());

-- ────────────────────────────────────────────────────────────
-- POLÍTICAS: bets
-- ────────────────────────────────────────────────────────────
drop policy if exists "bets: leitura de todos autenticados"          on public.bets;
drop policy if exists "bets: participante insere antes do prazo"     on public.bets;
drop policy if exists "bets: participante atualiza antes do prazo"   on public.bets;
drop policy if exists "bets: participante deleta antes do prazo"     on public.bets;
drop policy if exists "bets: admin atualiza pontos"                  on public.bets;

-- Todos veem todas as apostas após o prazo (ranking/comparação)
create policy "bets: leitura de todos autenticados"
  on public.bets for select
  to authenticated
  using (true);

-- Participante ativo insere sua aposta antes do deadline
create policy "bets: participante insere antes do prazo"
  on public.bets for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_active_participant()
    and exists (
      select 1 from public.matches m
      where m.id = match_id
        and m.betting_deadline > now()
    )
  );

-- Participante ativo altera sua aposta antes do deadline
create policy "bets: participante atualiza antes do prazo"
  on public.bets for update
  to authenticated
  using (
    user_id = auth.uid()
    and public.is_active_participant()
    and exists (
      select 1 from public.matches m
      where m.id = match_id
        and m.betting_deadline > now()
    )
  )
  with check (
    user_id = auth.uid()
  );

-- Participante deleta sua aposta antes do deadline
create policy "bets: participante deleta antes do prazo"
  on public.bets for delete
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.matches m
      where m.id = match_id
        and m.betting_deadline > now()
    )
  );

-- Admin atualiza pontos após o jogo
create policy "bets: admin atualiza pontos"
  on public.bets for update
  to authenticated
  using  (public.is_admin())
  with check (public.is_admin());

-- ────────────────────────────────────────────────────────────
-- POLÍTICAS: group_bets
-- ────────────────────────────────────────────────────────────
drop policy if exists "group_bets: leitura de todos autenticados"        on public.group_bets;
drop policy if exists "group_bets: participante insere"                  on public.group_bets;
drop policy if exists "group_bets: participante atualiza"                on public.group_bets;
drop policy if exists "group_bets: admin atualiza pontos"                on public.group_bets;

create policy "group_bets: leitura de todos autenticados"
  on public.group_bets for select
  to authenticated
  using (true);

create policy "group_bets: participante insere"
  on public.group_bets for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_active_participant()
  );

create policy "group_bets: participante atualiza"
  on public.group_bets for update
  to authenticated
  using  (user_id = auth.uid() and public.is_active_participant())
  with check (user_id = auth.uid());

create policy "group_bets: admin atualiza pontos"
  on public.group_bets for update
  to authenticated
  using  (public.is_admin())
  with check (public.is_admin());

-- ────────────────────────────────────────────────────────────
-- POLÍTICAS: tournament_bets
-- ────────────────────────────────────────────────────────────
drop policy if exists "tournament_bets: leitura de todos autenticados"  on public.tournament_bets;
drop policy if exists "tournament_bets: participante insere"            on public.tournament_bets;
drop policy if exists "tournament_bets: participante atualiza"          on public.tournament_bets;
drop policy if exists "tournament_bets: admin atualiza pontos"          on public.tournament_bets;

create policy "tournament_bets: leitura de todos autenticados"
  on public.tournament_bets for select
  to authenticated
  using (true);

create policy "tournament_bets: participante insere"
  on public.tournament_bets for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_active_participant()
  );

create policy "tournament_bets: participante atualiza"
  on public.tournament_bets for update
  to authenticated
  using  (user_id = auth.uid() and public.is_active_participant())
  with check (user_id = auth.uid());

create policy "tournament_bets: admin atualiza pontos"
  on public.tournament_bets for update
  to authenticated
  using  (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- ÍNDICES de performance
-- ============================================================
create index if not exists idx_matches_phase          on public.matches (phase);
create index if not exists idx_matches_datetime       on public.matches (match_datetime);
create index if not exists idx_matches_is_brazil      on public.matches (is_brazil);
create index if not exists idx_bets_user_id           on public.bets (user_id);
create index if not exists idx_bets_match_id          on public.bets (match_id);
create index if not exists idx_bets_user_match        on public.bets (user_id, match_id);
create index if not exists idx_group_bets_user_id     on public.group_bets (user_id);
create index if not exists idx_group_bets_group_name  on public.group_bets (group_name);

-- ============================================================
-- FIM DO SCHEMA
-- ============================================================
