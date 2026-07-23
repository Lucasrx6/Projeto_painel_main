# -*- coding: utf-8 -*-
import apprise
import json
import requests
from datetime import datetime
from urllib.parse import quote as url_encode
from backend.notificador_utils import render_email
from .config import (logger, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM,
                     GCHAT_WEBHOOK_PS, ESPERA_MIN_ALERTA, INTERVALO_MIN)


def montar_email_html(alertas):
    """Monta email HTML agrupando todas as clinicas em alerta."""
    agora = datetime.now().strftime('%d/%m/%Y %H:%M')
    linhas_tabela = ''
    for a in alertas:
        cor_espera = '#28a745' if a['max_espera_min'] < 20 else ('#ffc107' if a['max_espera_min'] < 40 else '#dc3545')
        linhas_tabela += """
            <tr>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600;">{clinica}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center;">
                    <span style="background:#fff3cd;color:#856404;padding:3px 10px;border-radius:4px;font-weight:700;">
                        {qt}
                    </span>
                </td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center;">
                    <span style="background:{cor};color:white;padding:3px 10px;border-radius:4px;font-weight:700;">
                        {espera} min
                    </span>
                </td>
            </tr>
        """.format(clinica=a['ds_clinica'], qt=a['qt_aguardando'], cor=cor_espera, espera=a['max_espera_min'])
    return render_email('paciente_ps_alertas.html',
        agora=agora,
        qt_clinicas=len(alertas),
        espera_min=ESPERA_MIN_ALERTA,
        linhas=linhas_tabela,
        intervalo=INTERVALO_MIN
    )


def enviar_email(destinatarios, titulo, corpo_html):
    if not destinatarios:
        logger.warning('Nenhum destinatario email configurado para paciente_ps_sem_medico')
        return False, 'Sem destinatarios'

    if not SMTP_USER or not SMTP_PASS:
        logger.error('SMTP nao configurado no .env')
        return False, 'SMTP nao configurado'

    try:
        ap = apprise.Apprise()
        user_encoded = url_encode(SMTP_USER, safe='')
        pass_encoded = url_encode(SMTP_PASS, safe='')
        from_addr = SMTP_FROM if SMTP_FROM else SMTP_USER

        for dest in destinatarios:
            url = 'mailtos://{user}:{pwd}@{host}:{port}?from={sender}&to={to}&name=Notificacao+PS'.format(
                user=user_encoded, pwd=pass_encoded,
                host=SMTP_HOST, port=SMTP_PORT,
                sender=url_encode(from_addr, safe=''),
                to=url_encode(dest['email'], safe='')
            )
            ap.add(url)

        resultado = ap.notify(
            title=titulo,
            body=corpo_html,
            body_format=apprise.NotifyFormat.HTML,
            notify_type=apprise.NotifyType.FAILURE
        )

        emails_lista = ', '.join([d['email'] for d in destinatarios])
        if resultado:
            logger.info('Email PS OK para: %s', emails_lista)
            return True, 'Enviado para {}'.format(len(destinatarios))
        else:
            logger.warning('Falha email PS para: %s', emails_lista)
            return False, 'Falha no envio'

    except Exception as e:
        logger.error('Erro email PS: %s', e)
        return False, str(e)


def montar_mensagem_gchat(alertas):
    """Monta mensagem texto/markdown para Google Chat."""
    agora = datetime.now().strftime('%d/%m/%Y %H:%M')
    linhas = ['• *{}*  —  {} aguardando  —  max {}min'.format(
        a['ds_clinica'], a['qt_aguardando'], a['max_espera_min']
    ) for a in alertas]
    return (
        'ALERTA PS - Paciente sem Medico\n'
        'Hospital Anchieta Ceilandia - {agora}\n\n'
        '*{qt} clinica(s)* com paciente aguardando >={espera}min sem medico:\n\n'
        '{linhas}\n\n'
        'Repete a cada {intervalo}min enquanto a condicao persistir.'
    ).format(agora=agora, qt=len(alertas), espera=ESPERA_MIN_ALERTA,
             linhas='\n'.join(linhas), intervalo=INTERVALO_MIN)


def enviar_gchat(alertas):
    """Envia alerta para Google Chat via webhook (GCHAT_WEBHOOK_PACIENTE_PS)."""
    if not GCHAT_WEBHOOK_PS:
        return False, 'Webhook nao configurado'
    try:
        mensagem = montar_mensagem_gchat(alertas)
        resp = requests.post(GCHAT_WEBHOOK_PS, json={'text': mensagem}, timeout=10)
        resp.raise_for_status()
        logger.info('[paciente_ps] Google Chat OK (status %s)', resp.status_code)
        return True, 'Google Chat enviado (HTTP {})'.format(resp.status_code)
    except requests.exceptions.HTTPError as e:
        logger.error('[paciente_ps] Google Chat HTTP erro: %s', e)
        return False, 'HTTP {}'.format(e.response.status_code if e.response else str(e))
    except Exception as e:
        logger.error('[paciente_ps] Erro Google Chat: %s', e)
        return False, str(e)
