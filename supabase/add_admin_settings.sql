-- Tabela genérica de configurações do admin (chave-valor em texto)
create table if not exists public.admin_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz default now()
);

alter table public.admin_settings enable row level security;

create policy "admin_settings: admin lê"
  on public.admin_settings for select
  to authenticated using (public.is_admin());

create policy "admin_settings: admin atualiza"
  on public.admin_settings for update
  to authenticated
  using  (public.is_admin())
  with check (public.is_admin());

create policy "admin_settings: admin insere"
  on public.admin_settings for insert
  to authenticated
  with check (public.is_admin());

-- Migra nota salva manualmente (se houver) — pode ser ignorado em produção
-- insert into public.admin_settings (key, value) values ('pagantes_note', '') on conflict do nothing;
