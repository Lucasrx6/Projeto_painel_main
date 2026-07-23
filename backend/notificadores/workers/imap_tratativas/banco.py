# -*- coding: utf-8 -*-
import psycopg2
from psycopg2.extras import RealDictCursor
from .config import logger, DB_CONFIG


def _get_conn():
    return psycopg2.connect(**DB_CONFIG)


def processar_resposta(conn, tratativa_id, remetente, corpo, data_email=''):
    """
    Atualiza tratativa com dados da resposta por email.

    Campos atualizados em sentir_agir_tratativas:
      - status                -> 'em_tratativa'
      - observacoes_resolucao <- texto da resposta + data formatada do email
      - data_inicio_tratativa <- NOW() se ainda nao preenchido

    Tambem atualiza status_tratativa da visita pai e registra auditoria.
    Retorna True se atualizou com sucesso.
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute(
        "SELECT id, status, visita_id FROM sentir_agir_tratativas WHERE id = %s",
        (tratativa_id,)
    )
    tratativa = cursor.fetchone()

    if not tratativa:
        logger.warning('[IMAP] Tratativa #%d nao encontrada no banco', tratativa_id)
        cursor.close()
        return False

    if tratativa['status'] in ('regularizado', 'cancelado', 'em_tratativa'):
        logger.info('[IMAP] Tratativa #%d ja esta com status "%s" — resposta ignorada',
                    tratativa_id, tratativa['status'])
        cursor.close()
        return False

    texto_resposta = corpo or '(Resposta sem texto extraivel)'
    obs_completa = '{}\n\n{}'.format(texto_resposta, data_email).strip()

    cursor.execute("""
        UPDATE sentir_agir_tratativas
        SET
            status                = 'em_tratativa',
            observacoes_resolucao = %s,
            data_inicio_tratativa = COALESCE(data_inicio_tratativa, NOW()),
            atualizado_em         = NOW()
        WHERE id = %s
    """, (obs_completa[:3000], tratativa_id))

    cursor.execute("""
        INSERT INTO sentir_agir_log
            (entidade, entidade_id, acao, campo_alterado,
             valor_anterior, valor_novo, usuario, ip_origem)
        VALUES ('tratativa', %s, 'resposta_email', 'status',
                %s, 'em_tratativa', %s, 'imap_worker')
    """, (tratativa_id, tratativa['status'], remetente[:200]))

    visita_id = tratativa['visita_id']
    cursor.execute("""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'pendente'      THEN 1 ELSE 0 END) AS pendentes,
            SUM(CASE WHEN status = 'em_tratativa'  THEN 1 ELSE 0 END) AS em_tratativa
        FROM sentir_agir_tratativas
        WHERE visita_id = %s
    """, (visita_id,))
    stats = cursor.fetchone()

    total        = stats['total']        or 0
    pendentes    = stats['pendentes']    or 0
    em_tratativa = stats['em_tratativa'] or 0

    if total == 0:
        novo_status_visita = 'sem_pendencia'
    elif pendentes > 0:
        novo_status_visita = 'pendente'
    elif em_tratativa > 0:
        novo_status_visita = 'em_tratativa'
    else:
        novo_status_visita = 'regularizado'

    cursor.execute("""
        UPDATE sentir_agir_visitas
        SET status_tratativa = %s, atualizado_em = NOW()
        WHERE id = %s
    """, (novo_status_visita, visita_id))

    conn.commit()
    cursor.close()

    logger.info('[IMAP] Tratativa #%d em tratativa via resposta email | Remetente: %s | Status visita: %s',
                tratativa_id, remetente, novo_status_visita)
    return True
