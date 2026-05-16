-- Adiciona subject e body à email_settings para templates editáveis de alertas
alter table public.email_settings add column if not exists subject text;
alter table public.email_settings add column if not exists body    text;

-- Insere as 3 chaves de alerta com defaults (sem sobrescrever se já existirem)
insert into public.email_settings (key, label, description) values
  ('alert_all',        'Aviso do prazo a todos',         'Enviado a todos os participantes com Excel em anexo.'),
  ('alert_incomplete', 'Aviso de palpites incompletos',  'Enviado somente a quem não tem campeão preenchido.'),
  ('alert_receipt',    'Comprovante de palpites',         'Enviado a todos após o encerramento do prazo.')
on conflict (key) do nothing;
