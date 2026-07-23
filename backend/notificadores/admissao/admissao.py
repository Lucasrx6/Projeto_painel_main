# -*- coding: utf-8 -*-
from datetime import datetime
from psycopg2.extras import RealDictCursor
from .config import logger
from .banco import get_connection, buscar_topicos_ntfy, dentro_do_horario
from .ntfy import montar_mensagem_ntfy, enviar_ntfy_topicos
from .snapshot import ja_notificado, registrar_notificacao


def verificar_admissao_nova(configs):
    """Detecta novas admissoes e envia para todos os topicos ntfy."""
    config = configs.get('admissao_nova')
    if not config:
        return
    if not dentro_do_horario(config):
        return

    conn = get_connection()
    if not conn:
        return

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        topicos = buscar_topicos_ntfy(conn, 'admissao_nova')

        cursor.execute("""
            SELECT nr_atendimento, nm_pessoa_fisica, cd_setor_atendimento,
                   nm_setor, cd_unidade, cd_unidade_basica,
                   ds_convenio, nm_guerra, dt_entrada_unid
            FROM painel_enfermaria
            WHERE ie_status_unidade = 'P'
              AND nr_atendimento IS NOT NULL
              AND dt_entrada_unid IS NOT NULL
              AND dt_entrada_unid::timestamp >= (NOW() - INTERVAL '35 minutes')
        """)

        pacientes_novos = cursor.fetchall()
        cursor.close()
        notificados = 0

        for pac in pacientes_novos:
            chave = 'admissao_{}'.format(pac['nr_atendimento'])
            if not ja_notificado(conn, chave):
                # LGPD: canal publico — sem dados de paciente
                titulo = montar_mensagem_ntfy(config['titulo_template'], pac)
                mensagem = montar_mensagem_ntfy(config['mensagem_template'], pac)
                sucesso, resposta = enviar_ntfy_topicos(
                    topicos, titulo, mensagem,
                    str(config.get('prioridade_ntfy', 3))
                )
                topicos_str = ','.join(topicos) if topicos else 'nenhum'
                registrar_notificacao(
                    conn, 'admissao_nova', chave,
                    dict(pac), topicos_str, sucesso, resposta
                )
                notificados += 1

        if notificados > 0:
            logger.info('[admissao_nova] %s notificadas -> %s topicos', notificados, len(topicos))
        else:
            logger.info('[admissao_nova] Nenhuma admissao recente')

    except Exception as e:
        logger.error('[admissao_nova] Erro: %s', e)
    finally:
        conn.close()
