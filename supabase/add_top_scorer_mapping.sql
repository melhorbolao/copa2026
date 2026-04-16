-- Mapeamento De-Para de nomes de artilheiros
create table if not exists public.top_scorer_mapping (
  raw_name          text primary key,
  standardized_name text not null
);

alter table public.top_scorer_mapping enable row level security;

create policy "top_scorer_mapping: leitura autenticada"
  on public.top_scorer_mapping for select
  using (auth.uid() is not null);

create policy "top_scorer_mapping: admin gerencia"
  on public.top_scorer_mapping for all
  using (exists (select 1 from public.users where id = auth.uid() and is_admin = true));

-- Configurações gerais do torneio (ex: artilheiro oficial)
create table if not exists public.tournament_settings (
  key   text primary key,
  value text not null
);

alter table public.tournament_settings enable row level security;

create policy "tournament_settings: leitura autenticada"
  on public.tournament_settings for select
  using (auth.uid() is not null);

create policy "tournament_settings: admin gerencia"
  on public.tournament_settings for all
  using (exists (select 1 from public.users where id = auth.uid() and is_admin = true));
