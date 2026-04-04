-- ============================================================
-- Motor de e-mails automáticos — tabela de auditoria
-- Execute no SQL Editor do Supabase
-- ============================================================

create table if not exists public.email_logs (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        references public.users(id) on delete set null,
  email       text        not null,
  job_type    text        not null,   -- 'alert_24h' | 'alert_6h' | 'receipt'
  etapa_key   text        not null,   -- 'group_r1' | 'round_of_32' | ...
  message_id  text,                   -- ID retornado pelo Resend
  status      text        not null default 'sent',  -- 'sent' | 'error'
  error_msg   text,
  sent_at     timestamptz not null default now()
);

-- Índice de deduplicação: garante que cada job+etapa seja enviado 1× por usuário
create unique index if not exists email_logs_dedup
  on public.email_logs (user_id, job_type, etapa_key)
  where status = 'sent';

-- Índice para consultas por data
create index if not exists email_logs_sent_at on public.email_logs (sent_at desc);

-- RLS — apenas service role pode ler/escrever
alter table public.email_logs enable row level security;

-- Nenhuma política pública: acesso apenas via service_role (cron jobs)
