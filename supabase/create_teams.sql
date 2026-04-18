-- Tabela de equipes participantes da Copa 2026
CREATE TABLE IF NOT EXISTS public.teams (
  name       text    PRIMARY KEY,
  abbr_br    text    NOT NULL DEFAULT '',
  abbr_fifa  text    NOT NULL DEFAULT '',
  group_name char(1) NOT NULL
);

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teams: leitura pública" ON public.teams;
CREATE POLICY "teams: leitura pública"
  ON public.teams FOR SELECT USING (true);

DROP POLICY IF EXISTS "teams: service_role tudo" ON public.teams;
CREATE POLICY "teams: service_role tudo"
  ON public.teams FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Seed: 48 seleções da Copa 2026
INSERT INTO public.teams (name, abbr_br, abbr_fifa, group_name) VALUES
  ('África do Sul', 'AFS', 'RSA', 'A'),
  ('Alemanha',      'ALE', 'GER', 'E'),
  ('Arábia Saudita','ARA', 'KSA', 'H'),
  ('Argélia',       'ALG', 'ALG', 'J'),
  ('Argentina',     'ARG', 'ARG', 'J'),
  ('Austrália',     'AUS', 'AUS', 'D'),
  ('Áustria',       'AUT', 'AUT', 'J'),
  ('Bélgica',       'BEL', 'BEL', 'G'),
  ('Bósnia',        'BOS', 'BIH', 'B'),
  ('Brasil',        'BRA', 'BRA', 'C'),
  ('Cabo Verde',    'CAB', 'CPV', 'H'),
  ('Canadá',        'CAN', 'CAN', 'B'),
  ('Catar',         'CAT', 'QAT', 'B'),
  ('Colômbia',      'COL', 'COL', 'K'),
  ('Congo',         'CON', 'COD', 'K'),
  ('Coreia do Sul', 'COR', 'KOR', 'A'),
  ('Costa do Marfim','CDM','CIV', 'E'),
  ('Croácia',       'CRO', 'CRO', 'L'),
  ('Curaçao',       'CUR', 'CUW', 'E'),
  ('Egito',         'EGI', 'EGY', 'G'),
  ('Equador',       'EQU', 'ECU', 'E'),
  ('Escócia',       'ESC', 'SCO', 'C'),
  ('Espanha',       'ESP', 'ESP', 'H'),
  ('Estados Unidos','EUA', 'USA', 'D'),
  ('França',        'FRA', 'FRA', 'I'),
  ('Gana',          'GAN', 'GHA', 'L'),
  ('Haiti',         'HAI', 'HAI', 'C'),
  ('Holanda',       'HOL', 'NED', 'F'),
  ('Inglaterra',    'ING', 'ENG', 'L'),
  ('Irã',           'IRA', 'IRN', 'G'),
  ('Iraque',        'IRQ', 'IRQ', 'I'),
  ('Japão',         'JAP', 'JPN', 'F'),
  ('Jordânia',      'JOR', 'JOR', 'J'),
  ('Marrocos',      'MAR', 'MAR', 'C'),
  ('México',        'MEX', 'MEX', 'A'),
  ('Noruega',       'NOR', 'NOR', 'I'),
  ('Nova Zelândia', 'NZE', 'NZL', 'G'),
  ('Panamá',        'PAN', 'PAN', 'L'),
  ('Paraguai',      'PAR', 'PAR', 'D'),
  ('Portugal',      'POR', 'POR', 'K'),
  ('Senegal',       'SEN', 'SEN', 'I'),
  ('Suécia',        'SUE', 'SWE', 'F'),
  ('Suíça',         'SUI', 'SUI', 'B'),
  ('Tchéquia',      'TCH', 'CZE', 'A'),
  ('Tunísia',       'TUN', 'TUN', 'F'),
  ('Turquia',       'TUR', 'TUR', 'D'),
  ('Uruguai',       'URU', 'URU', 'H'),
  ('Uzbequistão',   'UZB', 'UZB', 'K')
ON CONFLICT (name) DO UPDATE SET
  abbr_br    = EXCLUDED.abbr_br,
  abbr_fifa  = EXCLUDED.abbr_fifa,
  group_name = EXCLUDED.group_name;
