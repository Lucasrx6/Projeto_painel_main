# -*- coding: utf-8 -*-
import json
from datetime import datetime
from .config import logger


def _chave_tratativa(tratativa_id):
    return 'sentir_agir_trat_{}'.format(tratativa_id)


def _chave_atencao(visita_id):
    return 'sentir_agir_atencao_{}'.format(visita_id)


def ja_notificado_por_chave(conn, chave):
    """Retorna True se essa chave ja foi notificada com sucesso."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id FROM notificacoes_log
        WHERE chave_evento = %s AND status = 'notificado'
        LIMIT 1
    """, (chave,))
    existe = cursor.fetchone() is not None
    cursor.close()
    return existe


def ja_notificado(conn, tratativa_id):
    return ja_notificado_por_chave(conn, _chave_tratativa(tratativa_id))


def registrar_log_chave(conn, tipo_evento, chave, nr_atendimento, categoria, setor, destinatarios, sucesso, resposta):
    """Insere registro no log pela chave fornecida."""
    cursor = conn.cursor()
    agora = datetime.now()
    emails = ', '.join([d['email'] for d in destinatarios]) if destinatarios else 'nenhum'
    dados_extra = json.dumps({
        'destinatarios_email': emails,
        'categoria': categoria or '',
        'setor': setor or ''
    }, ensure_ascii=False)

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
        tipo_evento, chave, str(nr_atendimento or ''), setor,
        dados_extra, '',
        'notificado' if sucesso else 'erro',
        agora,
        agora if sucesso else None,
        agora if sucesso else None,
        1 if sucesso else 0,
        resposta
    ))
    conn.commit()
    cursor.close()


def registrar_log(conn, tratativa_id, nr_atendimento, categoria, setor, destinatarios, sucesso, resposta):
    """Conveniencia para registrar tratativa critica."""
    registrar_log_chave(
        conn, 'sentir_agir_tratativa', _chave_tratativa(tratativa_id),
        nr_atendimento, categoria, setor, destinatarios, sucesso, resposta
    )
