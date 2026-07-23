# -*- coding: utf-8 -*-
import requests
from .config import logger, NTFY_URL


def montar_mensagem(template, dados):
    """Substitui {setor}, {leito}, {paciente}, {atendimento}. Uso interno apenas."""
    if not template:
        return ''
    resultado = template
    resultado = resultado.replace('{setor}', str(dados.get('nm_setor', '-')))
    resultado = resultado.replace('{leito}', str(dados.get('cd_unidade', '-')))
    resultado = resultado.replace('{paciente}', str(dados.get('nm_pessoa_fisica', '-')))
    resultado = resultado.replace('{atendimento}', str(dados.get('nr_atendimento', '-')))
    return resultado


def montar_mensagem_ntfy(template, dados):
    """
    Monta mensagem para canal publico (ntfy) — LGPD Art. 6, principio da minimizacao.
    {paciente} e {atendimento} sao BLOQUEADOS: ntfy e servico publico sem criptografia.
    """
    if not template:
        return ''
    resultado = template
    resultado = resultado.replace('{setor}', str(dados.get('nm_setor', '-')))
    resultado = resultado.replace('{leito}', str(dados.get('cd_unidade', '-')))
    resultado = resultado.replace('{paciente}', '[PROTEGIDO]')
    resultado = resultado.replace('{atendimento}', '[PROTEGIDO]')
    return resultado


def enviar_ntfy_topicos(topicos, titulo, mensagem, prioridade='3'):
    """Envia notificacao para todos os topicos ntfy configurados."""
    if not topicos:
        logger.debug('Nenhum topico ntfy configurado')
        return True, 'Sem topicos ntfy'

    enviados = 0
    erros = 0
    erros_detalhe = []

    for topico in topicos:
        url = '{}/{}'.format(NTFY_URL, topico)
        headers = {
            'Title': titulo.encode('utf-8'),
            'Priority': str(prioridade),
        }
        try:
            resp = requests.post(
                url,
                data=mensagem.encode('utf-8'),
                headers=headers,
                timeout=10
            )
            if resp.status_code == 200:
                logger.info('ntfy OK: [%s] %s', topico, titulo)
                enviados += 1
            else:
                logger.warning('ntfy [%s] status %s', topico, resp.status_code)
                erros += 1
                erros_detalhe.append('[{}] HTTP {}'.format(topico, resp.status_code))
        except requests.exceptions.Timeout:
            logger.error('Timeout ntfy: %s', topico)
            erros += 1
            erros_detalhe.append('[{}] Timeout'.format(topico))
        except requests.exceptions.ConnectionError:
            logger.error('Conexao recusada ntfy: %s', topico)
            erros += 1
            erros_detalhe.append('[{}] Conexao recusada'.format(topico))
        except Exception as e:
            logger.error('Erro ntfy [%s]: %s', topico, e)
            erros += 1
            erros_detalhe.append('[{}] {}'.format(topico, str(e)))

    if erros > 0:
        resposta = 'ntfy: {} OK, {} erros - {}'.format(enviados, erros, '; '.join(erros_detalhe))
    else:
        resposta = 'ntfy: {} enviados para {} topicos'.format(enviados, len(topicos))

    return erros == 0, resposta
