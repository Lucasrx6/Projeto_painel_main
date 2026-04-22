-- ============================================================
-- Painel 33 - SQL de Teste
-- Cria as tabelas + view e insere 10 registros de exemplo
-- Execute no banco antes de testar o front-end
-- ============================================================

-- ---- Tabelas ----

CREATE TABLE IF NOT EXISTS painel33_autorizacoes_convenio (
    nr_sequencia          SERIAL PRIMARY KEY,
    nr_atendimento        VARCHAR(50),
    nm_paciente           VARCHAR(200),
    nm_convenio           VARCHAR(200),
    ds_plano              VARCHAR(200),
    ds_tipo_autorizacao   VARCHAR(100),
    ds_status             VARCHAR(50)  DEFAULT 'pendente',
    ds_prioridade         VARCHAR(50)  DEFAULT 'normal',
    nm_setor              VARCHAR(200),
    nm_medico_solicitante VARCHAR(200),
    dt_solicitacao        TIMESTAMP    DEFAULT NOW(),
    dt_prazo_sla          DATE,
    dt_resposta           TIMESTAMP,
    vl_solicitado         NUMERIC(12,2),
    vl_aprovado           NUMERIC(12,2),
    ds_justificativa_negativa TEXT,
    ds_observacoes        TEXT,
    dt_vigencia_inicio    DATE,
    dt_vigencia_fim       DATE,
    dt_criacao            TIMESTAMP    DEFAULT NOW(),
    dt_atualizacao        TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS painel33_autorizacao_materiais (
    id             SERIAL PRIMARY KEY,
    nr_sequencia   INTEGER REFERENCES painel33_autorizacoes_convenio(nr_sequencia) ON DELETE CASCADE,
    ds_material    VARCHAR(500),
    cd_material    VARCHAR(100),
    qt_solicitada  NUMERIC(10,2),
    qt_aprovada    NUMERIC(10,2),
    vl_unitario    NUMERIC(12,2),
    ds_status      VARCHAR(50),
    ds_observacoes TEXT
);

CREATE TABLE IF NOT EXISTS painel33_autorizacao_procedimentos (
    id             SERIAL PRIMARY KEY,
    nr_sequencia   INTEGER REFERENCES painel33_autorizacoes_convenio(nr_sequencia) ON DELETE CASCADE,
    ds_procedimento VARCHAR(500),
    cd_tuss        VARCHAR(50),
    cd_cbhpm       VARCHAR(50),
    qt_solicitada  NUMERIC(10,2),
    qt_aprovada    NUMERIC(10,2),
    vl_solicitado  NUMERIC(12,2),
    vl_aprovado    NUMERIC(12,2),
    ds_status      VARCHAR(50),
    ds_observacoes TEXT
);

CREATE TABLE IF NOT EXISTS painel33_autorizacao_documentos (
    id              SERIAL PRIMARY KEY,
    nr_sequencia    INTEGER REFERENCES painel33_autorizacoes_convenio(nr_sequencia) ON DELETE CASCADE,
    ds_tipo_documento VARCHAR(200),
    ds_nome_arquivo VARCHAR(500),
    ds_url          VARCHAR(1000),
    dt_upload       TIMESTAMP DEFAULT NOW(),
    nm_usuario_upload VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS painel33_convenio_sla (
    id           SERIAL PRIMARY KEY,
    nm_convenio  VARCHAR(200),
    ds_tipo      VARCHAR(100),
    nr_dias_sla  INTEGER DEFAULT 3
);


-- ---- Dados de Teste ----

INSERT INTO painel33_autorizacoes_convenio
    (nr_atendimento, nm_paciente, nm_convenio, ds_plano, ds_tipo_autorizacao,
     ds_status, ds_prioridade, nm_setor, nm_medico_solicitante,
     dt_solicitacao, dt_prazo_sla, vl_solicitado, vl_aprovado,
     dt_vigencia_inicio, dt_vigencia_fim)
VALUES
    ('ATD-2024-0001', 'Maria das Graças Silva', 'Unimed DF',        'Unimed Essencial',      'Procedimento', 'pendente',    'normal',      'Ortopedia',        'Dr. Carlos Mendes',    NOW() - INTERVAL '2 days',  CURRENT_DATE + 1,          1850.00,   NULL,    '2024-01-01', '2026-12-31'),
    ('ATD-2024-0002', 'João Pedro Almeida',     'SulAmérica',       'SulAmérica Especial',   'Material',     'em_analise',  'urgente',     'Neurologia',       'Dra. Ana Paula Costa', NOW() - INTERVAL '1 day',   CURRENT_DATE,              4200.00,   NULL,    '2023-06-01', '2025-06-30'),
    ('ATD-2024-0003', 'Francisca Oliveira',     'Bradesco Saúde',   'Bradesco Top Nacional', 'Procedimento', 'aprovado',    'normal',      'Cardiologia',      'Dr. Roberto Lima',     NOW() - INTERVAL '10 days', CURRENT_DATE - 7,           7500.00,   7200.00, '2022-03-01', '2027-03-01'),
    ('ATD-2024-0004', 'Antônio Carlos Ferreira','Amil',             'Amil 400',              'Internação',   'negado',      'urgente',     'UTI',              'Dra. Mariana Rocha',   NOW() - INTERVAL '15 days', CURRENT_DATE - 12,          12000.00,  NULL,    '2021-07-15', '2024-07-14'),
    ('ATD-2024-0005', 'Beatriz Santos Lima',    'Unimed DF',        'Unimed Premium',        'Exame',        'pendente',    'normal',      'Oncologia',        'Dr. Fábio Nascimento', NOW() - INTERVAL '5 days',  CURRENT_DATE - 2,           890.00,    NULL,    '2024-01-01', '2026-12-31'),
    ('ATD-2024-0006', 'Cláudio Henrique Neves', 'NotreDame Intermédica','NDI Master',        'Material',     'recurso',     'emergencial', 'Cirurgia Geral',   'Dra. Juliana Prado',   NOW() - INTERVAL '20 days', CURRENT_DATE - 17,          3600.00,   NULL,    '2020-11-01', '2025-10-31'),
    ('ATD-2024-0007', 'Sandra Regina Moura',    'SulAmérica',       'SulAmérica Clássico',   'Procedimento', 'aprovado',    'normal',      'Ginecologia',      'Dr. Paulo Sérgio',     NOW() - INTERVAL '7 days',  CURRENT_DATE + 3,           2100.00,   1950.00, '2023-01-01', '2028-01-01'),
    ('ATD-2024-0008', 'Marcelo Augusto Dias',   'Amil',             'Amil 700',              'Exame',        'em_analise',  'urgente',     'Neurologia',       'Dra. Ana Paula Costa', NOW() - INTERVAL '3 days',  CURRENT_DATE + 2,           650.00,    NULL,    '2022-08-01', '2025-08-01'),
    ('ATD-2024-0009', 'Luciana Ferreira Gomes', 'Bradesco Saúde',   'Bradesco Nacional',     'Internação',   'cancelado',   'normal',      'Clínica Médica',   'Dr. Tiago Barbosa',    NOW() - INTERVAL '30 days', CURRENT_DATE - 27,          9500.00,   NULL,    '2023-05-01', '2025-05-01'),
    ('ATD-2024-0010', 'Roberto Carlos Pinto',   'Unimed DF',        'Unimed Master',         'Procedimento', 'pendente',    'emergencial', 'Pronto Socorro',   'Dr. Carlos Mendes',    NOW() - INTERVAL '6 hours', CURRENT_DATE + 2,           5500.00,   NULL,    '2024-02-01', '2027-02-01');


-- ---- Materiais para seq 2 ----
INSERT INTO painel33_autorizacao_materiais
    (nr_sequencia, ds_material, cd_material, qt_solicitada, qt_aprovada, vl_unitario, ds_status)
VALUES
    (2, 'Cateter venoso central de longa duração',  'MAT-001', 1, NULL, 850.00, 'pendente'),
    (2, 'Kit de curativo estéril complexo',         'MAT-002', 5, NULL,  42.00, 'pendente');

-- ---- Procedimentos para seq 1 ----
INSERT INTO painel33_autorizacao_procedimentos
    (nr_sequencia, ds_procedimento, cd_tuss, qt_solicitada, vl_solicitado, ds_status)
VALUES
    (1, 'Artroscopia de joelho',           '40301021', 1, 1850.00, 'pendente');

-- ---- Procedimentos para seq 3 ----
INSERT INTO painel33_autorizacao_procedimentos
    (nr_sequencia, ds_procedimento, cd_tuss, qt_solicitada, qt_aprovada, vl_solicitado, vl_aprovado, ds_status)
VALUES
    (3, 'Cateterismo cardíaco diagnóstico', '40101023', 1, 1, 7500.00, 7200.00, 'aprovado');

-- ---- Documentos para seq 6 ----
INSERT INTO painel33_autorizacao_documentos
    (nr_sequencia, ds_tipo_documento, ds_nome_arquivo, nm_usuario_upload)
VALUES
    (6, 'Laudo Médico',    'laudo_medico_6.pdf',    'sistema'),
    (6, 'Pedido Recurso',  'recurso_atd6.pdf',      'sistema');


-- ---- SLA por convênio ----
INSERT INTO painel33_convenio_sla (nm_convenio, ds_tipo, nr_dias_sla)
VALUES
    ('Unimed DF',              'Procedimento', 3),
    ('Unimed DF',              'Material',     2),
    ('SulAmérica',             'Procedimento', 5),
    ('Bradesco Saúde',         'Internação',   2),
    ('Amil',                   'Material',     4),
    ('NotreDame Intermédica',  'Procedimento', 3)
ON CONFLICT DO NOTHING;
