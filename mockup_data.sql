-- ════════════════════════════════════════════════════════════════════════════
-- mockup_data.sql — Dados de Demonstração — Sistema de Painéis HAC
-- Hospital Anchieta Ceilândia | 2026-06-10
-- ════════════════════════════════════════════════════════════════════════════
-- COMO USAR:
--   psql -U postgres -d postgres -f mockup_data.sql
--
-- SENHA DE TODOS OS USUÁRIOS: HAC@2026
-- Hash gerado com: python -c "import bcrypt; print(bcrypt.hashpw(b'HAC@2026', bcrypt.gensalt(12)).decode())"
--
-- Este script é IDEMPOTENTE — usa ON CONFLICT DO NOTHING em todos os INSERTs.
-- Tabelas com SERIAL id são inseridas sem especificar o id (sequência automática).
-- Tabelas sem sequência (bigint PK) usam IDs explícitos.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. USUÁRIOS (senha: HAC@2026)
-- ────────────────────────────────────────────────────────────────────────────
-- Nota: tabela 'setores_hospital' removida — criar via database_setup.sql

INSERT INTO usuarios (id, usuario, senha_hash, email, is_admin, ativo, nome_completo, cargo) VALUES
(1, 'admin',        '$2b$12$pBkWz1rCM6PKLSWmtLcRH.BVD9Aber.0kWB5.j4Mfygqng.1GexRO', 'admin@hac.df.gov.br',        true,  true, 'Administrador do Sistema', 'TI'),
(2, 'medico.ps',    '$2b$12$pBkWz1rCM6PKLSWmtLcRH.BVD9Aber.0kWB5.j4Mfygqng.1GexRO', 'medico.ps@hac.df.gov.br',    false, true, 'Dr. Rafael Guimarães',    'Médico PS'),
(3, 'medico.uti',   '$2b$12$pBkWz1rCM6PKLSWmtLcRH.BVD9Aber.0kWB5.j4Mfygqng.1GexRO', 'medico.uti@hac.df.gov.br',   false, true, 'Dra. Patrícia Nogueira',  'Médico UTI/CM'),
(4, 'enfermeiro1',  '$2b$12$pBkWz1rCM6PKLSWmtLcRH.BVD9Aber.0kWB5.j4Mfygqng.1GexRO', 'enfermeiro1@hac.df.gov.br',  false, true, 'Enf. Cristina Barbosa',   'Enfermeira'),
(5, 'gestor1',      '$2b$12$pBkWz1rCM6PKLSWmtLcRH.BVD9Aber.0kWB5.j4Mfygqng.1GexRO', 'gestor1@hac.df.gov.br',      false, true, 'Adriana Fonseca',         'Gestora HAC'),
(6, 'padioleiro1',  '$2b$12$pBkWz1rCM6PKLSWmtLcRH.BVD9Aber.0kWB5.j4Mfygqng.1GexRO', 'padioleiro1@hac.df.gov.br',  false, true, 'Carlos Maqueiro',         'Maqueiro'),
(7, 'farmacia1',    '$2b$12$pBkWz1rCM6PKLSWmtLcRH.BVD9Aber.0kWB5.j4Mfygqng.1GexRO', 'farmacia1@hac.df.gov.br',    false, true, 'Rodrigo Santos',          'Farmacêutico'),
(8, 'radiologia1',  '$2b$12$pBkWz1rCM6PKLSWmtLcRH.BVD9Aber.0kWB5.j4Mfygqng.1GexRO', 'radiologia1@hac.df.gov.br',  false, true, 'Luciana Soares',          'Radiologista')
ON CONFLICT DO NOTHING;

SELECT setval('usuarios_id_seq', 100, false);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. PERMISSÕES DE PAINÉIS (RBAC)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO permissoes_paineis (usuario_id, painel_nome)
SELECT id, painel FROM usuarios,
    (VALUES
        -- medico.ps
        (2, 'painel3'), (2, 'painel10'), (2, 'painel17'), (2, 'painel18'),
        (2, 'painel22'), (2, 'painel25'), (2, 'painel9'),
        -- medico.uti
        (3, 'painel2'), (3, 'painel6'), (3, 'painel7'), (3, 'painel8'),
        (3, 'painel9'), (3, 'painel11'), (3, 'painel27'),
        -- enfermeiro1
        (4, 'painel2'), (4, 'painel8'), (4, 'painel9'), (4, 'painel34'),
        (4, 'painel13'),
        -- gestor1
        (5, 'painel4'), (5, 'painel12'), (5, 'painel32'), (5, 'painel36'),
        (5, 'painel28'),
        -- padioleiro1
        (6, 'painel35'),
        -- farmacia1
        (7, 'painel24'),
        -- radiologia1
        (8, 'painel19'), (8, 'painel20')
    ) AS t(uid, painel)
WHERE usuarios.id = t.uid
ON CONFLICT DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. PAINEL CLÍNICO TASY — FONTE PRINCIPAL (Esboço Taxa de Ocupação)
--    Modelo: Esboço Taxa de Ocupação.sql
--    Campos: AT.CD_ATENDIMENTO → nr_atendimento, L.DS_LEITO → ds_tipo_acomodacao,
--            P.NM_PACIENTE → nm_pessoa_fisica, PS.NM_PRESTADOR → nm_guerra,
--            TRUNC(SYSDATE - AT.DT_ATENDIMENTO) → qt_dia_permanencia
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO painel_clinico_tasy (
    nr_atendimento, dt_entrada_unidade, dt_entrada_unid,
    cd_unidade, cd_unidade_basica, nm_pessoa_fisica,
    cd_setor_atendimento, nm_setor, dt_nascimento, ie_sexo,
    ds_convenio, nr_crm, nm_guerra, qt_dia_permanencia,
    ds_clinica, ds_tipo_acomodacao, classif, ie_status_unidade,
    qt_pa_sistolica, qt_pa_diastolica, qt_pam,
    qt_freq_cardiaca, qt_freq_resp, qt_temp, qt_saturacao_o2,
    qt_peso, qt_glicemia_capilar, qt_escala_dor,
    exm_creatinina, exm_ureia, exm_sodio, exm_potassio,
    exm_hemoglobina, exm_leucocitos, exm_plaquetas,
    exm_troponina, exm_dimero_d, exm_lactato_art,
    dt_carga
) VALUES

-- ── UTI / CRÍTICOS ──────────────────────────────────────────────────────────
(100001, CURRENT_DATE - 3, '2026-06-07 08:42:00',
 '102', '102-01-A', 'MARIA DA CONCEIÇÃO SILVA',
 102, 'UTI Geral', '1981-07-22', 'F',
 'SUS', '23456', 'PATRICIA NOGUEIRA', 3,
 'UTI Geral', 'LEITO 01-A', 'CRÍTICO', 'P',
 82, 52, 62, 128, 30, 37.4, 86,
 61, NULL, 9,
 '3.9', '58', '131', '4.1',
 '9.8', '14.2', '89',
 NULL, NULL, '4.8',
 CURRENT_TIMESTAMP),

(100002, CURRENT_DATE - 10, '2026-06-01 14:18:00',
 '102', '102-02-A', 'JOSÉ AUGUSTO PIMENTEL',
 102, 'UTI Geral', '1943-02-18', 'M',
 'SUS', '23456', 'PATRICIA NOGUEIRA', 10,
 'UTI Geral', 'LEITO 02-A', 'CRÍTICO', 'P',
 76, 44, 55, 134, 34, 39.4, 84,
 72, NULL, 8,
 '6.2', '112', '128', '5.7',
 '8.1', '2.4', '68',
 NULL, NULL, '7.1',
 CURRENT_TIMESTAMP),

(100003, CURRENT_DATE - 7, '2026-06-04 10:05:00',
 '102', '102-03-A', 'MÁRCIO ANDRÉ TEIXEIRA',
 102, 'UTI Geral', '1963-08-27', 'M',
 'INAS/DF', '23456', 'PATRICIA NOGUEIRA', 7,
 'UTI Geral', 'LEITO 03-A', 'CRÍTICO', 'P',
 88, 56, 67, 118, 28, 39.0, 90,
 84, NULL, 7,
 '3.2', '64', '133', '4.9',
 '10.4', '22.8', '112',
 NULL, NULL, '4.2',
 CURRENT_TIMESTAMP),

-- ── CLÍNICA MÉDICA ──────────────────────────────────────────────────────────
(100004, CURRENT_DATE - 8, '2026-06-03 07:30:00',
 '103', '103-01-A', 'JOÃO BATISTA RODRIGUES',
 103, 'Clínica Médica', '1957-03-15', 'M',
 'SUS', '12345', 'MARCELO PINHEIRO', 8,
 'Clínica Médica', 'LEITO 01-A', 'ALTO', 'P',
 92, 58, 69, 114, 26, 38.8, 93,
 78, NULL, 6,
 '2.8', '54', '134', '4.4',
 '9.2', '18.5', '198',
 NULL, NULL, '3.1',
 CURRENT_TIMESTAMP),

(100005, CURRENT_DATE - 12, '2026-05-30 16:22:00',
 '103', '103-02-A', 'ROSÂNGELA LIMA COSTA',
 103, 'Clínica Médica', '1963-01-25', 'F',
 'SUS', '12345', 'MARCELO PINHEIRO', 12,
 'Clínica Médica', 'LEITO 02-A', 'ALTO', 'P',
 132, 82, 99, 76, 17, 36.6, 97,
 69, NULL, 3,
 '4.8', '96', '129', '5.9',
 '10.2', '8.6', '156',
 NULL, NULL, NULL,
 CURRENT_TIMESTAMP),

(100006, CURRENT_DATE - 7, '2026-06-04 11:50:00',
 '103', '103-03-A', 'LUCIANA BRITO BARBOSA',
 103, 'Clínica Médica', '1975-08-03', 'F',
 'SUS', '67890', 'JULIANA FERREIRA', 7,
 'Clínica Médica', 'LEITO 03-A', 'MODERADO', 'P',
 108, 68, 81, 95, 19, 36.7, 95,
 62, NULL, 4,
 '1.2', '32', '136', '4.0',
 '7.2', '9.8', '228',
 NULL, NULL, NULL,
 CURRENT_TIMESTAMP),

(100007, CURRENT_DATE - 6, '2026-06-05 09:10:00',
 '103', '103-04-A', 'VERA LÚCIA CAMPOS',
 103, 'Clínica Médica', '1960-12-19', 'F',
 'SUS', '67890', 'JULIANA FERREIRA', 6,
 'Clínica Médica', 'LEITO 04-A', 'MODERADO', 'P',
 148, 90, 109, 84, 17, 36.7, 96,
 73, 374, 2,
 '1.5', '38', '137', '4.2',
 '11.8', '10.2', '214',
 NULL, NULL, NULL,
 CURRENT_TIMESTAMP),

(100008, CURRENT_DATE - 9, '2026-06-02 18:45:00',
 '103', '103-05-A', 'EDUARDO VIEIRA PINTO',
 103, 'Clínica Médica', '1968-10-16', 'M',
 'SUS', '12345', 'MARCELO PINHEIRO', 9,
 'Clínica Médica', 'LEITO 05-A', 'BAIXO', 'P',
 134, 84, 101, 73, 16, 36.5, 97,
 81, NULL, 1,
 '1.1', '28', '138', '4.1',
 '13.6', '7.4', '244',
 NULL, NULL, NULL,
 CURRENT_TIMESTAMP),

-- ── CLÍNICA CIRÚRGICA ───────────────────────────────────────────────────────
(100009, CURRENT_DATE - 1, '2026-06-10 07:15:00',
 '104', '104-01-A', 'ANA PAULA SOUSA',
 104, 'Clínica Cirúrgica', '1988-04-30', 'F',
 'SUS', '78901', 'BRUNO CAVALCANTE', 1,
 'Cirurgia Geral', 'LEITO 01-A', 'BAIXO', 'P',
 118, 72, 87, 82, 16, 36.4, 99,
 58, NULL, 3,
 '0.9', '22', '139', '3.9',
 '12.8', '8.2', '256',
 NULL, NULL, NULL,
 CURRENT_TIMESTAMP),

(100010, CURRENT_DATE - 4, '2026-06-07 14:30:00',
 '104', '104-02-A', 'ROBERTO NASCIMENTO FREITAS',
 104, 'Clínica Cirúrgica', '1981-05-07', 'M',
 'INAS/DF', '78901', 'BRUNO CAVALCANTE', 4,
 'Cirurgia Geral', 'LEITO 02-A', 'BAIXO', 'P',
 115, 72, 86, 82, 16, 36.5, 98,
 77, NULL, 2,
 '1.0', '24', '138', '4.0',
 '13.2', '8.8', '248',
 NULL, NULL, NULL,
 CURRENT_TIMESTAMP),

(100011, CURRENT_DATE - 2, '2026-06-09 09:40:00',
 '104', '104-03-A', 'LUÍS HENRIQUE MARTINS',
 104, 'Clínica Cirúrgica', '1984-09-25', 'M',
 'SUS', '78901', 'BRUNO CAVALCANTE', 2,
 'Cirurgia Geral', 'LEITO 03-A', 'BAIXO', 'P',
 116, 74, 88, 76, 16, 36.6, 99,
 80, NULL, 2,
 '0.9', '21', '140', '3.8',
 '14.0', '7.6', '260',
 NULL, NULL, NULL,
 CURRENT_TIMESTAMP),

-- ── NEUROLOGIA ──────────────────────────────────────────────────────────────
(100012, CURRENT_DATE - 5, '2026-06-06 11:20:00',
 '105', '105-01-A', 'FRANCISCO JOSÉ ARAÚJO',
 105, 'Neurologia', '1948-09-12', 'M',
 'SUS', '56789', 'ANDRÉ RIBEIRO MONTEIRO', 5,
 'Neurologia', 'LEITO 01-A', 'MODERADO', 'P',
 178, 108, 131, 85, 19, 36.9, 97,
 82, NULL, 4,
 '1.4', '36', '136', '4.3',
 '12.4', '8.0', '238',
 NULL, NULL, NULL,
 CURRENT_TIMESTAMP),

(100013, CURRENT_DATE - 4, '2026-06-07 08:55:00',
 '105', '105-02-A', 'SANDRA REGINA OLIVEIRA',
 105, 'Neurologia', '1980-02-09', 'F',
 'SUS', '56789', 'ANDRÉ RIBEIRO MONTEIRO', 4,
 'Neurologia', 'LEITO 02-A', 'MODERADO', 'P',
 170, 102, 125, 70, 17, 36.8, 98,
 67, NULL, 3,
 '1.2', '30', '137', '4.1',
 '12.6', '7.8', '234',
 NULL, NULL, NULL,
 CURRENT_TIMESTAMP),

-- ── CARDIOLOGIA ─────────────────────────────────────────────────────────────
(100014, CURRENT_DATE - 2, '2026-06-09 10:10:00',
 '106', '106-01-A', 'CARLOS ALBERTO MENDES',
 106, 'Cardiologia', '1970-11-08', 'M',
 'INAS/DF', '45678', 'CAMILA ESTEVES', 2,
 'Cardiologia', 'LEITO 01-A', 'MODERADO', 'P',
 145, 92, 110, 97, 18, 36.8, 96,
 83, NULL, 4,
 '1.1', '28', '138', '4.0',
 '12.8', '9.4', '228',
 '0.08', NULL, NULL,
 CURRENT_TIMESTAMP),

(100015, CURRENT_DATE - 3, '2026-06-08 16:35:00',
 '106', '106-02-A', 'CÉLIA MARIA CASTRO',
 106, 'Cardiologia', '1971-04-11', 'F',
 'SUS', '45678', 'CAMILA ESTEVES', 3,
 'Cardiologia', 'LEITO 02-A', 'ALTO', 'P',
 152, 96, 115, 98, 18, 36.5, 96,
 66, NULL, 5,
 '1.3', '32', '136', '4.2',
 '11.6', '10.8', '208',
 '0.14', '1580', NULL,
 CURRENT_TIMESTAMP),

-- ── MATERNIDADE ─────────────────────────────────────────────────────────────
(100016, CURRENT_DATE - 1, '2026-06-10 04:22:00',
 '107', '107-01-A', 'MARIANA PEREIRA LIMA',
 107, 'Maternidade', '1999-11-30', 'F',
 'SUS', '23456', 'PATRICIA NOGUEIRA', 1,
 'Obstetrícia', 'LEITO 01-A', 'MODERADO', 'P',
 158, 104, 122, 88, 19, 36.8, 97,
 64, NULL, 3,
 '0.8', '18', '137', '3.7',
 '11.4', '9.6', '222',
 NULL, NULL, NULL,
 CURRENT_TIMESTAMP),

-- ── ORTOPEDIA ───────────────────────────────────────────────────────────────
(100017, CURRENT_DATE - 3, '2026-06-08 13:40:00',
 '109', '109-01-A', 'PAULO ROBERTO ALVES',
 109, 'Ortopedia', '1998-06-14', 'M',
 'INAS/DF', '89012', 'AMANDA ROCHA', 3,
 'Ortopedia', 'LEITO 01-A', 'BAIXO', 'P',
 122, 78, 93, 79, 16, 36.3, 99,
 75, NULL, 5,
 '0.9', '20', '139', '3.9',
 '14.2', '8.2', '252',
 NULL, NULL, NULL,
 CURRENT_TIMESTAMP),

-- ── PS ADULTO ───────────────────────────────────────────────────────────────
(100018, CURRENT_DATE, '2026-06-11 07:50:00',
 '101', 'PS-01-A', 'ANTÔNIO CARLOS DIAS',
 101, 'PS Adulto', '1952-07-04', 'M',
 'SUS', '34567', 'RAFAEL GUIMARÃES', 0,
 'PS', 'PS LEITO 01-A', 'MODERADO', 'P',
 102, 64, 77, 108, 23, 38.1, 94,
 68, NULL, 5,
 '1.6', '40', '135', '4.3',
 '10.8', '14.6', '188',
 NULL, NULL, NULL,
 CURRENT_TIMESTAMP),

(100019, CURRENT_DATE, '2026-06-11 09:15:00',
 '101', 'PS-02-A', 'PATRÍCIA MONTEIRO GOMES',
 101, 'PS Adulto', '1987-03-21', 'F',
 'SUS', '34567', 'RAFAEL GUIMARÃES', 0,
 'PS', 'PS LEITO 02-A', 'BAIXO', 'P',
 124, 78, 93, 86, 17, 37.0, 98,
 57, NULL, 2,
 '0.9', '22', '138', '3.9',
 '12.2', '8.0', '242',
 NULL, NULL, NULL,
 CURRENT_TIMESTAMP),

(100020, CURRENT_DATE, '2026-06-11 11:30:00',
 '101', 'PS-03-A', 'BEATRIZ ALMEIDA RAMOS',
 101, 'PS Adulto', '1993-06-08', 'F',
 'SUS', '34567', 'RAFAEL GUIMARÃES', 0,
 'PS', 'PS LEITO 03-A', 'BAIXO', 'P',
 118, 74, 89, 80, 17, 37.1, 98,
 59, NULL, 1,
 '0.8', '20', '139', '3.8',
 '12.6', '7.8', '248',
 NULL, NULL, NULL,
 CURRENT_TIMESTAMP)

ON CONFLICT (nr_atendimento) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. OCUPAÇÃO HOSPITALAR (Painel 4 / Painel 12)
--    Modelo direto do Esboço Taxa de Ocupação.sql:
--    Leitos P (paciente), L (livre), H (higienização), I (interditado)
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO ocupacao_hospitalar (
    nr_atendimento, dt_entrada_unidade, dt_entrada_unid,
    cd_unidade, cd_unidade_basica, nm_pessoa_fisica,
    cd_setor_atendimento, "OBTER_NOME_SETOR(A.CD_SETOR_ATENDIMENTO)",
    dt_nascimento, ie_sexo, ds_convenio, nr_crm, nm_guerra,
    qt_dia_permanencia, ds_clinica, ds_tipo_acomodacao,
    classif, ie_status_unidade, ie_temporario, dt_carga
) VALUES

-- UTI Geral (10 leitos)
('100001', NOW() - INTERVAL '3 days',  '2026-06-07 08:42',  '102', '102-01-A', 'MARIA DA CONCEIÇÃO SILVA',    102, 'UTI Geral',       '1981-07-22', 'F', 'SUS',     '23456', 'PATRICIA NOGUEIRA',      3,  'UTI Geral',      'LEITO 01-A', 'CRÍTICO',  'P', 'N', CURRENT_TIMESTAMP),
('100002', NOW() - INTERVAL '10 days', '2026-06-01 14:18',  '102', '102-02-A', 'JOSÉ AUGUSTO PIMENTEL',       102, 'UTI Geral',       '1943-02-18', 'M', 'SUS',     '23456', 'PATRICIA NOGUEIRA',      10, 'UTI Geral',      'LEITO 02-A', 'CRÍTICO',  'P', 'N', CURRENT_TIMESTAMP),
('100003', NOW() - INTERVAL '7 days',  '2026-06-04 10:05',  '102', '102-03-A', 'MÁRCIO ANDRÉ TEIXEIRA',       102, 'UTI Geral',       '1963-08-27', 'M', 'INAS/DF', '23456', 'PATRICIA NOGUEIRA',      7,  'UTI Geral',      'LEITO 03-A', 'CRÍTICO',  'P', 'N', CURRENT_TIMESTAMP),
(NULL, NULL, NULL, '102', '102-04-A', NULL, 102, 'UTI Geral', NULL, NULL, NULL, NULL, NULL, NULL, 'UTI Geral', 'LEITO 04-A', NULL, 'H', 'N', CURRENT_TIMESTAMP),
(NULL, NULL, NULL, '102', '102-05-A', NULL, 102, 'UTI Geral', NULL, NULL, NULL, NULL, NULL, NULL, 'UTI Geral', 'LEITO 05-A', NULL, 'L', 'N', CURRENT_TIMESTAMP),
(NULL, NULL, NULL, '102', '102-06-A', NULL, 102, 'UTI Geral', NULL, NULL, NULL, NULL, NULL, NULL, 'UTI Geral', 'LEITO 06-A', NULL, 'L', 'N', CURRENT_TIMESTAMP),
(NULL, NULL, NULL, '102', '102-07-A', NULL, 102, 'UTI Geral', NULL, NULL, NULL, NULL, NULL, NULL, 'UTI Geral', 'LEITO 07-A', NULL, 'I', 'N', CURRENT_TIMESTAMP),

-- Clínica Médica (32 leitos — amostra representativa)
('100004', NOW() - INTERVAL '8 days',  '2026-06-03 07:30',  '103', '103-01-A', 'JOÃO BATISTA RODRIGUES',      103, 'Clínica Médica',  '1957-03-15', 'M', 'SUS',     '12345', 'MARCELO PINHEIRO',        8,  'Clínica Médica', 'LEITO 01-A', 'ALTO',    'P', 'N', CURRENT_TIMESTAMP),
('100005', NOW() - INTERVAL '12 days', '2026-05-30 16:22',  '103', '103-02-A', 'ROSÂNGELA LIMA COSTA',        103, 'Clínica Médica',  '1963-01-25', 'F', 'SUS',     '12345', 'MARCELO PINHEIRO',        12, 'Clínica Médica', 'LEITO 02-A', 'ALTO',    'P', 'N', CURRENT_TIMESTAMP),
('100006', NOW() - INTERVAL '7 days',  '2026-06-04 11:50',  '103', '103-03-A', 'LUCIANA BRITO BARBOSA',       103, 'Clínica Médica',  '1975-08-03', 'F', 'SUS',     '67890', 'JULIANA FERREIRA',        7,  'Clínica Médica', 'LEITO 03-A', 'MODERADO','P', 'N', CURRENT_TIMESTAMP),
('100007', NOW() - INTERVAL '6 days',  '2026-06-05 09:10',  '103', '103-04-A', 'VERA LÚCIA CAMPOS',           103, 'Clínica Médica',  '1960-12-19', 'F', 'SUS',     '67890', 'JULIANA FERREIRA',        6,  'Clínica Médica', 'LEITO 04-A', 'MODERADO','P', 'N', CURRENT_TIMESTAMP),
('100008', NOW() - INTERVAL '9 days',  '2026-06-02 18:45',  '103', '103-05-A', 'EDUARDO VIEIRA PINTO',        103, 'Clínica Médica',  '1968-10-16', 'M', 'SUS',     '12345', 'MARCELO PINHEIRO',        9,  'Clínica Médica', 'LEITO 05-A', 'BAIXO',   'P', 'N', CURRENT_TIMESTAMP),
(NULL, NULL, NULL, '103', '103-06-A', NULL, 103, 'Clínica Médica', NULL, NULL, NULL, NULL, NULL, NULL, 'Clínica Médica', 'LEITO 06-A', NULL, 'H', 'N', CURRENT_TIMESTAMP),
(NULL, NULL, NULL, '103', '103-07-A', NULL, 103, 'Clínica Médica', NULL, NULL, NULL, NULL, NULL, NULL, 'Clínica Médica', 'LEITO 07-A', NULL, 'L', 'N', CURRENT_TIMESTAMP),
(NULL, NULL, NULL, '103', '103-08-A', NULL, 103, 'Clínica Médica', NULL, NULL, NULL, NULL, NULL, NULL, 'Clínica Médica', 'LEITO 08-A', NULL, 'L', 'S', CURRENT_TIMESTAMP),

-- Clínica Cirúrgica
('100009', NOW() - INTERVAL '1 day',  '2026-06-10 07:15',  '104', '104-01-A', 'ANA PAULA SOUSA',             104, 'Clínica Cirúrgica', '1988-04-30', 'F', 'SUS',     '78901', 'BRUNO CAVALCANTE',       1,  'Cirurgia Geral', 'LEITO 01-A', 'BAIXO',   'P', 'N', CURRENT_TIMESTAMP),
('100010', NOW() - INTERVAL '4 days', '2026-06-07 14:30',  '104', '104-02-A', 'ROBERTO NASCIMENTO FREITAS',  104, 'Clínica Cirúrgica', '1981-05-07', 'M', 'INAS/DF', '78901', 'BRUNO CAVALCANTE',       4,  'Cirurgia Geral', 'LEITO 02-A', 'BAIXO',   'P', 'N', CURRENT_TIMESTAMP),
('100011', NOW() - INTERVAL '2 days', '2026-06-09 09:40',  '104', '104-03-A', 'LUÍS HENRIQUE MARTINS',       104, 'Clínica Cirúrgica', '1984-09-25', 'M', 'SUS',     '78901', 'BRUNO CAVALCANTE',       2,  'Cirurgia Geral', 'LEITO 03-A', 'BAIXO',   'P', 'N', CURRENT_TIMESTAMP),
(NULL, NULL, NULL, '104', '104-04-A', NULL, 104, 'Clínica Cirúrgica', NULL, NULL, NULL, NULL, NULL, NULL, 'Cirurgia Geral', 'LEITO 04-A', NULL, 'L', 'N', CURRENT_TIMESTAMP),

-- Neurologia
('100012', NOW() - INTERVAL '5 days', '2026-06-06 11:20',  '105', '105-01-A', 'FRANCISCO JOSÉ ARAÚJO',       105, 'Neurologia',      '1948-09-12', 'M', 'SUS',     '56789', 'ANDRÉ RIBEIRO MONTEIRO', 5,  'Neurologia',     'LEITO 01-A', 'MODERADO','P', 'N', CURRENT_TIMESTAMP),
('100013', NOW() - INTERVAL '4 days', '2026-06-07 08:55',  '105', '105-02-A', 'SANDRA REGINA OLIVEIRA',      105, 'Neurologia',      '1980-02-09', 'F', 'SUS',     '56789', 'ANDRÉ RIBEIRO MONTEIRO', 4,  'Neurologia',     'LEITO 02-A', 'MODERADO','P', 'N', CURRENT_TIMESTAMP),
(NULL, NULL, NULL, '105', '105-03-A', NULL, 105, 'Neurologia', NULL, NULL, NULL, NULL, NULL, NULL, 'Neurologia', 'LEITO 03-A', NULL, 'L', 'N', CURRENT_TIMESTAMP),

-- Cardiologia
('100014', NOW() - INTERVAL '2 days', '2026-06-09 10:10',  '106', '106-01-A', 'CARLOS ALBERTO MENDES',       106, 'Cardiologia',     '1970-11-08', 'M', 'INAS/DF', '45678', 'CAMILA ESTEVES',          2,  'Cardiologia',    'LEITO 01-A', 'MODERADO','P', 'N', CURRENT_TIMESTAMP),
('100015', NOW() - INTERVAL '3 days', '2026-06-08 16:35',  '106', '106-02-A', 'CÉLIA MARIA CASTRO',          106, 'Cardiologia',     '1971-04-11', 'F', 'SUS',     '45678', 'CAMILA ESTEVES',          3,  'Cardiologia',    'LEITO 02-A', 'ALTO',    'P', 'N', CURRENT_TIMESTAMP),
(NULL, NULL, NULL, '106', '106-03-A', NULL, 106, 'Cardiologia', NULL, NULL, NULL, NULL, NULL, NULL, 'Cardiologia', 'LEITO 03-A', NULL, 'H', 'N', CURRENT_TIMESTAMP),

-- Maternidade
('100016', NOW() - INTERVAL '1 day',  '2026-06-10 04:22',  '107', '107-01-A', 'MARIANA PEREIRA LIMA',        107, 'Maternidade',     '1999-11-30', 'F', 'SUS',     '23456', 'PATRICIA NOGUEIRA',       1,  'Obstetrícia',    'LEITO 01-A', 'MODERADO','P', 'N', CURRENT_TIMESTAMP),
(NULL, NULL, NULL, '107', '107-02-A', NULL, 107, 'Maternidade', NULL, NULL, NULL, NULL, NULL, NULL, 'Obstetrícia', 'LEITO 02-A', NULL, 'L', 'N', CURRENT_TIMESTAMP),
(NULL, NULL, NULL, '107', '107-03-A', NULL, 107, 'Maternidade', NULL, NULL, NULL, NULL, NULL, NULL, 'Obstetrícia', 'LEITO 03-A', NULL, 'L', 'N', CURRENT_TIMESTAMP),

-- Ortopedia
('100017', NOW() - INTERVAL '3 days', '2026-06-08 13:40',  '109', '109-01-A', 'PAULO ROBERTO ALVES',         109, 'Ortopedia',       '1998-06-14', 'M', 'INAS/DF', '89012', 'AMANDA ROCHA',            3,  'Ortopedia',      'LEITO 01-A', 'BAIXO',   'P', 'N', CURRENT_TIMESTAMP),
(NULL, NULL, NULL, '109', '109-02-A', NULL, 109, 'Ortopedia', NULL, NULL, NULL, NULL, NULL, NULL, 'Ortopedia', 'LEITO 02-A', NULL, 'L', 'N', CURRENT_TIMESTAMP),

-- PS Adulto (6 pacientes + leitos livres)
('100018', NOW() - INTERVAL '4 hours', '2026-06-11 07:50', '101', 'PS-01-A', 'ANTÔNIO CARLOS DIAS',          101, 'PS Adulto',       '1952-07-04', 'M', 'SUS',     '34567', 'RAFAEL GUIMARÃES',        0,  'PS',             'PS LEITO 01-A', 'MODERADO','P','N', CURRENT_TIMESTAMP),
('100019', NOW() - INTERVAL '2 hours', '2026-06-11 09:15', '101', 'PS-02-A', 'PATRÍCIA MONTEIRO GOMES',      101, 'PS Adulto',       '1987-03-21', 'F', 'SUS',     '34567', 'RAFAEL GUIMARÃES',        0,  'PS',             'PS LEITO 02-A', 'BAIXO',  'P','N', CURRENT_TIMESTAMP),
('100020', NOW() - INTERVAL '1 hour',  '2026-06-11 11:30', '101', 'PS-03-A', 'BEATRIZ ALMEIDA RAMOS',        101, 'PS Adulto',       '1993-06-08', 'F', 'SUS',     '34567', 'RAFAEL GUIMARÃES',        0,  'PS',             'PS LEITO 03-A', 'BAIXO',  'P','N', CURRENT_TIMESTAMP),
(NULL, NULL, NULL, '101', 'PS-04-A', NULL, 101, 'PS Adulto', NULL, NULL, NULL, NULL, NULL, NULL, 'PS', 'PS LEITO 04-A', NULL, 'L', 'N', CURRENT_TIMESTAMP),
(NULL, NULL, NULL, '101', 'PS-05-A', NULL, 101, 'PS Adulto', NULL, NULL, NULL, NULL, NULL, NULL, 'PS', 'PS LEITO 05-A', NULL, 'L', 'N', CURRENT_TIMESTAMP)
;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. PENDÊNCIAS DE LABORATÓRIO (Painel 9)
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO pendencias_lab (
    nr_atendimento, dt_entrada_unidade, dt_entrada_unid,
    cd_unidade, cd_unidade_basica, nm_pessoa_fisica,
    dt_nascimento, ie_sexo, cd_setor_atendimento, nm_setor,
    ds_convenio, nr_crm, nm_guerra, qt_dia_permanencia,
    ds_clinica, ds_tipo_acomodacao, ie_status_unidade,
    lab_pendentes, img_pendentes
) VALUES
(100004, CURRENT_DATE-8, NOW()-INTERVAL '8 days', '103', '103-01-A', 'JOÃO BATISTA RODRIGUES',     '1957-03-15', 'M', 103, 'Clínica Médica', 'SUS', '12345', 'MARCELO PINHEIRO', 8, 'Clínica Médica', 'LEITO 01-A', 'P', 'Hemograma,Creatinina,Ureia,Eletrólitos,Hemocultura', NULL),
(100005, CURRENT_DATE-12,NOW()-INTERVAL '12 days','103', '103-02-A', 'ROSÂNGELA LIMA COSTA',       '1963-01-25', 'F', 103, 'Clínica Médica', 'SUS', '12345', 'MARCELO PINHEIRO', 12,'Clínica Médica', 'LEITO 02-A', 'P', 'Creatinina,Gasometria Venosa,Ureia,PTH', NULL),
(100001, CURRENT_DATE-3, NOW()-INTERVAL '3 days', '102', '102-01-A', 'MARIA DA CONCEIÇÃO SILVA',   '1981-07-22', 'F', 102, 'UTI Geral',     'SUS', '23456', 'PATRICIA NOGUEIRA', 3, 'UTI Geral',     'LEITO 01-A', 'P', 'Hemocultura,Gasometria Arterial,Lactato,PCR', 'RX Tórax'),
(100002, CURRENT_DATE-10,NOW()-INTERVAL '10 days','102', '102-02-A', 'JOSÉ AUGUSTO PIMENTEL',      '1943-02-18', 'M', 102, 'UTI Geral',     'SUS', '23456', 'PATRICIA NOGUEIRA', 10,'UTI Geral',     'LEITO 02-A', 'P', 'Hemocultura 2/2,Gasometria Arterial,Função Hepática', 'TC Tórax,Eco TT'),
(100015, CURRENT_DATE-3, NOW()-INTERVAL '3 days', '106', '106-02-A', 'CÉLIA MARIA CASTRO',         '1971-04-11', 'F', 106, 'Cardiologia',   'SUS', '45678', 'CAMILA ESTEVES',   3, 'Cardiologia',   'LEITO 02-A', 'P', 'Troponina Serial,BNP,Coagulograma', 'Ecocardiograma,Cintilografia'),
(100018, CURRENT_DATE,   NOW()-INTERVAL '4 hours','101', 'PS-01-A',  'ANTÔNIO CARLOS DIAS',        '1952-07-04', 'M', 101, 'PS Adulto',     'SUS', '34567', 'RAFAEL GUIMARÃES', 0, 'PS',            'PS LEITO 01-A','P','Hemograma,PCR,Urina Rotina', 'RX Tórax PA')
ON CONFLICT (nr_atendimento) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. ANÁLISE IA (Painel 6)
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO painel_clinico_analise_ia (
    nr_atendimento, nm_paciente, cd_leito, nm_setor,
    nivel_criticidade, score_ia,
    analise_ia, pontos_atencao, recomendacoes,
    modelo_ia, ie_ativo
) VALUES
(100001, 'MARIA DA CONCEIÇÃO SILVA', '102-01-A', 'UTI Geral',
 'CRÍTICO', 9.2,
 'Paciente em sepse grave com disfunção respiratória e renal. SpO2 de 86% evidencia comprometimento pulmonar importante. Lactato arterial elevado (4,8) indica hipoperfusão tecidual.',
 'SpO2 crítica (86%); Lactato arterial 4,8 mmol/L; Creatinina 3,9 mg/dL; FC 128 bpm; PA 82x52 mmHg',
 '1. Avaliar necessidade de ventilação mecânica imediata; 2. Otimizar reposição volêmica guiada por parâmetros hemodinâmicos; 3. Bundle de sepse — coleta hemocultura e antibiótico em até 1h; 4. Consulta nefrologia para possível TRSC',
 'llama-3.3-70b', true),

(100002, 'JOSÉ AUGUSTO PIMENTEL', '102-02-A', 'UTI Geral',
 'CRÍTICO', 9.8,
 'Paciente idoso (83 anos) em choque séptico com disfunção múltipla de órgãos. Lactato 7,1, creatinina 6,2, plaquetas 68.000. Leucopenia (2,4k) sugere sepse refratária.',
 'Lactato arterial 7,1 mmol/L; Plaquetopenia 68.000; Leucopenia 2,4k; SpO2 84%; PA 76x44 mmHg',
 '1. Noradrenalina — titular para PAM > 65; 2. Avaliar TRSC emergencial — creatinina 6,2 e oligúria; 3. Discutir prognóstico com família; 4. Hematologia — investigar CIVD',
 'llama-3.3-70b', true),

(100004, 'JOÃO BATISTA RODRIGUES', '103-01-A', 'Clínica Médica',
 'ALTO', 7.4,
 'Paciente com sepse em evolução. Critérios SOFA alterados: PAM 69, FR 26, SpO2 93%, creatinina 2,8. Leucocitose importante (18.500). Hemocultura pendente.',
 'Suspeita sepse — SOFA alterado; Leucocitose 18.500; Creatinina 2,8; Lactato 3,1',
 '1. Bundle de sepse iniciado? Checar hemocultura e antibiótico; 2. Hidratação guiada; 3. Monitorar diurese; 4. Repetir lactato em 2h',
 'llama-3.3-70b', true),

(100015, 'CÉLIA MARIA CASTRO', '106-02-A', 'Cardiologia',
 'ALTO', 7.8,
 'Síndrome coronariana em investigação. Troponina 0,14 ng/mL com elevação progressiva. D-dímero 1.580. FC 98 com leve taquicardia. Aguarda ecocardiograma.',
 'Troponina 0,14 ng/mL (elevada); D-dímero 1.580; FC 98; PA 152x96 mmHg',
 '1. Confirmar diagnóstico — ECG seriado e enzimas a cada 6h; 2. Anticoagulação plena se IAM SSST confirmado; 3. Hemodinâmica — avaliar indicação de cateterismo; 4. Excluir TEP',
 'llama-3.3-70b', true)
ON CONFLICT DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. MÉDICOS NO PS (Painel 3)
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO medicos_ps (nm_usuario, nm_maq_cliente, consultorio, ds_usuario, especialidade, machine, logon_time, tempo_conectado) VALUES
('RGUIMARAES',  'TASY-PS-01', 'Consultório 01', 'Dr. Rafael Guimarães',      'Clínica Médica/PS',  'TASY-PS-01', NOW() - INTERVAL '4 hours', '4h 12min'),
('AROCHAMD',    'TASY-PS-02', 'Consultório 02', 'Dra. Amanda Rocha',         'Cirurgia Geral/PS',  'TASY-PS-02', NOW() - INTERVAL '6 hours', '6h 05min'),
('MSILVAPED',   'TASY-PS-03', 'Consultório 03', 'Dra. Mariana Silva',        'Pediatria/PS',       'TASY-PS-03', NOW() - INTERVAL '2 hours', '2h 30min'),
('FMOURA',      'TASY-PS-04', 'Consultório 04', 'Dr. Fernando Moura',        'Clínica Médica/PS',  'TASY-PS-04', NOW() - INTERVAL '1 hour',  '1h 18min');

-- ════════════════════════════════════════════════════════════════════════════
-- 9. PARECERES PENDENTES (Painel 26)
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO pareceres_pendentes (
    nr_parecer, nr_atendimento, cd_paciente, nm_paciente,
    cd_medico, nm_medico_solicitante, cd_especialidade_dest, especialidade_destino,
    dt_solicitacao, horas_pendente, ie_tipo_atendimento, ds_tipo_atendimento,
    ds_convenio, dt_entrada_hospital, cd_setor_atendimento, nm_setor,
    cd_leito, ie_situacao, status_parecer, ds_motivo_consulta
) VALUES
-- status_parecer varchar(5): 'P'=pendente, 'A'=atendido, 'C'=cancelado
(200001, 100004, '4455667', 'JOÃO BATISTA RODRIGUES',     '12345', 'MARCELO PINHEIRO',   7, 'Nefrologia',
 '2026-06-11 08:00', 3.5, 'I', 'INTERNAÇÃO',
 'SUS', '2026-06-03 07:30', 103, 'Clínica Médica', '103-01-A', 'A', 'P',
 'Paciente em sepse grave com IRA. Creatinina 2,8, ureia 54, oligúria nas últimas 12h. Solicito avaliação para possível TRSC.'),

(200002, 100015, '7788990', 'CÉLIA MARIA CASTRO',         '45678', 'CAMILA ESTEVES',     3, 'Cardiologia Interv',
 '2026-06-11 06:30', 4.5, 'I', 'INTERNAÇÃO',
 'SUS', '2026-06-08 16:35', 106, 'Cardiologia', '106-02-A', 'A', 'P',
 'IAMSSST anterior — troponina 0,14 com elevação progressiva. ECG: ST elevado em V1-V4. Solicito avaliação hemodinâmica urgente.'),

(200003, 100005, '3344556', 'ROSÂNGELA LIMA COSTA',       '12345', 'MARCELO PINHEIRO',  7, 'Nefrologia',
 '2026-06-10 14:00', 17.0, 'I', 'INTERNAÇÃO',
 'SUS', '2026-05-30 16:22', 103, 'Clínica Médica', '103-02-A', 'A', 'P',
 'DRC crônica em agudização — creatinina 4,8 mg/dL (basal 3,2), ureia 96, hiperpotassemia 5,9 mEq/L. Solicito orientação sobre conduta dialítica.'),

(200004, 100018, '9900112', 'ANTÔNIO CARLOS DIAS',        '34567', 'RAFAEL GUIMARÃES',  5, 'Cardiologia',
 '2026-06-11 09:00', 2.0, 'U', 'URGÊNCIA',
 'SUS', '2026-06-11 07:50', 101, 'PS Adulto', 'PS-01-A', 'A', 'P',
 'Dor precordial atípica com irradiação para MSE. ECG sem alterações isquêmicas agudas. Troponina inicial negativa — aguarda serial. Solicito avaliação cardiológica.'),

(200005, 100016, '5566778', 'MARIANA PEREIRA LIMA',       '23456', 'PATRICIA NOGUEIRA', 9, 'Obstetr Alto R',
 '2026-06-11 07:00', 4.0, 'I', 'INTERNAÇÃO',
 'SUS', '2026-06-10 04:22', 107, 'Maternidade', '107-01-A', 'A', 'P',
 'Pré-eclâmpsia grave — PA 158x104 mmHg sem melhora com hidralazina. IG 37sem. CTG categoria II. Solicito avaliação para resolução da gestação.')
ON CONFLICT (nr_parecer) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. EVOLUÇÃO DE TURNO (Painel 2)
-- ════════════════════════════════════════════════════════════════════════════

-- evolucao_medica/enfermeiro/etc são varchar(10): flags curtas ('REALIZADA', 'PENDENTE', 'S', 'N')
INSERT INTO evolucao_turno (
    nr_atendimento, ds_convenio, nm_paciente, idade,
    dt_entrada, dias_internado, data_turno, turno,
    setor, unidade, medico_responsavel,
    evolucao_medica, evolucao_enfermeiro, evolucao_tec_enfermagem,
    evolucao_nutricionista, evolucao_fisioterapeuta
) VALUES
('100004','SUS','JOÃO BATISTA RODRIGUES','68 anos',
 NOW()-INTERVAL '8 days', 8, CURRENT_DATE, 'DIURNO',
 'Clin. Medica','103','MARCELO PINHEIRO',
 'REALIZADA','REALIZADA','REALIZADA','PENDENTE','N/A'),

('100001','SUS','MARIA DA CONCEIÇÃO SILVA','44 anos',
 NOW()-INTERVAL '3 days', 3, CURRENT_DATE, 'DIURNO',
 'UTI Geral','102','PATRICIA NOGUEIRA',
 'REALIZADA','REALIZADA','REALIZADA','REALIZADA','REALIZADA'),

('100015','SUS','CÉLIA MARIA CASTRO','54 anos',
 NOW()-INTERVAL '3 days', 3, CURRENT_DATE, 'DIURNO',
 'Cardiologia','106','CAMILA ESTEVES',
 'REALIZADA','REALIZADA','PENDENTE','PENDENTE','N/A'),

('100016','SUS','MARIANA PEREIRA LIMA','26 anos',
 NOW()-INTERVAL '1 day', 1, CURRENT_DATE, 'DIURNO',
 'Maternidade','107','PATRICIA NOGUEIRA',
 'REALIZADA','REALIZADA','REALIZADA','REALIZADA','N/A');

-- ════════════════════════════════════════════════════════════════════════════
-- 11. CIRURGIAS DO DIA (Painel 5)
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO agenda_paciente_cirurgias (
    dt_agenda, ds_agenda, cd_agenda, nr_minuto_duracao,
    nm_paciente_pf, ds_convenio, nm_medico, ds_idade_abrev,
    setor_cirurgia, hr_inicio, ds_proc_cir,
    ie_status_cirurgia, ds_status, ie_tipo_atendimento
) VALUES
(CURRENT_DATE + TIME '07:00', 'CC-01', 1, 120,
 'ROBERTO NASCIMENTO FREITAS', 'INAS/DF', 'BRUNO CAVALCANTE', '43a',
 'Centro Cirúrgico', '07:00', 'COLECISTECTOMIA VIDEOLAPAROSCÓPICA',
 2, 'Em andamento', 'I'),

(CURRENT_DATE + TIME '09:30', 'CC-02', 2, 90,
 'LUÍS HENRIQUE MARTINS', 'SUS', 'BRUNO CAVALCANTE', '41a',
 'Centro Cirúrgico', '09:30', 'HERNIORRAFIA INGUINAL UNILATERAL',
 1, 'Agendada', 'I'),

(CURRENT_DATE + TIME '11:00', 'CC-03', 3, 180,
 'MARIANA PEREIRA LIMA', 'SUS', 'PATRICIA NOGUEIRA', '26a',
 'Centro Cirúrgico', '11:00', 'CESARIANA — PRÉ-ECLÂMPSIA GRAVE',
 1, 'Agendada', 'I'),

(CURRENT_DATE + TIME '14:00', 'CC-04', 4, 60,
 'PAULO ROBERTO ALVES', 'INAS/DF', 'AMANDA ROCHA', '28a',
 'Centro Cirúrgico', '14:00', 'OSTEOSSÍNTESE COM PLACA E PARAFUSOS — TÍBIA',
 1, 'Agendada', 'I'),

(CURRENT_DATE - INTERVAL '1 day' + TIME '08:00', 'CC-05', 5, 150,
 'ANA PAULA SOUSA', 'SUS', 'BRUNO CAVALCANTE', '38a',
 'Centro Cirúrgico', '08:00', 'APENDICECTOMIA VIDEOLAPAROSCÓPICA',
 3, 'Realizada', 'I');

-- ════════════════════════════════════════════════════════════════════════════
-- 12. SUBSISTEMA PADIOLEIRO (Painéis 34, 35, 36)
-- ════════════════════════════════════════════════════════════════════════════

-- Tipos de Movimento
INSERT INTO padioleiro_tipos_movimento (id, nome, icone, cor, ativo, ordem) VALUES
(1, 'Exame',          'fa-flask',           '#17a2b8', true, 1),
(2, 'Cirurgia',       'fa-kit-medical',     '#dc3545', true, 2),
(3, 'Alta',           'fa-house-medical',   '#28a745', true, 3),
(4, 'Transferência',  'fa-ambulance',       '#fd7e14', true, 4),
(5, 'Outro',          'fa-ellipsis-h',      '#6c757d', true, 5)
ON CONFLICT DO NOTHING;

SELECT setval('padioleiro_tipos_movimento_id_seq', 10, false);

-- Destinos por Tipo
INSERT INTO padioleiro_destinos (id, nome, tipo_movimento_id, ativo, ordem) VALUES
-- Exames (tipo 1)
(1,  'Laboratório Central',        1, true, 1),
(2,  'Radiologia',                 1, true, 2),
(3,  'Tomografia',                 1, true, 3),
(4,  'Ressonância Magnética',      1, true, 4),
(5,  'Ecocardiograma',             1, true, 5),
(6,  'Endoscopia',                 1, true, 6),
-- Cirurgia (tipo 2)
(7,  'Centro Cirúrgico',           2, true, 1),
(8,  'Hemodinâmica',               2, true, 2),
-- Alta (tipo 3)
(9,  'Recepção / Saída',           3, true, 1),
(10, 'Ambulatório de Controle',    3, true, 2),
-- Transferência (tipo 4)
(11, 'UTI Geral',                  4, true, 1),
(12, 'Clínica Médica',             4, true, 2),
(13, 'Clínica Cirúrgica',          4, true, 3),
(14, 'Neurologia',                 4, true, 4),
(15, 'Cardiologia',                4, true, 5),
(16, 'Maternidade',                4, true, 6),
(17, 'Pediatria',                  4, true, 7),
(18, 'Ortopedia',                  4, true, 8)
ON CONFLICT DO NOTHING;

SELECT setval('padioleiro_destinos_id_seq', 30, false);

-- Maqueiros Cadastrados
INSERT INTO padioleiro_cadastros (id, nome, matricula, turno, ativo) VALUES
(1, 'Carlos Eduardo Maqueiro', 'HAC-001', 'manhã',  true),
(2, 'José Ferreira Padioleiro', 'HAC-002', 'tarde',  true),
(3, 'Marcos Lima Transporte',   'HAC-003', 'noite',  true),
(4, 'Paulo Souza Padioleiro',   'HAC-004', 'manhã',  true)
ON CONFLICT DO NOTHING;

SELECT setval('padioleiro_cadastros_id_seq', 10, false);

-- Pacientes disponíveis para transporte (espelho do painel_clinico_tasy)
INSERT INTO padioleiro (
    nr_atendimento, dt_entrada_unidade, dt_entrada,
    cd_unidade, cd_unidade_basica, nm_pessoa_fisica,
    cd_setor_atendimento, setor, dt_nascimento, ie_sexo,
    ds_convenio, nr_crm, nm_guerra, qt_dia_permanencia,
    ds_clinica, ds_tipo_acomodacao, ie_status_unidade, ie_temporario
) VALUES
('100004', NOW()-INTERVAL '8 days', NOW()-INTERVAL '8 days', '103','103-01-A','JOÃO BATISTA RODRIGUES',    103,'Clínica Médica',  '1957-03-15','M','SUS',    '12345','MARCELO PINHEIRO',  8, 'Clínica Médica', 'LEITO 01-A','P','N'),
('100005', NOW()-INTERVAL '12 days',NOW()-INTERVAL '12 days','103','103-02-A','ROSÂNGELA LIMA COSTA',      103,'Clínica Médica',  '1963-01-25','F','SUS',    '12345','MARCELO PINHEIRO',  12,'Clínica Médica', 'LEITO 02-A','P','N'),
('100006', NOW()-INTERVAL '7 days', NOW()-INTERVAL '7 days', '103','103-03-A','LUCIANA BRITO BARBOSA',     103,'Clínica Médica',  '1975-08-03','F','SUS',    '67890','JULIANA FERREIRA',  7, 'Clínica Médica', 'LEITO 03-A','P','N'),
('100009', NOW()-INTERVAL '1 day',  NOW()-INTERVAL '1 day',  '104','104-01-A','ANA PAULA SOUSA',           104,'Clínica Cirúrgica','1988-04-30','F','SUS',   '78901','BRUNO CAVALCANTE',  1, 'Cirurgia Geral', 'LEITO 01-A','P','N'),
('100010', NOW()-INTERVAL '4 days', NOW()-INTERVAL '4 days', '104','104-02-A','ROBERTO NASCIMENTO FREITAS',104,'Clínica Cirúrgica','1981-05-07','M','INAS/DF','78901','BRUNO CAVALCANTE',  4, 'Cirurgia Geral', 'LEITO 02-A','P','N'),
('100017', NOW()-INTERVAL '3 days', NOW()-INTERVAL '3 days', '109','109-01-A','PAULO ROBERTO ALVES',       109,'Ortopedia',       '1998-06-14','M','INAS/DF','89012','AMANDA ROCHA',       3, 'Ortopedia',      'LEITO 01-A','P','N'),
('100018', NOW()-INTERVAL '4 hours',NOW()-INTERVAL '4 hours','101','PS-01-A', 'ANTÔNIO CARLOS DIAS',       101,'PS Adulto',       '1952-07-04','M','SUS',    '34567','RAFAEL GUIMARÃES',   0, 'PS',             'PS LEITO 01-A','P','N'),
('100019', NOW()-INTERVAL '2 hours',NOW()-INTERVAL '2 hours','101','PS-02-A', 'PATRÍCIA MONTEIRO GOMES',   101,'PS Adulto',       '1987-03-21','F','SUS',    '34567','RAFAEL GUIMARÃES',   0, 'PS',             'PS LEITO 02-A','P','N');

-- Chamados de Transporte (mix de status)
INSERT INTO padioleiro_chamados (
    tipo_movimento_id, tipo_movimento_nome, nm_paciente, nr_atendimento,
    leito_origem, setor_origem_nome, destino_nome,
    prioridade, status,
    solicitante_id, solicitante_nome,
    padioleiro_id, padioleiro_nome,
    criado_em, dt_aceite, dt_inicio_transporte, dt_conclusao
) VALUES
(1,'Exame','JOÃO BATISTA RODRIGUES','100004','103-01-A','Clínica Médica','Laboratório Central',
 'urgente','concluido', 4,'Enf. Cristina Barbosa', 1,'Carlos Eduardo Maqueiro',
 NOW()-INTERVAL '3 hours', NOW()-INTERVAL '3 hours'+INTERVAL '5 min',
 NOW()-INTERVAL '3 hours'+INTERVAL '8 min', NOW()-INTERVAL '2 hours 30 min'),

(1,'Exame','MARIA DA CONCEIÇÃO SILVA','100001','102-01-A','UTI Geral','Tomografia',
 'urgente','em_transporte', 3,'Dra. Patrícia Nogueira', 4,'Paulo Souza Padioleiro',
 NOW()-INTERVAL '30 min', NOW()-INTERVAL '25 min', NOW()-INTERVAL '20 min', NULL),

(1,'Exame','CÉLIA MARIA CASTRO','100015','106-02-A','Cardiologia','Ecocardiograma',
 'urgente','aceito', 3,'Dra. Patrícia Nogueira', 1,'Carlos Eduardo Maqueiro',
 NOW()-INTERVAL '10 min', NOW()-INTERVAL '8 min', NULL, NULL),

(2,'Cirurgia','ROBERTO NASCIMENTO FREITAS','100010','104-02-A','Clínica Cirúrgica','Centro Cirúrgico',
 'urgente','aguardando', 4,'Enf. Cristina Barbosa', NULL, NULL,
 NOW()-INTERVAL '5 min', NULL, NULL, NULL),

(3,'Alta','PAULO ROBERTO ALVES','100017','109-01-A','Ortopedia','Recepção / Saída',
 'normal','aguardando', 5,'Adriana Fonseca', NULL, NULL,
 NOW()-INTERVAL '2 min', NULL, NULL, NULL);

-- ════════════════════════════════════════════════════════════════════════════
-- 13. CHAMADOS DE TI (Painéis 14 e 15)
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO chamados_locais (id, setor, local, hostname, ativo, data_criacao, data_atualizacao) VALUES
(1,  'PS Adulto',         'PS - Posto de Enfermagem',   'TASY-PS-01',     true, NOW(), NOW()),
(2,  'UTI Geral',         'UTI - Posto Médico',         'TASY-UTI-01',    true, NOW(), NOW()),
(3,  'Clínica Médica',    'CM - Sala da Chefia',        'PC-CM-01',       true, NOW(), NOW()),
(4,  'Farmácia',          'Farmácia Central',           'PC-FARM-01',     true, NOW(), NOW()),
(5,  'Radiologia',        'Radiologia - Laudo',         'PC-RAD-01',      true, NOW(), NOW()),
(6,  'Laboratório',       'Lab - Bancada Central',      'PC-LAB-01',      true, NOW(), NOW()),
(7,  'Faturamento',       'Faturamento - Escritório',   'PC-FAT-01',      true, NOW(), NOW()),
(8,  'Recepção',          'Recepção Principal',         'PC-REC-01',      true, NOW(), NOW()),
(9,  'CCIH',              'CCIH - Sala',                'PC-CCIH-01',     true, NOW(), NOW()),
(10, 'Administração',     'Diretoria',                  'PC-DIR-01',      true, NOW(), NOW())
ON CONFLICT DO NOTHING;

INSERT INTO chamados_problemas (id, descricao, ativo, data_criacao, data_atualizacao) VALUES
(1, 'Computador lento / travando',         true, NOW(), NOW()),
(2, 'Sem acesso ao Tasy',                  true, NOW(), NOW()),
(3, 'Impressora não imprime',              true, NOW(), NOW()),
(4, 'Sem conexão com a internet',          true, NOW(), NOW()),
(5, 'Monitor com problema',                true, NOW(), NOW()),
(6, 'Erro no sistema / tela preta',        true, NOW(), NOW()),
(7, 'Painel / TV não exibe informações',   true, NOW(), NOW()),
(8, 'Outro',                               true, NOW(), NOW())
ON CONFLICT DO NOTHING;

INSERT INTO chamados (
    numero_kora, nome_solicitante, local_problema,
    observacao_abertura, data_abertura, data_visualizacao,
    tecnico_atendimento, data_inicio_atendimento, data_fechamento,
    observacao_fechamento, status, prioridade, visualizado,
    data_atualizacao, local_id, setor, hostname, problema_id, problema_descricao
) VALUES
('KORA-0041','Enf. Cristina Barbosa','PS - Posto de Enfermagem',
 'Computador do posto travando durante abertura de evolução no Tasy. Já reiniciei mas o problema voltou.',
 NOW()-INTERVAL '2 hours', NOW()-INTERVAL '1 hour 50 min',
 'Lucas TI', NOW()-INTERVAL '1 hour 40 min', NULL, NULL,
 'em_atendimento','alta',true, NOW()-INTERVAL '10 min',
 1,'PS Adulto','TASY-PS-01',1,'Computador lento / travando'),

('KORA-0040','Farmacêutico Rodrigo Santos','Farmácia Central',
 'Impressora do dispensário não está imprimindo etiquetas. Urgente para dispensação.',
 NOW()-INTERVAL '4 hours', NOW()-INTERVAL '3 hours 50 min',
 'Lucas TI', NOW()-INTERVAL '3 hours', NOW()-INTERVAL '1 hour',
 'Problema resolvido — driver reinstalado. Testado com impressão de etiqueta.',
 'fechado','alta',true, NOW()-INTERVAL '1 hour',
 4,'Farmácia','PC-FARM-01',3,'Impressora não imprime'),

('KORA-0039','Técnica Ana Carvalho','Radiologia - Laudo',
 'Monitor do laudo piscando constantemente. Prejudica leitura de imagens.',
 NOW()-INTERVAL '1 day', NOW()-INTERVAL '23 hours',
 NULL, NULL, NULL, NULL,
 'aberto','normal',true, NOW()-INTERVAL '1 day',
 5,'Radiologia','PC-RAD-01',5,'Monitor com problema'),

('KORA-0038','Recepcionista Marta Lima','Recepção Principal',
 'Painel da recepção parou de atualizar. Fila do Qmatic não está aparecendo.',
 NOW()-INTERVAL '5 hours', NOW()-INTERVAL '4 hours 45 min',
 'Lucas TI', NOW()-INTERVAL '4 hours', NOW()-INTERVAL '2 hours',
 'Reiniciado serviço do painel. Atualização voltou ao normal.',
 'fechado','alta',true, NOW()-INTERVAL '2 hours',
 8,'Recepção','PC-REC-01',7,'Painel / TV não exibe informações'),

('KORA-0037','Dr. Rafael Guimarães','PS - Posto de Enfermagem',
 'Não consigo acessar o Tasy — senha expirada ou erro de login.',
 NOW()-INTERVAL '6 hours', NOW()-INTERVAL '5 hours 55 min',
 'Lucas TI', NOW()-INTERVAL '5 hours 50 min', NOW()-INTERVAL '5 hours 30 min',
 'Senha resetada e usuário reativado no Tasy. Orientado sobre expiração de senha.',
 'fechado','alta',true, NOW()-INTERVAL '5 hours 30 min',
 1,'PS Adulto','TASY-PS-01',2,'Sem acesso ao Tasy');

-- ════════════════════════════════════════════════════════════════════════════
-- 14. NOTIFICAÇÕES (Painel 26)
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO notificacoes_tipos_evento (id, codigo, nome, descricao, icone, cor, tabela_origem, ativo) VALUES
(1,'admissao_nova',          'Nova Admissão',              'Paciente internado nas últimas 2 horas',         'fa-user-plus',     '#28a745','painel_clinico_tasy',  true),
(2,'parecer_pendente',       'Parecer Pendente',           'Parecer médico aguardando há mais de 2 horas',   'fa-file-medical',  '#dc3545','pareceres_pendentes',  true),
(3,'prescricao_pendente',    'Prescrição Pendente',        'Paciente sem prescrição médica ativa',           'fa-prescription',  '#fd7e14','painel_clinico_tasy',  true),
(4,'sepse_alerta',           'Alerta de Sepse',            'Paciente com critérios de sepse identificados',  'fa-virus',         '#6f42c1','painel_clinico_tasy',  true),
(5,'leito_disponivel',       'Leito Disponível',           'Leito liberado após alta ou transferência',      'fa-bed',           '#17a2b8','ocupacao_hospitalar',  true)
ON CONFLICT DO NOTHING;

INSERT INTO notificacoes_destinatarios (tipo_evento, nome, email, especialidade, setor, ativo, canal, destino) VALUES
('parecer_pendente',   'Médico Cardiologista',        'cardio@hac.df.gov.br',    'Cardiologia',   NULL,           true, 'email', 'cardio@hac.df.gov.br'),
('parecer_pendente',   'Médico Nefrologista',         'nefro@hac.df.gov.br',     'Nefrologia',    NULL,           true, 'email', 'nefro@hac.df.gov.br'),
('admissao_nova',      'Gestão HAC',                  'gestao@hac.df.gov.br',    NULL,            NULL,           true, 'email', 'gestao@hac.df.gov.br'),
('admissao_nova',      'Plantão UTI (ntfy)',           'uti@hac.df.gov.br',       NULL,            'UTI Geral',    true, 'ntfy',  'hac-uti-alertas'),
('sepse_alerta',       'Plantão Geral (ntfy)',         'plantao@hac.df.gov.br',   NULL,            NULL,           true, 'ntfy',  'hac-sepse-alerta'),
('prescricao_pendente','Enfermagem Geral (ntfy)',      'enf@hac.df.gov.br',       NULL,            NULL,           true, 'ntfy',  'hac-prescricoes')
ON CONFLICT DO NOTHING;

INSERT INTO notificacoes_config (
    tipo_evento, descricao, topico_ntfy, url_servidor, ativo,
    hora_inicio, hora_fim,
    intervalo_renotificacao_min, max_renotificacoes,
    prioridade_ntfy, tags_ntfy,
    titulo_template, mensagem_template
) VALUES
('admissao_nova','Alerta para novas internações','hac-admissoes','https://ntfy.sh',true,
 '06:00','22:00', 60, 3, 3, 'hospital,admissao',
 'Nova Admissão — HAC', 'Paciente admitido em {{setor}}. Verificar prescrição inicial.'),

('parecer_pendente','Alerta para pareceres aguardando','hac-pareceres','https://ntfy.sh',true,
 '07:00','22:00', 120, 5, 4, 'hospital,parecer,urgente',
 'Parecer Pendente — HAC', 'Parecer de {{especialidade}} pendente há {{horas}}h. Verificar solicitação.'),

('sepse_alerta','Alerta automático de sepse','hac-sepse','https://ntfy.sh',true,
 '00:00','23:59', 30, 10, 5, 'hospital,sepse,critico',
 'ALERTA SEPSE — HAC', 'Critérios de sepse identificados em {{setor}}. Avaliação imediata necessária.')
ON CONFLICT DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 15. SENTIR E AGIR
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO sentir_agir_setores (id, nome, sigla, icone, ativo, ordem) VALUES
(1, 'PS Adulto',        'PSA', 'fa-truck-medical',    true, 1),
(2, 'UTI Geral',        'UTI', 'fa-heart-pulse',      true, 2),
(3, 'Clínica Médica',   'CM',  'fa-bed-pulse',        true, 3),
(4, 'Clínica Cirúrgica','CC',  'fa-scalpel',          true, 4),
(5, 'Farmácia',         'FAR', 'fa-pills',            true, 5),
(6, 'Nutrição',         'NUT', 'fa-utensils',         true, 6)
ON CONFLICT DO NOTHING;

INSERT INTO sentir_agir_categorias (id, nome, icone, cor, ordem, permite_nao_aplica, ativo) VALUES
(1, 'Limpeza e Higienização', 'fa-broom',          '#17a2b8', 1, false, true),
(2, 'Hotelaria e Conforto',   'fa-concierge-bell', '#28a745', 2, true,  true),
(3, 'Segurança do Paciente',  'fa-shield-halved',  '#dc3545', 3, false, true),
(4, 'Processos e Fluxo',      'fa-diagram-project','#fd7e14', 4, true,  true),
(5, 'Humanização',            'fa-heart',          '#e83e8c', 5, true,  true)
ON CONFLICT DO NOTHING;

INSERT INTO sentir_agir_itens (id, categoria_id, descricao, ordem, ativo, critico_quando, tipo_resposta, gera_critico) VALUES
-- Limpeza
(1,  1, 'Lixeiras com tampa e identificação',          1, true, 'nao',     'sim_nao', true),
(2,  1, 'Piso limpo e sem resíduos visíveis',          2, true, 'nao',     'sim_nao', true),
(3,  1, 'Banheiros limpos e com insumos',              3, true, 'nao',     'sim_nao', true),
(4,  1, 'Álcool gel disponível em todos os pontos',    4, true, 'nao',     'sim_nao', true),
-- Hotelaria
(5,  2, 'Roupas de cama trocadas conforme protocolo',  1, true, 'nao',     'sim_nao', false),
(6,  2, 'Iluminação adequada no quarto/leito',         2, true, 'nao',     'sim_nao', false),
(7,  2, 'Temperatura ambiente confortável',            3, true, 'nao',     'sim_nao', false),
-- Segurança
(8,  3, 'Grade de proteção elevada nos leitos',        1, true, 'nao',     'sim_nao', true),
(9,  3, 'Identificação de paciente visível no leito',  2, true, 'nao',     'sim_nao', true),
(10, 3, 'Pulseira de identificação no paciente',       3, true, 'nao',     'sim_nao', true),
(11, 3, 'Medicamentos de alto risco identificados',    4, true, 'nao',     'sim_nao', true),
-- Processos
(12, 4, 'Prescrição médica atualizada (<24h)',         1, true, 'nao',     'sim_nao', true),
(13, 4, 'Evolução de enfermagem registrada',           2, true, 'nao',     'sim_nao', false),
(14, 4, 'Pendências de exames verificadas',            3, true, 'nao',     'sim_nao', false),
-- Humanização
(15, 5, 'Paciente informado sobre seu tratamento',     1, true, 'nao',     'sim_nao', false),
(16, 5, 'Visita/ronda de humanização realizada',       2, true, 'nao',     'sim_nao', false)
ON CONFLICT DO NOTHING;

INSERT INTO sentir_agir_duplas (id, nome_visitante_1, nome_visitante_2, ativo, ordem) VALUES
(1, 'Adriana Fonseca',   'Cristina Barbosa',   true, 1),
(2, 'Lucas TI',          'Rodrigo Santos',     true, 2),
(3, 'Amanda Rocha',      'Luciana Soares',     true, 3)
ON CONFLICT DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 16. HUB DE SERVIÇOS (Painel 28)
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO hub_servicos (nome, descricao, icone, cor, url_destino, tipo, ordem, ativo, requer_login) VALUES
('Tasy Web',        'Prontuário Eletrônico Oracle Tasy',     'fa-hospital',           '#0d6efd', '/tasy',           'externo',  1, true, true),
('Metabase',        'BI e Relatórios Gerenciais',            'fa-chart-bar',          '#fd7e14', '/metabase',       'externo',  2, true, true),
('Apache Hop',      'Monitoramento ETL',                     'fa-gears',              '#6c757d', 'http://localhost:8080','externo',3,true,true),
('Uptime Kuma',     'Monitoramento de Saúde do Sistema',     'fa-heart-pulse',        '#28a745', '/uptime',         'externo',  4, true, true),
('Painel Padioleiro','Gestão de Transportes',                'fa-ambulance',          '#17a2b8', '/painel/painel36','interno',  5, true, true),
('Central Notif.',  'Central de Notificações',               'fa-bell',               '#dc3545', '/painel/painel26','interno',  6, true, true)
ON CONFLICT DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 17. NUTRIÇÃO (Painel 13)
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO painel_prescricoes_nutricao (
    nr_atendimento, nm_paciente, leito, dt_entrada, setor,
    nm_medico, convenio, idade, dt_prescricao, prescritor, nm_prescritor,
    dieta, ds_observacao
) VALUES
('100004','JOÃO BATISTA RODRIGUES',   '103-01-A', NOW()-INTERVAL '8 days',  'Clínica Médica',  'MARCELO PINHEIRO',  'SUS',    '68 anos', NOW()-INTERVAL '2 hours', 'NUTRI-01','Nutricionista Carla Lima',
 'Dieta hiperproteica hipercalórica oral — 2200kcal/dia','Introdução gradual. Monitorar aceitação. Paciente em sepse — aumento da demanda metabólica.'),
('100005','ROSÂNGELA LIMA COSTA',     '103-02-A', NOW()-INTERVAL '12 days', 'Clínica Médica',  'MARCELO PINHEIRO',  'SUS',    '63 anos', NOW()-INTERVAL '4 hours', 'NUTRI-01','Nutricionista Carla Lima',
 'Dieta hipoproteica para DRC — 0,6g prot/kg/dia, hipossódica','Restringir potássio e fósforo. Monitorar aceitação oral e balanço hídrico.'),
('100001','MARIA DA CONCEIÇÃO SILVA', '102-01-A', NOW()-INTERVAL '3 days',  'UTI Geral',       'PATRICIA NOGUEIRA', 'SUS',    '44 anos', NOW()-INTERVAL '1 hour',  'NUTRI-02','Nutricionista Paula Mota',
 'TNE gástrica — fórmula polimérica 1kcal/mL, 1500kcal/dia','Paciente intubada. TNE iniciada com progresso gradual. Monitorar resíduo gástrico 4/4h.'),
('100016','MARIANA PEREIRA LIMA',     '107-01-A', NOW()-INTERVAL '1 day',   'Maternidade',     'PATRICIA NOGUEIRA', 'SUS',    '26 anos', NOW()-INTERVAL '3 hours', 'NUTRI-01','Nutricionista Carla Lima',
 'Dieta normal gestante — reforço proteico e cálcio','Pré-eclâmpsia — restricção de sódio. Manter hidratação oral supervisionada.');

-- ════════════════════════════════════════════════════════════════════════════
-- 18. ATUALIZAÇÃO DE SEQUÊNCIAS
-- ════════════════════════════════════════════════════════════════════════════

SELECT setval('usuarios_id_seq',                     100, false);
SELECT setval('permissoes_paineis_id_seq',            100, false);
SELECT setval('ocupacao_hospitalar_id_seq',           100, false);
SELECT setval('medicos_ps_id_seq',                    100, false);
SELECT setval('evolucao_turno_id_seq',                100, false);
SELECT setval('agenda_paciente_cirurgias_id_seq',     100, false);
SELECT setval('painel_clinico_analise_ia_id_seq',     100, false);
SELECT setval('padioleiro_id_seq',                    100, false);
SELECT setval('padioleiro_chamados_id_seq',           100, false);
SELECT setval('padioleiro_cadastros_id_seq',           10, false);
SELECT setval('padioleiro_tipos_movimento_id_seq',     10, false);
SELECT setval('padioleiro_destinos_id_seq',            30, false);
SELECT setval('chamados_id_seq',                      100, false);
SELECT setval('chamados_locais_id_seq',                20, false);
SELECT setval('chamados_problemas_id_seq',             20, false);
SELECT setval('notificacoes_tipos_evento_id_seq',      10, false);
SELECT setval('notificacoes_destinatarios_id_seq',     20, false);
SELECT setval('notificacoes_config_id_seq',            10, false);
SELECT setval('sentir_agir_setores_id_seq',            10, false);
SELECT setval('sentir_agir_categorias_id_seq',         10, false);
SELECT setval('sentir_agir_itens_id_seq',              30, false);
SELECT setval('sentir_agir_duplas_id_seq',             10, false);
SELECT setval('hub_servicos_id_seq',                   20, false);
SELECT setval('painel_prescricoes_nutricao_id_seq',    20, false);

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO RÁPIDA (executar separado após o COMMIT)
-- ════════════════════════════════════════════════════════════════════════════
/*
SELECT 'usuarios'                 AS tabela, COUNT(*) AS registros FROM usuarios
UNION ALL SELECT 'painel_clinico_tasy',   COUNT(*) FROM painel_clinico_tasy
UNION ALL SELECT 'ocupacao_hospitalar',   COUNT(*) FROM ocupacao_hospitalar
UNION ALL SELECT 'pendencias_lab',        COUNT(*) FROM pendencias_lab
UNION ALL SELECT 'pareceres_pendentes',   COUNT(*) FROM pareceres_pendentes
UNION ALL SELECT 'evolucao_turno',        COUNT(*) FROM evolucao_turno
UNION ALL SELECT 'cirurgias_agenda',      COUNT(*) FROM agenda_paciente_cirurgias
UNION ALL SELECT 'analise_ia',            COUNT(*) FROM painel_clinico_analise_ia
UNION ALL SELECT 'padioleiro_pacientes',  COUNT(*) FROM padioleiro
UNION ALL SELECT 'padioleiro_chamados',   COUNT(*) FROM padioleiro_chamados
UNION ALL SELECT 'chamados_ti',           COUNT(*) FROM chamados
UNION ALL SELECT 'sentir_agir_setores',   COUNT(*) FROM sentir_agir_setores
UNION ALL SELECT 'notificacoes_dest',     COUNT(*) FROM notificacoes_destinatarios
UNION ALL SELECT 'prescricoes_nutricao',  COUNT(*) FROM painel_prescricoes_nutricao
ORDER BY tabela;
*/
