# -*- coding: utf-8 -*-
from psycopg2.extras import RealDictCursor
from .config import logger


def get_connection():
    try:
        from backend.database import get_db_connection
        return get_db_connection()
    except Exception as e:
        logger.error('Erro ao conectar no banco: %s', e)
        return None


def buscar_tratativas_pendentes(conn):
    """Retorna tratativas pendentes de itens criticos com todos os campos do email."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT
            t.id AS tratativa_id,
            t.status,
            t.criado_em,
            t.descricao_problema,
            i.descricao AS item_descricao,
            c.nome AS categoria_nome,
            c.id AS categoria_id,
            v.id AS visita_id,
            v.nm_paciente,
            v.nr_atendimento,
            v.leito,
            v.avaliacao_final,
            v.observacoes AS visita_observacoes,
            r.data_ronda,
            s.nome AS setor_nome,
            s.sigla AS setor_sigla,
            s.id AS setor_id,
            d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS dupla_nome
        FROM sentir_agir_tratativas t
        JOIN sentir_agir_visitas v ON v.id = t.visita_id
        JOIN sentir_agir_rondas r ON r.id = v.ronda_id
        JOIN sentir_agir_itens i ON i.id = t.item_id
        JOIN sentir_agir_categorias c ON c.id = i.categoria_id
        JOIN sentir_agir_setores s ON s.id = v.setor_id
        JOIN sentir_agir_duplas d ON d.id = r.dupla_id
        WHERE t.status = 'pendente'
    """)
    rows = cursor.fetchall()
    cursor.close()
    return [dict(r) for r in rows]


def buscar_visitas_atencao(conn):
    """Retorna visitas com avaliacao_final='atencao' incluindo itens marcados como atencao."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT
            v.id AS visita_id,
            v.nm_paciente,
            v.nr_atendimento,
            v.leito,
            v.observacoes AS visita_observacoes,
            v.criado_em,
            r.data_ronda,
            s.nome AS setor_nome,
            s.sigla AS setor_sigla,
            s.id AS setor_id,
            d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS dupla_nome
        FROM sentir_agir_visitas v
        JOIN sentir_agir_rondas r ON r.id = v.ronda_id
        JOIN sentir_agir_setores s ON s.id = v.setor_id
        JOIN sentir_agir_duplas d ON d.id = r.dupla_id
        WHERE v.avaliacao_final = 'atencao'
    """)
    visitas = [dict(r) for r in cursor.fetchall()]
    for v in visitas:
        cursor.execute("""
            SELECT i.descricao AS item_descricao, c.nome AS categoria_nome, c.id AS categoria_id
            FROM sentir_agir_avaliacoes a
            JOIN sentir_agir_itens i ON i.id = a.item_id
            JOIN sentir_agir_categorias c ON c.id = i.categoria_id
            WHERE a.visita_id = %s AND a.resultado = 'atencao'
            ORDER BY c.ordem, i.ordem
        """, (v['visita_id'],))
        v['itens_atencao'] = [dict(r) for r in cursor.fetchall()]
    cursor.close()
    return visitas


def buscar_responsaveis(conn, categoria_id, setor_id):
    """
    Busca responsaveis com email por categoria ou setor.
    Para critico (categoria_id informado): responsaveis da categoria filtrados por setor (se vinculado).
    Para atencao (categoria_id None): responsaveis do setor diretamente.
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    if categoria_id is not None:
        cursor.execute("""
            SELECT DISTINCT ON (r.email) r.nome, r.email
            FROM sentir_agir_responsaveis r
            JOIN sentir_agir_responsavel_categorias rc ON rc.responsavel_id = r.id
            LEFT JOIN sentir_agir_responsavel_setores rs ON rs.responsavel_id = r.id
            WHERE r.ativo = true
              AND r.email IS NOT NULL
              AND r.email <> ''
              AND rc.categoria_id = %s
              AND (
                  NOT EXISTS (SELECT 1 FROM sentir_agir_responsavel_setores rs2 WHERE rs2.responsavel_id = r.id)
                  OR rs.setor_id = %s
              )
            ORDER BY r.email
            LIMIT 10
        """, (categoria_id, setor_id))
    else:
        cursor.execute("""
            SELECT DISTINCT ON (r.email) r.nome, r.email
            FROM sentir_agir_responsaveis r
            JOIN sentir_agir_responsavel_setores rs ON rs.responsavel_id = r.id
            WHERE r.ativo = true
              AND r.email IS NOT NULL
              AND r.email <> ''
              AND rs.setor_id = %s
            ORDER BY r.email
            LIMIT 10
        """, (setor_id,))
    responsaveis = cursor.fetchall()
    cursor.close()
    return [dict(r) for r in responsaveis]
