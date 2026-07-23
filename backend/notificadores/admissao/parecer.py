# -*- coding: utf-8 -*-
import json
from datetime import datetime
from psycopg2.extras import RealDictCursor
from .config import logger
from .banco import get_connection, buscar_topicos_ntfy, dentro_do_horario
from .ntfy import montar_mensagem_ntfy, enviar_ntfy_topicos
from .snapshot import registrar_notificacao


def verificar_parecer_pendente(configs):
    """Detecta transicao de parecer e envia para topicos ntfy."""
    config = configs.get('parecer_pendente')
    if not config:
        return
    if not dentro_do_horario(config):
        return

    conn = get_connection()
    if not conn:
        return

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        topicos = buscar_topicos_ntfy(conn, 'parecer_pendente')

        cursor.execute("""
            SELECT nr_atendimento, nm_pessoa_fisica, cd_setor_atendimento,
                   nm_setor, cd_unidade, cd_unidade_basica,
                   ds_convenio, nm_guerra, parecer_pendente
            FROM painel_enfermaria
            WHERE ie_status_unidade = 'P' AND nr_atendimento IS NOT NULL
        """)
        pacientes_atuais = cursor.fetchall()

        cursor.execute("""
            SELECT nr_atendimento, dados_snapshot
            FROM notificacoes_snapshot WHERE tipo_snapshot = 'parecer_estado'
        """)
        snapshot_rows = cursor.fetchall()
        estado_anterior = {}
        for row in snapshot_rows:
            dados = row['dados_snapshot'] if row['dados_snapshot'] else {}
            estado_anterior[row['nr_atendimento']] = dados.get('parecer_pendente', 'Nao')

        notificados = 0

        for pac in pacientes_atuais:
            nr_atend = pac['nr_atendimento']
            parecer_atual = pac.get('parecer_pendente', 'Nao')
            parecer_anterior = estado_anterior.get(nr_atend, 'Nao')

            if parecer_atual == 'Sim' and parecer_anterior != 'Sim':
                chave = 'parecer_{}_{}'.format(nr_atend, datetime.now().strftime('%Y%m%d_%H%M'))
                # LGPD: canal publico — sem dados de paciente
                titulo = montar_mensagem_ntfy(config['titulo_template'], pac)
                mensagem = montar_mensagem_ntfy(config['mensagem_template'], pac)
                sucesso, resposta = enviar_ntfy_topicos(
                    topicos, titulo, mensagem,
                    str(config.get('prioridade_ntfy', 3))
                )
                topicos_str = ','.join(topicos) if topicos else 'nenhum'
                registrar_notificacao(
                    conn, 'parecer_pendente', chave,
                    dict(pac), topicos_str, sucesso, resposta
                )
                notificados += 1

        cursor.execute("DELETE FROM notificacoes_snapshot WHERE tipo_snapshot = 'parecer_estado'")
        for pac in pacientes_atuais:
            cursor.execute("""
                INSERT INTO notificacoes_snapshot (tipo_snapshot, nr_atendimento, dados_snapshot)
                VALUES ('parecer_estado', %s, %s)
            """, (pac['nr_atendimento'], json.dumps({'parecer_pendente': pac.get('parecer_pendente', 'Nao')})))
        conn.commit()

        if notificados > 0:
            logger.info('[parecer_pendente] %s detectados -> %s topicos', notificados, len(topicos))
        else:
            logger.info('[parecer_pendente] Nenhuma transicao')

    except Exception as e:
        logger.error('[parecer_pendente] Erro: %s', e)
    finally:
        conn.close()
