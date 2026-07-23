# -*- coding: utf-8 -*-
import json
from datetime import datetime
from .config import logger


def registrar_log(conn, nr_parecer, nr_atendimento, especialidade, destinatarios, topicos, sucesso, resposta):
    """Registra notificacao no log com detalhes de destinatarios e topicos."""
    cursor = conn.cursor()
    agora = datetime.now()
    chave = 'parecer_email_{}_{}'.format(nr_parecer, agora.strftime('%Y%m%d'))

    cursor.execute("""
        SELECT id FROM notificacoes_log
        WHERE chave_evento = %s AND status = 'notificado'
        LIMIT 1
    """, (chave,))

    if cursor.fetchone():
        cursor.close()
        return

    emails = ', '.join([d['email'] for d in destinatarios]) if destinatarios else 'nenhum'
    topicos_str = ', '.join(topicos) if topicos else 'nenhum'

    dados_extra = json.dumps({
        'destinatarios_email': emails,
        'topicos_ntfy': topicos_str,
        'especialidade': especialidade or 'geral'
    })

    cursor.execute("""
        INSERT INTO notificacoes_log
            (tipo_evento, chave_evento, nr_atendimento, nm_setor,
             dados_extra, topico_ntfy, status, dt_detectado,
             dt_primeira_notificacao, dt_ultima_notificacao,
             qt_notificacoes, resposta_ntfy)
        VALUES
            (%s, %s, %s, %s,
             %s, %s, %s, %s,
             %s, %s,
             %s, %s)
    """, (
        'parecer_email', chave, nr_atendimento, especialidade,
        dados_extra,
        topicos_str,
        'notificado' if sucesso else 'erro',
        agora,
        agora if sucesso else None,
        agora if sucesso else None,
        1 if sucesso else 0,
        resposta
    ))

    conn.commit()
    cursor.close()
