#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Migracao: Sistema Padioleiro (paineis 34, 35, 36)
Execucao unica: python scripts/migrate_padioleiro.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
from backend.database import get_db_connection


DDL = """
CREATE TABLE IF NOT EXISTS padioleiro_cadastros (
    id          SERIAL PRIMARY KEY,
    nome        VARCHAR(200) NOT NULL,
    matricula   VARCHAR(50),
    turno       VARCHAR(20) DEFAULT 'todos',
    ativo       BOOLEAN DEFAULT TRUE,
    criado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP
);

CREATE TABLE IF NOT EXISTS padioleiro_tipos_movimento (
    id     SERIAL PRIMARY KEY,
    nome   VARCHAR(100) NOT NULL,
    icone  VARCHAR(50)  DEFAULT 'fa-ambulance',
    cor    VARCHAR(20)  DEFAULT '#dc3545',
    ativo  BOOLEAN DEFAULT TRUE,
    ordem  INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS padioleiro_destinos (
    id                SERIAL PRIMARY KEY,
    nome              VARCHAR(200) NOT NULL,
    tipo_movimento_id INT REFERENCES padioleiro_tipos_movimento(id),
    ativo             BOOLEAN DEFAULT TRUE,
    ordem             INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS padioleiro_chamados (
    id                    SERIAL PRIMARY KEY,
    tipo_movimento_id     INT,
    tipo_movimento_nome   VARCHAR(100),
    nm_paciente           VARCHAR(200),
    nr_atendimento        VARCHAR(50),
    leito_origem          VARCHAR(50),
    setor_origem_nome     VARCHAR(200),
    destino_nome          VARCHAR(200),
    destino_complemento   VARCHAR(200),
    observacao            TEXT,
    prioridade            VARCHAR(20) DEFAULT 'normal',
    status                VARCHAR(30) DEFAULT 'aguardando',
    solicitante_id        INT REFERENCES usuarios(id),
    solicitante_nome      VARCHAR(200),
    padioleiro_id         INT,
    padioleiro_nome       VARCHAR(200),
    criado_em             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    dt_aceite             TIMESTAMP,
    dt_inicio_transporte  TIMESTAMP,
    dt_conclusao          TIMESTAMP,
    dt_cancelamento       TIMESTAMP,
    motivo_cancelamento   TEXT,
    atualizado_em         TIMESTAMP
);
"""

TIPOS_PADRAO = [
    ('Para Exames',                 'fa-vials',       '#17a2b8', 1),
    ('Entre Setores',               'fa-exchange-alt','#6f42c1', 2),
    ('Entre Unidades de Internacao','fa-bed',          '#fd7e14', 3),
    ('Centro Cirurgico',            'fa-procedures',  '#dc3545', 4),
]

DESTINOS_PADRAO = [
    # Para Exames  (tipo_ordem=1)
    ('Laboratório Central',   1),
    ('Radiologia',            1),
    ('Tomografia',            1),
    ('Ressonância Magnética', 1),
    ('Ecocardiografia',       1),
    ('Endoscopia',            1),
    # Centro Cirúrgico (tipo_ordem=4)
    ('Centro Cirúrgico - Sala 1', 4),
    ('Centro Cirúrgico - Sala 2', 4),
    ('Centro Cirúrgico - Sala 3', 4),
    ('Centro Cirúrgico - Recuperação', 4),
]


def executar():
    conn = get_db_connection()
    if not conn:
        print('[ERRO] Falha na conexao com o banco.')
        sys.exit(1)

    cursor = conn.cursor()

    print('[1/3] Criando tabelas...')
    cursor.execute(DDL)

    print('[2/3] Inserindo tipos de movimento padrao...')
    cursor.execute("SELECT COUNT(*) FROM padioleiro_tipos_movimento")
    if cursor.fetchone()[0] == 0:
        for nome, icone, cor, ordem in TIPOS_PADRAO:
            cursor.execute(
                "INSERT INTO padioleiro_tipos_movimento (nome, icone, cor, ativo, ordem) "
                "VALUES (%s, %s, %s, TRUE, %s)",
                (nome, icone, cor, ordem)
            )
        print('    Tipos inseridos.')
    else:
        print('    Tipos ja existem, pulando.')

    print('[3/3] Inserindo destinos padrao...')
    cursor.execute("SELECT COUNT(*) FROM padioleiro_destinos")
    if cursor.fetchone()[0] == 0:
        for nome_dest, tipo_ordem in DESTINOS_PADRAO:
            cursor.execute(
                "SELECT id FROM padioleiro_tipos_movimento WHERE ordem = %s LIMIT 1",
                (tipo_ordem,)
            )
            row = cursor.fetchone()
            if row:
                cursor.execute(
                    "INSERT INTO padioleiro_destinos (nome, tipo_movimento_id, ativo, ordem) "
                    "VALUES (%s, %s, TRUE, 0)",
                    (nome_dest, row[0])
                )
        print('    Destinos inseridos.')
    else:
        print('    Destinos ja existem, pulando.')

    conn.commit()
    cursor.close()
    conn.close()
    print('\n[OK] Migracao concluida com sucesso.')
    print('     Execute o servidor e acesse:')
    print('       /painel/painel34  - Solicitacao de Padioleiro')
    print('       /painel/painel35  - Tela do Padioleiro')
    print('       /painel/painel36  - Gestao e Relatorios')


if __name__ == '__main__':
    executar()
