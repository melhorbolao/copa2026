-- Tabela de avisos exibidos como banner para usuários logados
create table if not exists public.admin_alerts (
  id         uuid        primary key default gen_random_uuid(),
  message    text        not null,
  start_at   timestamptz not null,
  end_at     timestamptz null,
  is_active  boolean     not null default true,
  created_at timestamptz not null default now()
);

alter table public.admin_alerts enable row level security;

drop policy if exists "admin_alerts: leitura autenticada"  on public.admin_alerts;
drop policy if exists "admin_alerts: admin insere"         on public.admin_alerts;
drop policy if exists "admin_alerts: admin atualiza"       on public.admin_alerts;
drop policy if exists "admin_alerts: admin exclui"         on public.admin_alerts;
drop policy if exists "admin_alerts: service role total"   on public.admin_alerts;

-- Qualquer usuário autenticado pode ler avisos (para exibir o banner)
create policy "admin_alerts: leitura autenticada"
  on public.admin_alerts for select
  to authenticated
  using (true);

-- Apenas admin insere, atualiza e exclui
create policy "admin_alerts: admin insere"
  on public.admin_alerts for insert
  to authenticated
  with check (public.is_admin());

create policy "admin_alerts: admin atualiza"
  on public.admin_alerts for update
  to authenticated
  using  (public.is_admin())
  with check (public.is_admin());

create policy "admin_alerts: admin exclui"
  on public.admin_alerts for delete
  to authenticated
  using (public.is_admin());

-- Service role tem acesso total (para server actions)
create policy "admin_alerts: service role total"
  on public.admin_alerts for all
  to service_role
  using (true) with check (true);
