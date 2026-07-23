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


def buscar_destinatarios_email(conn, especialidade=None):
    """
    Busca destinatarios EMAIL por especialidade.
    DISTINCT ON evita duplicatas quando o mesmo email tem varios registros.
    Linhas com especialidade exata têm precedencia sobre NULL (universal).
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT DISTINCT ON (email) nome, email, especialidade
        FROM notificacoes_destinatarios
        WHERE tipo_evento = 'parecer_pendente'
          AND canal = 'email'
          AND ativo = true
          AND (
              especialidade IS NULL
              OR especialidade = %s
          )
        ORDER BY email,
                 (especialidade = %s) DESC NULLS LAST,
                 (especialidade IS NULL) ASC
    """, (especialidade, especialidade))
    destinatarios = cursor.fetchall()
    cursor.close()
    resultado = [dict(d) for d in destinatarios]
    logger.info(
        '[pareceres] Especialidade: "%s" -> %s destinatario(s)',
        especialidade or '(sem especialidade)', len(resultado)
    )
    return resultado


def buscar_topicos_ntfy(conn):
    """Busca topicos ntfy para parecer_pendente."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT email AS topico
        FROM notificacoes_destinatarios
        WHERE tipo_evento = 'parecer_pendente'
          AND canal = 'ntfy'
          AND ativo = true
    """)
    topicos = [row['topico'] for row in cursor.fetchall() if row['topico']]
    cursor.close()
    return topicos
