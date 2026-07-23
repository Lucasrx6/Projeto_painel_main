# -*- coding: utf-8 -*-
from psycopg2.extras import RealDictCursor
from datetime import datetime
from .config import logger


def get_connection():
    try:
        from backend.database import get_db_connection
        return get_db_connection()
    except Exception as e:
        logger.error('Erro ao conectar no banco: %s', e)
        return None


def carregar_configs():
    """Carrega configs da tabela notificacoes_config."""
    conn = get_connection()
    if not conn:
        return {}
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM notificacoes_config WHERE ativo = true")
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        configs = {}
        for row in rows:
            configs[row['tipo_evento']] = dict(row)
        logger.info('Configuracoes carregadas: %s tipos ativos', len(configs))
        return configs
    except Exception as e:
        logger.error('Erro ao carregar configs: %s', e)
        if conn:
            conn.close()
        return {}


def buscar_topicos_ntfy(conn, tipo_evento):
    """Busca topicos ntfy da tabela notificacoes_destinatarios para o tipo dado."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT email AS topico
        FROM notificacoes_destinatarios
        WHERE tipo_evento = %s
          AND canal = 'ntfy'
          AND ativo = true
    """, (tipo_evento,))
    topicos = [row['topico'] for row in cursor.fetchall() if row['topico']]
    cursor.close()
    return topicos


def dentro_do_horario(config):
    """Retorna True se o horario atual esta dentro da janela configurada."""
    agora = datetime.now().time()
    return config['hora_inicio'] <= agora <= config['hora_fim']
