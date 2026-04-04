-- ============================================================
-- Bolão Copa do Mundo 2026 — Seed completo (104 partidas)
-- Grupos baseados no sorteio de 5/dez/2024 em Miami.
-- Horários em UTC — exibição convertida para Brasília pelo app.
-- Execute no SQL Editor do Supabase.
-- ============================================================

-- Limpa seed anterior (caso exista)
DELETE FROM public.bets    WHERE match_id IN (SELECT id FROM public.matches);
DELETE FROM public.matches;

INSERT INTO public.matches
  (match_number, phase, group_name, round,
   team_home,        team_away,
   flag_home,        flag_away,
   match_datetime,            city,
   betting_deadline,          is_brazil)
VALUES

-- ================================================================
-- FASE DE GRUPOS — Rodada 1 (11–15 jun)
-- ================================================================

-- ── Grupo A  (México · África do Sul · Coreia do Sul · Rep. Tcheca)
( 1,'group','A',1,'México',          'África do Sul',  'mx','za', '2026-06-11 20:00+00','Cidade do México', '2026-06-11 19:30+00',false),
( 2,'group','A',1,'Coreia do Sul',   'Rep. Tcheca',    'kr','cz', '2026-06-11 23:00+00','Guadalajara',      '2026-06-11 22:30+00',false),

-- ── Grupo B  (Canadá · Qatar · Suíça · Bósnia-Herzegovina)
( 3,'group','B',1,'Canadá',          'Qatar',          'ca','qa', '2026-06-12 17:00+00','Toronto',          '2026-06-12 16:30+00',false),
( 4,'group','B',1,'Suíça',           'Bósnia-Herz.',   'ch','ba', '2026-06-12 20:00+00','São Francisco',    '2026-06-12 19:30+00',false),

-- ── Grupo C  (Brasil · Marrocos · Haiti · Escócia)
( 5,'group','C',1,'Brasil',          'Marrocos',       'br','ma', '2026-06-13 20:00+00','Nova York',        '2026-06-13 19:30+00',true ),
( 6,'group','C',1,'Haiti',           'Escócia',        'ht','gb-sct','2026-06-13 23:00+00','Boston',         '2026-06-13 22:30+00',false),

-- ── Grupo D  (EUA · Austrália · Paraguai · Turquia)
( 7,'group','D',1,'EUA',             'Paraguai',       'us','py', '2026-06-14 17:00+00','Los Angeles',      '2026-06-14 16:30+00',false),
( 8,'group','D',1,'Austrália',       'Turquia',        'au','tr', '2026-06-14 20:00+00','Seattle',          '2026-06-14 19:30+00',false),

-- ── Grupo E  (Alemanha · Equador · Costa do Marfim · Curaçao)
( 9,'group','E',1,'Alemanha',        'Curaçao',        'de','cw', '2026-06-11 17:00+00','Houston',          '2026-06-11 16:30+00',false),
(10,'group','E',1,'Costa do Marfim', 'Equador',        'ci','ec', '2026-06-12 23:00+00','Atlanta',          '2026-06-12 22:30+00',false),

-- ── Grupo F  (Holanda · Japão · Suécia · Tunísia)
(11,'group','F',1,'Holanda',         'Suécia',         'nl','se', '2026-06-13 17:00+00','Dallas',           '2026-06-13 16:30+00',false),
(12,'group','F',1,'Japão',           'Tunísia',        'jp','tn', '2026-06-14 23:00+00','Guadalajara',      '2026-06-14 22:30+00',false),

-- ── Grupo G  (Irã · Bélgica · Egito · Nova Zelândia)
(13,'group','G',1,'Irã',             'Bélgica',        'ir','be', '2026-06-12 17:00+00','Los Angeles',      '2026-06-12 16:30+00',false),
(14,'group','G',1,'Egito',           'Nova Zelândia',  'eg','nz', '2026-06-13 17:00+00','Seattle',          '2026-06-13 16:30+00',false),

-- ── Grupo H  (Espanha · Uruguai · Arábia Saudita · Cabo Verde)
(15,'group','H',1,'Espanha',         'Arábia Saudita', 'es','sa', '2026-06-14 20:00+00','Miami',            '2026-06-14 19:30+00',false),
(16,'group','H',1,'Uruguai',         'Cabo Verde',     'uy','cv', '2026-06-15 17:00+00','Dallas',           '2026-06-15 16:30+00',false),

-- ── Grupo I  (França · Noruega · Senegal · Iraque)
(17,'group','I',1,'França',          'Senegal',        'fr','sn', '2026-06-15 20:00+00','Nova York',        '2026-06-15 19:30+00',false),
(18,'group','I',1,'Noruega',         'Iraque',         'no','iq', '2026-06-15 23:00+00','Kansas City',      '2026-06-15 22:30+00',false),

-- ── Grupo J  (Argentina · Áustria · Argélia · Jordânia)
(19,'group','J',1,'Argentina',       'Argélia',        'ar','dz', '2026-06-11 23:00+00','Dallas',           '2026-06-11 22:30+00',false),
(20,'group','J',1,'Áustria',         'Jordânia',       'at','jo', '2026-06-12 20:00+00','Kansas City',      '2026-06-12 19:30+00',false),

-- ── Grupo K  (Portugal · Congo RD · Colômbia · Uzbequistão)
(21,'group','K',1,'Portugal',        'Congo RD',       'pt','cd', '2026-06-13 23:00+00','Boston',           '2026-06-13 22:30+00',false),
(22,'group','K',1,'Colômbia',        'Uzbequistão',    'co','uz', '2026-06-14 17:00+00','Cidade do México',  '2026-06-14 16:30+00',false),

-- ── Grupo L  (Inglaterra · Croácia · Gana · Panamá)
(23,'group','L',1,'Inglaterra',      'Panamá',         'gb-eng','pa','2026-06-15 17:00+00','Filadélfia',    '2026-06-15 16:30+00',false),
(24,'group','L',1,'Croácia',         'Gana',           'hr','gh', '2026-06-15 23:00+00','Houston',          '2026-06-15 22:30+00',false),

-- ================================================================
-- FASE DE GRUPOS — Rodada 2 (16–21 jun)
-- ================================================================

-- ── Grupo A
(25,'group','A',2,'México',          'Coreia do Sul',  'mx','kr', '2026-06-17 20:00+00','Guadalajara',      '2026-06-17 19:30+00',false),
(26,'group','A',2,'África do Sul',   'Rep. Tcheca',    'za','cz', '2026-06-17 23:00+00','Monterrey',        '2026-06-17 22:30+00',false),

-- ── Grupo B
(27,'group','B',2,'Canadá',          'Suíça',          'ca','ch', '2026-06-18 17:00+00','Vancouver',        '2026-06-18 16:30+00',false),
(28,'group','B',2,'Qatar',           'Bósnia-Herz.',   'qa','ba', '2026-06-18 20:00+00','Los Angeles',      '2026-06-18 19:30+00',false),

-- ── Grupo C
(29,'group','C',2,'Brasil',          'Haiti',          'br','ht', '2026-06-18 23:00+00','Filadélfia',       '2026-06-18 22:30+00',true ),
(30,'group','C',2,'Marrocos',        'Escócia',        'ma','gb-sct','2026-06-19 20:00+00','Atlanta',        '2026-06-19 19:30+00',false),

-- ── Grupo D
(31,'group','D',2,'EUA',             'Austrália',      'us','au', '2026-06-19 17:00+00','Seattle',          '2026-06-19 16:30+00',false),
(32,'group','D',2,'Paraguai',        'Turquia',        'py','tr', '2026-06-19 23:00+00','Dallas',           '2026-06-19 22:30+00',false),

-- ── Grupo E
(33,'group','E',2,'Alemanha',        'Costa do Marfim','de','ci', '2026-06-16 20:00+00','Houston',          '2026-06-16 19:30+00',false),
(34,'group','E',2,'Equador',         'Curaçao',        'ec','cw', '2026-06-16 23:00+00','Kansas City',      '2026-06-16 22:30+00',false),

-- ── Grupo F
(35,'group','F',2,'Holanda',         'Tunísia',        'nl','tn', '2026-06-17 17:00+00','Miami',            '2026-06-17 16:30+00',false),
(36,'group','F',2,'Japão',           'Suécia',         'jp','se', '2026-06-17 23:00+00','Los Angeles',      '2026-06-17 22:30+00',false),

-- ── Grupo G
(37,'group','G',2,'Irã',             'Egito',          'ir','eg', '2026-06-16 17:00+00','São Francisco',    '2026-06-16 16:30+00',false),
(38,'group','G',2,'Bélgica',         'Nova Zelândia',  'be','nz', '2026-06-16 20:00+00','Vancouver',        '2026-06-16 19:30+00',false),

-- ── Grupo H
(39,'group','H',2,'Espanha',         'Uruguai',        'es','uy', '2026-06-20 20:00+00','Miami',            '2026-06-20 19:30+00',false),
(40,'group','H',2,'Arábia Saudita',  'Cabo Verde',     'sa','cv', '2026-06-20 17:00+00','Atlanta',          '2026-06-20 16:30+00',false),

-- ── Grupo I
(41,'group','I',2,'França',          'Noruega',        'fr','no', '2026-06-21 20:00+00','Nova York',        '2026-06-21 19:30+00',false),
(42,'group','I',2,'Senegal',         'Iraque',         'sn','iq', '2026-06-21 17:00+00','Kansas City',      '2026-06-21 16:30+00',false),

-- ── Grupo J
(43,'group','J',2,'Argentina',       'Áustria',        'ar','at', '2026-06-20 23:00+00','Dallas',           '2026-06-20 22:30+00',false),
(44,'group','J',2,'Argélia',         'Jordânia',       'dz','jo', '2026-06-21 23:00+00','Houston',          '2026-06-21 22:30+00',false),

-- ── Grupo K
(45,'group','K',2,'Portugal',        'Colômbia',       'pt','co', '2026-06-20 20:00+00','Boston',           '2026-06-20 19:30+00',false),
(46,'group','K',2,'Congo RD',        'Uzbequistão',    'cd','uz', '2026-06-21 20:00+00','Filadélfia',       '2026-06-21 19:30+00',false),

-- ── Grupo L
(47,'group','L',2,'Inglaterra',      'Croácia',        'gb-eng','hr','2026-06-20 23:00+00','Nova York',     '2026-06-20 22:30+00',false),
(48,'group','L',2,'Panamá',          'Gana',           'pa','gh', '2026-06-21 23:00+00','Seattle',          '2026-06-21 22:30+00',false),

-- ================================================================
-- FASE DE GRUPOS — Rodada 3 (23–27 jun)
-- Jogos simultâneos dentro de cada grupo (mesmo horário)
-- ================================================================

-- ── Grupo A (23 jun, 20:00 UTC)
(49,'group','A',3,'México',          'Rep. Tcheca',    'mx','cz', '2026-06-23 20:00+00','Cidade do México', '2026-06-23 19:30+00',false),
(50,'group','A',3,'África do Sul',   'Coreia do Sul',  'za','kr', '2026-06-23 20:00+00','Monterrey',        '2026-06-23 19:30+00',false),

-- ── Grupo B (23 jun, 23:00 UTC)
(51,'group','B',3,'Canadá',          'Bósnia-Herz.',   'ca','ba', '2026-06-23 23:00+00','Toronto',          '2026-06-23 22:30+00',false),
(52,'group','B',3,'Qatar',           'Suíça',          'qa','ch', '2026-06-23 23:00+00','Vancouver',        '2026-06-23 22:30+00',false),

-- ── Grupo C (24 jun, 20:00 UTC) ★ Brasil
(53,'group','C',3,'Brasil',          'Escócia',        'br','gb-sct','2026-06-24 20:00+00','Nova York',      '2026-06-24 19:30+00',true ),
(54,'group','C',3,'Marrocos',        'Haiti',          'ma','ht', '2026-06-24 20:00+00','Boston',           '2026-06-24 19:30+00',false),

-- ── Grupo D (24 jun, 23:00 UTC)
(55,'group','D',3,'EUA',             'Turquia',        'us','tr', '2026-06-24 23:00+00','Los Angeles',      '2026-06-24 22:30+00',false),
(56,'group','D',3,'Austrália',       'Paraguai',       'au','py', '2026-06-24 23:00+00','Seattle',          '2026-06-24 22:30+00',false),

-- ── Grupo E (25 jun, 20:00 UTC)
(57,'group','E',3,'Alemanha',        'Equador',        'de','ec', '2026-06-25 20:00+00','Houston',          '2026-06-25 19:30+00',false),
(58,'group','E',3,'Costa do Marfim', 'Curaçao',        'ci','cw', '2026-06-25 20:00+00','Atlanta',          '2026-06-25 19:30+00',false),

-- ── Grupo F (25 jun, 23:00 UTC)
(59,'group','F',3,'Holanda',         'Japão',          'nl','jp', '2026-06-25 23:00+00','Dallas',           '2026-06-25 22:30+00',false),
(60,'group','F',3,'Suécia',          'Tunísia',        'se','tn', '2026-06-25 23:00+00','Miami',            '2026-06-25 22:30+00',false),

-- ── Grupo G (26 jun, 20:00 UTC)
(61,'group','G',3,'Irã',             'Nova Zelândia',  'ir','nz', '2026-06-26 20:00+00','São Francisco',    '2026-06-26 19:30+00',false),
(62,'group','G',3,'Bélgica',         'Egito',          'be','eg', '2026-06-26 20:00+00','Vancouver',        '2026-06-26 19:30+00',false),

-- ── Grupo H (26 jun, 23:00 UTC)
(63,'group','H',3,'Espanha',         'Cabo Verde',     'es','cv', '2026-06-26 23:00+00','Atlanta',          '2026-06-26 22:30+00',false),
(64,'group','H',3,'Uruguai',         'Arábia Saudita', 'uy','sa', '2026-06-26 23:00+00','Miami',            '2026-06-26 22:30+00',false),

-- ── Grupo I (27 jun, 20:00 UTC)
(65,'group','I',3,'França',          'Iraque',         'fr','iq', '2026-06-27 20:00+00','Nova York',        '2026-06-27 19:30+00',false),
(66,'group','I',3,'Noruega',         'Senegal',        'no','sn', '2026-06-27 20:00+00','Filadélfia',       '2026-06-27 19:30+00',false),

-- ── Grupo J (27 jun, 23:00 UTC)
(67,'group','J',3,'Argentina',       'Jordânia',       'ar','jo', '2026-06-27 23:00+00','Dallas',           '2026-06-27 22:30+00',false),
(68,'group','J',3,'Áustria',         'Argélia',        'at','dz', '2026-06-27 23:00+00','Kansas City',      '2026-06-27 22:30+00',false),

-- ── Grupo K (28 jun, 20:00 UTC)
(69,'group','K',3,'Portugal',        'Uzbequistão',    'pt','uz', '2026-06-28 20:00+00','Boston',           '2026-06-28 19:30+00',false),
(70,'group','K',3,'Colômbia',        'Congo RD',       'co','cd', '2026-06-28 20:00+00','Houston',          '2026-06-28 19:30+00',false),

-- ── Grupo L (28 jun, 23:00 UTC)
(71,'group','L',3,'Inglaterra',      'Gana',           'gb-eng','gh','2026-06-28 23:00+00','Nova York',     '2026-06-28 22:30+00',false),
(72,'group','L',3,'Croácia',         'Panamá',         'hr','pa', '2026-06-28 23:00+00','Los Angeles',      '2026-06-28 22:30+00',false),

-- ================================================================
-- RODADA DE 32 — (29 jun – 3 jul)
-- Times definidos após fase de grupos (TBD)
-- ================================================================
(73, 'round_of_32',NULL,NULL,'TBD','TBD','un','un','2026-06-29 20:00+00','Los Angeles',    '2026-06-29 19:30+00',false),
(74, 'round_of_32',NULL,NULL,'TBD','TBD','un','un','2026-06-29 23:00+00','Seattle',        '2026-06-29 22:30+00',false),
(75, 'round_of_32',NULL,NULL,'TBD','TBD','un','un','2026-06-30 20:00+00','Nova York',      '2026-06-30 19:30+00',false),
(76, 'round_of_32',NULL,NULL,'TBD','TBD','un','un','2026-06-30 23:00+00','Dallas',         '2026-06-30 22:30+00',false),
(77, 'round_of_32',NULL,NULL,'TBD','TBD','un','un','2026-07-01 20:00+00','Miami',          '2026-07-01 19:30+00',false),
(78, 'round_of_32',NULL,NULL,'TBD','TBD','un','un','2026-07-01 23:00+00','Houston',        '2026-07-01 22:30+00',false),
(79, 'round_of_32',NULL,NULL,'TBD','TBD','un','un','2026-07-02 20:00+00','San Francisco',  '2026-07-02 19:30+00',false),
(80, 'round_of_32',NULL,NULL,'TBD','TBD','un','un','2026-07-02 23:00+00','Atlanta',        '2026-07-02 22:30+00',false),
(81, 'round_of_32',NULL,NULL,'TBD','TBD','un','un','2026-07-03 17:00+00','Kansas City',    '2026-07-03 16:30+00',false),
(82, 'round_of_32',NULL,NULL,'TBD','TBD','un','un','2026-07-03 20:00+00','Filadélfia',     '2026-07-03 19:30+00',false),
(83, 'round_of_32',NULL,NULL,'TBD','TBD','un','un','2026-07-03 23:00+00','Boston',         '2026-07-03 22:30+00',false),
(84, 'round_of_32',NULL,NULL,'TBD','TBD','un','un','2026-07-04 20:00+00','Toronto',        '2026-07-04 19:30+00',false),
(85, 'round_of_32',NULL,NULL,'TBD','TBD','un','un','2026-07-04 23:00+00','Vancouver',      '2026-07-04 22:30+00',false),
(86, 'round_of_32',NULL,NULL,'TBD','TBD','un','un','2026-07-05 20:00+00','Guadalajara',    '2026-07-05 19:30+00',false),
(87, 'round_of_32',NULL,NULL,'TBD','TBD','un','un','2026-07-05 23:00+00','Monterrey',      '2026-07-05 22:30+00',false),
(88, 'round_of_32',NULL,NULL,'TBD','TBD','un','un','2026-07-06 20:00+00','Cidade do México','2026-07-06 19:30+00',false),

-- ================================================================
-- OITAVAS DE FINAL — (7–10 jul)
-- ================================================================
(89, 'round_of_16',NULL,NULL,'TBD','TBD','un','un','2026-07-07 20:00+00','Los Angeles',    '2026-07-07 19:30+00',false),
(90, 'round_of_16',NULL,NULL,'TBD','TBD','un','un','2026-07-07 23:00+00','Nova York',      '2026-07-07 22:30+00',false),
(91, 'round_of_16',NULL,NULL,'TBD','TBD','un','un','2026-07-08 20:00+00','Dallas',         '2026-07-08 19:30+00',false),
(92, 'round_of_16',NULL,NULL,'TBD','TBD','un','un','2026-07-08 23:00+00','Miami',          '2026-07-08 22:30+00',false),
(93, 'round_of_16',NULL,NULL,'TBD','TBD','un','un','2026-07-09 20:00+00','Houston',        '2026-07-09 19:30+00',false),
(94, 'round_of_16',NULL,NULL,'TBD','TBD','un','un','2026-07-09 23:00+00','Atlanta',        '2026-07-09 22:30+00',false),
(95, 'round_of_16',NULL,NULL,'TBD','TBD','un','un','2026-07-10 20:00+00','Kansas City',    '2026-07-10 19:30+00',false),
(96, 'round_of_16',NULL,NULL,'TBD','TBD','un','un','2026-07-10 23:00+00','São Francisco',  '2026-07-10 22:30+00',false),

-- ================================================================
-- QUARTAS DE FINAL — (11–12 jul)
-- ================================================================
(97, 'quarterfinal',NULL,NULL,'TBD','TBD','un','un','2026-07-11 20:00+00','Dallas',         '2026-07-11 19:30+00',false),
(98, 'quarterfinal',NULL,NULL,'TBD','TBD','un','un','2026-07-11 23:00+00','Los Angeles',    '2026-07-11 22:30+00',false),
(99, 'quarterfinal',NULL,NULL,'TBD','TBD','un','un','2026-07-12 20:00+00','Nova York',      '2026-07-12 19:30+00',false),
(100,'quarterfinal',NULL,NULL,'TBD','TBD','un','un','2026-07-12 23:00+00','Houston',        '2026-07-12 22:30+00',false),

-- ================================================================
-- SEMIFINAIS — (14–15 jul)
-- ================================================================
(101,'semifinal',NULL,NULL,'TBD','TBD','un','un','2026-07-14 23:00+00','Nova York',        '2026-07-14 22:30+00',false),
(102,'semifinal',NULL,NULL,'TBD','TBD','un','un','2026-07-15 23:00+00','Los Angeles',      '2026-07-15 22:30+00',false),

-- ================================================================
-- 3º LUGAR — 18 jul
-- ================================================================
(103,'third_place',NULL,NULL,'TBD','TBD','un','un','2026-07-18 20:00+00','Miami',           '2026-07-18 19:30+00',false),

-- ================================================================
-- FINAL — 19 jul · MetLife Stadium, Nova York
-- ================================================================
(104,'final',NULL,NULL,'TBD','TBD','un','un','2026-07-19 20:00+00','Nova York',            '2026-07-19 19:30+00',false);

-- ================================================================
-- CORRIGE PRAZOS: 23:59 BRT da véspera do 1º jogo de cada etapa
-- BRT = UTC-3 → 23:59 BRT = 02:59 UTC do dia seguinte
-- ================================================================
UPDATE public.matches SET betting_deadline = '2026-06-11 02:59+00' WHERE phase = 'group' AND round = 1;
UPDATE public.matches SET betting_deadline = '2026-06-16 02:59+00' WHERE phase = 'group' AND round = 2;
UPDATE public.matches SET betting_deadline = '2026-06-23 02:59+00' WHERE phase = 'group' AND round = 3;
UPDATE public.matches SET betting_deadline = '2026-06-29 02:59+00' WHERE phase = 'round_of_32';
UPDATE public.matches SET betting_deadline = '2026-07-07 02:59+00' WHERE phase = 'round_of_16';
UPDATE public.matches SET betting_deadline = '2026-07-11 02:59+00' WHERE phase = 'quarterfinal';
UPDATE public.matches SET betting_deadline = '2026-07-14 02:59+00' WHERE phase = 'semifinal';
UPDATE public.matches SET betting_deadline = '2026-07-18 02:59+00' WHERE phase IN ('third_place', 'final');
