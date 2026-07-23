# -*- coding: utf-8 -*-
import json
from datetime import datetime, timedelta
from psycopg2.extras import RealDictCursor
from .config import logger


def ja_notificado(conn, chave_evento):
    """Retorna True se ja existe registro notificado."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT id FROM notificacoes_log
        WHERE chave_evento = %s AND status IN ('notificado', 'pendente')
        LIMIT 1
    """, (chave_evento,))
    existe = cursor.fetchone()
    cursor.close()
    return existe is not None


def precisa_renotificar(conn, chave_evento, config):
    """Verifica se precisa renotificar com base no intervalo configurado."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT id, qt_notificacoes, dt_ultima_notificacao
        FROM notificacoes_log
        WHERE chave_evento = %s AND status = 'notificado'
        ORDER BY dt_detectado DESC LIMIT 1
    """, (chave_evento,))
    registro = cursor.fetchone()
    cursor.close()

    if not registro:
        return False

    max_renotif = config.get('max_renotificacoes', 0)
    intervalo_min = config.get('intervalo_renotificacao_min', 0)

    if max_renotif == 0 or intervalo_min == 0:
        return False
    if registro['qt_notificacoes'] >= (max_renotif + 1):
        return False
    if registro['dt_ultima_notificacao']:
        proxima = registro['dt_ultima_notificacao'] + timedelta(minutes=intervalo_min)
        if datetime.now() < proxima:
            return False
    return True


def registrar_notificacao(conn, tipo_evento, chave_evento, dados, topicos_str, sucesso, resposta):
    """Registra notificacao no log ou atualiza registro existente."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    agora = datetime.now()

    cursor.execute("""
        SELECT id, qt_notificacoes FROM notificacoes_log
        WHERE chave_evento = %s AND status IN ('pendente', 'notificado')
        LIMIT 1
    """, (chave_evento,))
    existente = cursor.fetchone()

    if existente:
        novo_status = 'notificado' if sucesso else 'erro'
        cursor.execute("""
            UPDATE notificacoes_log
            SET dt_ultima_notificacao = %s, qt_notificacoes = qt_notificacoes + 1,
                status = %s, resposta_ntfy = %s
            WHERE id = %s
        """, (agora, novo_status, resposta, existente['id']))
    else:
        novo_status = 'notificado' if sucesso else 'erro'
        dados_extra = json.dumps({
            'topicos_ntfy': topicos_str,
            'setor': dados.get('nm_setor', '-'),
            'convenio': dados.get('ds_convenio', '-')
        })
        cursor.execute("""
            INSERT INTO notificacoes_log
                (tipo_evento, chave_evento, nr_atendimento, nm_paciente,
                 cd_setor_atendimento, nm_setor, cd_unidade, dados_extra,
                 topico_ntfy, status, dt_detectado,
                 dt_primeira_notificacao, dt_ultima_notificacao,
                 qt_notificacoes, resposta_ntfy)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            tipo_evento, chave_evento,
            dados.get('nr_atendimento'), dados.get('nm_pessoa_fisica'),
            dados.get('cd_setor_atendimento'), dados.get('nm_setor'),
            dados.get('cd_unidade'), dados_extra,
            topicos_str, novo_status, agora,
            agora if sucesso else None,
            agora if sucesso else None,
            1 if sucesso else 0, resposta
        ))

    conn.commit()
    cursor.close()
