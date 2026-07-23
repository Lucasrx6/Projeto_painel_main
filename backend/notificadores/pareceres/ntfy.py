# -*- coding: utf-8 -*-
import requests
from .config import logger, NTFY_URL


def enviar_ntfy_topicos(topicos, titulo, mensagem):
    """Envia push para todos os topicos ntfy configurados no banco."""
    if not topicos:
        logger.debug('Nenhum topico ntfy configurado para parecer_pendente')
        return

    enviados = 0
    erros = 0

    for topico in topicos:
        try:
            url = '{}/{}'.format(NTFY_URL, topico)
            resp = requests.post(
                url,
                data=mensagem.encode('utf-8'),
                headers={
                    'Title': titulo.encode('utf-8'),
                    'Priority': '3',
                },
                timeout=10
            )
            if resp.status_code == 200:
                logger.info('ntfy OK: [%s] %s', topico, titulo)
                enviados += 1
            else:
                logger.warning('ntfy [%s] status %s', topico, resp.status_code)
                erros += 1
        except requests.exceptions.Timeout:
            logger.error('Timeout ntfy: %s', topico)
            erros += 1
        except requests.exceptions.ConnectionError:
            logger.error('Conexao recusada ntfy: %s', topico)
            erros += 1
        except Exception as e:
            logger.error('Erro ntfy [%s]: %s', topico, e)
            erros += 1

    if enviados > 0 or erros > 0:
        logger.info('ntfy resumo: %s enviados, %s erros de %s topicos', enviados, erros, len(topicos))
