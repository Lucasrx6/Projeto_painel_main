# -*- coding: utf-8 -*-
from datetime import datetime
from psycopg2.extras import RealDictCursor
from .config import logger
from .banco import get_connection, buscar_topicos_ntfy, dentro_do_horario
from .ntfy import montar_mensagem_ntfy, enviar_ntfy_topicos
from .snapshot import ja_notificado, precisa_renotificar, registrar_notificacao


def verificar_prescricao_pendente(configs):
    """Detecta pacientes sem prescricao e envia para topicos ntfy."""
    config = configs.get('prescricao_pendente')
    if not config:
        return
    if not dentro_do_horario(config):
        return

    conn = get_connection()
    if not conn:
        return

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        agora = datetime.now()
        hoje = agora.strftime('%Y-%m-%d')
        topicos = buscar_topicos_ntfy(conn, 'prescricao_pendente')

        # CENARIO A: Novos sem prescricao (2h-6h)
        cursor.execute("""
            SELECT nr_atendimento, nm_pessoa_fisica, cd_setor_atendimento,
                   nm_setor, cd_unidade, cd_unidade_basica,
                   ds_convenio, nm_guerra, dt_entrada_unid
            FROM painel_enfermaria
            WHERE ie_status_unidade = 'P'
              AND nr_atendimento IS NOT NULL
              AND (nr_prescricao IS NULL OR dt_liberacao_medico IS NULL)
              AND dt_entrada_unid IS NOT NULL
              AND dt_entrada_unid::timestamp >= (NOW() - INTERVAL '6 hours')
              AND dt_entrada_unid::timestamp <= (NOW() - INTERVAL '2 hours')
        """)
        novos_sem = cursor.fetchall()
        notificados_novos = 0

        for pac in novos_sem:
            chave = 'prescricao_novo_{}_{}'.format(hoje, pac['nr_atendimento'])
            if not ja_notificado(conn, chave):
                titulo = montar_mensagem_ntfy(config['titulo_template'], pac)
                mensagem = montar_mensagem_ntfy(config['mensagem_template'], pac)
                sucesso, resposta = enviar_ntfy_topicos(
                    topicos, titulo, mensagem, str(config.get('prioridade_ntfy', 4))
                )
                topicos_str = ','.join(topicos) if topicos else 'nenhum'
                registrar_notificacao(
                    conn, 'prescricao_pendente', chave, dict(pac), topicos_str, sucesso, resposta
                )
                notificados_novos += 1

        # CENARIO B: Existentes sem prescricao (apos 11h)
        notificados_exist = 0

        if agora.hour >= 11:
            cursor.execute("""
                SELECT nr_atendimento, nm_pessoa_fisica, cd_setor_atendimento,
                       nm_setor, cd_unidade, cd_unidade_basica,
                       ds_convenio, nm_guerra, dt_entrada_unid
                FROM painel_enfermaria
                WHERE ie_status_unidade = 'P'
                  AND nr_atendimento IS NOT NULL
                  AND (nr_prescricao IS NULL OR dt_liberacao_medico IS NULL)
                  AND dt_entrada_unid IS NOT NULL
                  AND dt_entrada_unid::timestamp < (NOW() - INTERVAL '6 hours')
            """)
            existentes_sem = cursor.fetchall()

            for pac in existentes_sem:
                chave = 'prescricao_dia_{}_{}'.format(hoje, pac['nr_atendimento'])
                titulo = montar_mensagem_ntfy(config['titulo_template'], pac)
                mensagem = montar_mensagem_ntfy(config['mensagem_template'], pac)
                if not ja_notificado(conn, chave):
                    sucesso, resposta = enviar_ntfy_topicos(
                        topicos, titulo, mensagem, str(config.get('prioridade_ntfy', 4))
                    )
                    topicos_str = ','.join(topicos) if topicos else 'nenhum'
                    registrar_notificacao(
                        conn, 'prescricao_pendente', chave, dict(pac), topicos_str, sucesso, resposta
                    )
                    notificados_exist += 1
                elif precisa_renotificar(conn, chave, config):
                    sucesso, resposta = enviar_ntfy_topicos(
                        topicos, titulo, mensagem, str(config.get('prioridade_ntfy', 4))
                    )
                    topicos_str = ','.join(topicos) if topicos else 'nenhum'
                    registrar_notificacao(
                        conn, 'prescricao_pendente', chave, dict(pac), topicos_str, sucesso, resposta
                    )
                    notificados_exist += 1

        cursor.close()

        total = notificados_novos + notificados_exist
        if total > 0:
            logger.info('[prescricao] %s notificacoes (novos: %s, exist: %s) -> %s topicos',
                        total, notificados_novos, notificados_exist, len(topicos))
        else:
            logger.info('[prescricao_pendente] Nenhuma notificacao necessaria')

    except Exception as e:
        logger.error('[prescricao_pendente] Erro: %s', e)
    finally:
        conn.close()
