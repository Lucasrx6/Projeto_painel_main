# -*- coding: utf-8 -*-
import apprise
from datetime import datetime
from urllib.parse import quote as url_encode
from backend.notificador_utils import render_email
from .config import logger, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM


def _anonimizar(nome):
    """LGPD: reduz nome a iniciais + sobrenome. 'Lucas Fernandes' -> 'L Fernandes'"""
    if not nome:
        return nome
    partes = str(nome).strip().split()
    if len(partes) == 1:
        return partes[0][0].upper() + '.'
    iniciais = [p[0].upper() for p in partes[:-1]]
    return ' '.join(iniciais) + ' ' + partes[-1].capitalize()


def montar_email_html(parecer):
    """
    Monta corpo do email HTML.
    LGPD: apenas especialidade e nr_atendimento trafegam — canal externo.
    """
    return render_email('parecer_pendente.html',
        especialidade=parecer.get('especialidade_destino', '-'),
        nr_atendimento=parecer.get('nr_atendimento', '-'),
        enviado_em=datetime.now().strftime('%d/%m/%Y %H:%M')
    )


def enviar_email(destinatarios, titulo, corpo_html):
    """Envia email para lista de destinatarios via Apprise."""
    if not destinatarios:
        logger.warning('Nenhum destinatario email para enviar')
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
            url = 'mailtos://{user}:{pwd}@{host}:{port}?from={sender}&to={to}&name=Notificacao+Tasy'.format(
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
            notify_type=apprise.NotifyType.WARNING
        )

        emails_lista = ', '.join([d['email'] for d in destinatarios])
        if resultado:
            logger.info('Email OK para: %s', emails_lista)
            return True, 'Email enviado para {}'.format(len(destinatarios))
        else:
            logger.warning('Falha email para: %s', emails_lista)
            return False, 'Falha no envio para {}'.format(emails_lista)

    except Exception as e:
        logger.error('Erro email: %s', e)
        return False, str(e)
