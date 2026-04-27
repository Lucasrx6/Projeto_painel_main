#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Migracao: Integracao do Sistema Padioleiro no Hub (painel28)
- Adiciona coluna permissao_requerida em hub_servicos
- Insere cards dos paineis 34, 35 e 36
Execucao unica: python scripts/migrate_hub_padioleiro.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
from backend.database import get_db_connection


def run():
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. Adiciona coluna permissao_requerida se ainda nao existir
    cursor.execute("""
        ALTER TABLE hub_servicos
        ADD COLUMN IF NOT EXISTS permissao_requerida VARCHAR(50) DEFAULT NULL
    """)
    print("[OK] Coluna permissao_requerida garantida em hub_servicos")

    # Garante que a sequence esta sincronizada com o max id atual
    cursor.execute("SELECT setval('hub_servicos_id_seq', (SELECT COALESCE(MAX(id), 0) FROM hub_servicos))")
    print("[OK] Sequence hub_servicos_id_seq sincronizada")

    # 2. Cards do sistema padioleiro
    cards = [
        {
            'nome': 'Solicitar Padioleiro',
            'descricao': 'Solicite transporte de paciente por padioleiro',
            'icone': 'fas fa-wheelchair',
            'cor': '#e74c3c',
            'url_destino': '/painel/painel34',
            'tipo': 'painel',
            'ordem': 50,
            'permissao_requerida': 'painel34',
        },
        {
            'nome': 'Painel do Padioleiro',
            'descricao': 'Fila de chamados e execucao de transportes',
            'icone': 'fas fa-running',
            'cor': '#f39c12',
            'url_destino': '/painel/painel35',
            'tipo': 'painel',
            'ordem': 51,
            'permissao_requerida': 'painel35',
        },
        {
            'nome': 'Gestao Padioleiro',
            'descricao': 'Relatorios, analytics e configuracoes do sistema',
            'icone': 'fas fa-chart-bar',
            'cor': '#27ae60',
            'url_destino': '/painel/painel36',
            'tipo': 'painel',
            'ordem': 52,
            'permissao_requerida': 'painel36',
        },
    ]

    for card in cards:
        # Verifica se ja existe pelo url_destino para ser idempotente
        cursor.execute(
            "SELECT id FROM hub_servicos WHERE url_destino = %s",
            (card['url_destino'],)
        )
        existente = cursor.fetchone()

        if existente:
            cursor.execute("""
                UPDATE hub_servicos SET
                    nome = %s, descricao = %s, icone = %s, cor = %s,
                    tipo = %s, ordem = %s, permissao_requerida = %s,
                    ativo = TRUE
                WHERE id = %s
            """, (
                card['nome'], card['descricao'], card['icone'], card['cor'],
                card['tipo'], card['ordem'], card['permissao_requerida'],
                existente[0]
            ))
            print(f"[OK] Atualizado: {card['nome']}")
        else:
            cursor.execute("""
                INSERT INTO hub_servicos
                    (nome, descricao, icone, cor, url_destino, tipo, ordem, ativo, permissao_requerida)
                VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, %s)
            """, (
                card['nome'], card['descricao'], card['icone'], card['cor'],
                card['url_destino'], card['tipo'], card['ordem'],
                card['permissao_requerida']
            ))
            print(f"[OK] Inserido: {card['nome']}")

    conn.commit()
    cursor.close()
    conn.close()
    print("\nMigracao concluida com sucesso.")


if __name__ == '__main__':
    run()
