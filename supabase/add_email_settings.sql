-- Tabela de configurações dos e-mails automáticos
create table if not exists public.email_settings (
  key         text primary key,
  enabled     boolean not null default true,
  label       text    not null,
  description text,
  updated_at  timestamptz default now()
);

-- Apenas admins podem ler/escrever
alter table public.email_settings enable row level security;

create policy "email_settings: admin lê"
  on public.email_settings for select
  to authenticated using (public.is_admin());

create policy "email_settings: admin atualiza"
  on public.email_settings for update
  to authenticated
  using  (public.is_admin())
  with check (public.is_admin());

create policy "email_settings: admin insere"
  on public.email_settings for insert
  to authenticated
  with check (public.is_admin());

-- Valores padrão
insert into public.email_settings (key, label, description) values
  ('alert_24h',       'Aviso 24h antes do prazo',       'Enviado a todos (completos e incompletos) 24h antes do prazo de cada etapa, com o Excel de palpites em anexo.'),
  ('alert_6h',        'Aviso 6h antes do prazo',        'Enviado apenas a participantes com palpites incompletos 6h antes do prazo.'),
  ('receipt',         'Comprovante no prazo',            'Enviado a todos ao vencer o prazo, com o Excel dos palpites como comprovante.'),
  ('notify_approved', 'Boas-vindas na aprovação',        'Enviado ao participante quando o admin aprova a sua conta.'),
  ('notify_new_user', 'Notificação de novo cadastro',    'Enviado ao admin quando um novo usuário conclui o cadastro.')
on conflict (key) do nothing;
