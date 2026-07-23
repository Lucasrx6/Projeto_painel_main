# -*- coding: utf-8 -*-
import apprise
from datetime import datetime
from urllib.parse import quote as url_encode
from backend.notificador_utils import render_email
from .config import logger, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, APP_BASE_URL


def _formatar_data(valor):
    """Formata date/datetime para DD/MM/AAAA."""
    if not valor:
        return '--'
    if hasattr(valor, 'strftime'):
        return valor.strftime('%d/%m/%Y')
    partes = str(valor).split('T')[0].split('-')
    return '{}/{}/{}'.format(partes[2], partes[1], partes[0]) if len(partes) == 3 else str(valor)


def _extrair_obs_item(descricao_problema):
    """
    Extrai observacao especifica do item da descricao_problema.
    Formato: '... | Observacao do item: TEXTO' ou '... | Observacao da visita: TEXTO'
    Retorna (tipo, texto) onde tipo e 'item', 'visita' ou None.
    """
    if not descricao_problema:
        return None, None
    if ' | Observacao do item: ' in descricao_problema:
        texto = descricao_problema.split(' | Observacao do item: ', 1)[1]
        return 'item', texto.strip()
    if ' | Observacao da visita: ' in descricao_problema:
        texto = descricao_problema.split(' | Observacao da visita: ', 1)[1]
        return 'visita', texto.strip()
    return None, None


def montar_email_html(t):
    """Monta email HTML para item CRITICO com bloco de observacao do item."""
    cor = '#dc3545'
    label = 'CRITICO'

    tipo_obs, texto_obs = _extrair_obs_item(t.get('descricao_problema', ''))
    bloco_obs_item = ''
    if texto_obs:
        titulo_obs = 'Observacao sobre este item:' if tipo_obs == 'item' else 'Observacao da visita:'
        bloco_obs_item = (
            '<div style="margin-top:16px;padding:14px 16px;background:#fff0f0;'
            'border-radius:6px;border-left:5px solid #dc3545;">'
            '<p style="margin:0;font-size:12px;color:#dc3545;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;">'
            + titulo_obs + '</p>'
            '<p style="margin:8px 0 0;font-size:14px;color:#333;line-height:1.5;">'
            + texto_obs.replace('\n', '<br>') + '</p>'
            '</div>'
        )

    bloco_link = ''
    if APP_BASE_URL:
        link = '{}/painel/painel30?abrir={}'.format(APP_BASE_URL, t.get('tratativa_id', ''))
        bloco_link = (
            '<div style="text-align:center;margin-top:18px;">'
            '<a href="{link}" style="display:inline-block;padding:10px 24px;background:{cor};'
            'color:white;border-radius:6px;font-weight:bold;text-decoration:none;font-size:14px;">'
            'Abrir Tratativa</a></div>'
        ).format(link=link, cor=cor)

    return render_email('sentir_agir_critico.html',
        cor=cor,
        label=label,
        item=t.get('item_descricao', '-'),
        categoria=t.get('categoria_nome', '-'),
        bloco_obs_item=bloco_obs_item,
        bloco_link=bloco_link,
        paciente=t.get('nm_paciente', 'Nao informado'),
        atendimento=t.get('nr_atendimento', '--') or '--',
        setor=t.get('setor_nome', '-'),
        leito=t.get('leito', '-'),
        data_ronda=_formatar_data(t.get('data_ronda')),
        dupla=t.get('dupla_nome', '-'),
        enviado_em=datetime.now().strftime('%d/%m/%Y %H:%M')
    )


def montar_email_html_atencao(v):
    """Monta email HTML de alerta para visita com avaliacao ATENCAO."""
    cor = '#fd7e14'
    itens = v.get('itens_atencao', [])

    linhas_itens = ''
    for item in itens:
        linhas_itens += (
            '<tr>'
            '<td style="padding:6px 8px;border-bottom:1px solid #ffe8d0;font-size:13px;color:#333;">'
            + item.get('item_descricao', '-') +
            '</td>'
            '<td style="padding:6px 8px;border-bottom:1px solid #ffe8d0;font-size:12px;color:#6c757d;">'
            + item.get('categoria_nome', '-') +
            '</td>'
            '</tr>'
        )
    if not linhas_itens:
        linhas_itens = '<tr><td colspan="2" style="padding:8px;color:#aaa;font-size:12px;">Itens nao identificados</td></tr>'

    obs = v.get('visita_observacoes', '') or ''
    bloco_obs = ''
    if obs:
        bloco_obs = (
            '<div style="margin-top:14px;padding:10px 14px;background:#f8f9fa;'
            'border-radius:4px;border-left:4px solid #6c757d;">'
            '<p style="margin:0;font-size:12px;color:#6c757d;font-weight:bold;">Observacoes da visita:</p>'
            '<p style="margin:6px 0 0;font-size:13px;color:#333;">' + obs.replace('\n', '<br>') + '</p>'
            '</div>'
        )

    return render_email('sentir_agir_atencao.html',
        cor=cor,
        linhas_itens=linhas_itens,
        paciente=v.get('nm_paciente', 'Nao informado'),
        atendimento=v.get('nr_atendimento', '--') or '--',
        setor=v.get('setor_nome', '-'),
        leito=v.get('leito', '-'),
        data_ronda=_formatar_data(v.get('data_ronda')),
        dupla=v.get('dupla_nome', '-'),
        bloco_obs=bloco_obs,
        enviado_em=datetime.now().strftime('%d/%m/%Y %H:%M')
    )


def enviar_email(destinatarios, titulo, corpo_html):
    """Envia email via Apprise para lista de destinatarios."""
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
            url = 'mailtos://{user}:{pwd}@{host}:{port}?from={sender}&to={to}&name=Notificacao+HAC'.format(
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
            return True, 'Email enviado para {} destinatario(s)'.format(len(destinatarios))
        else:
            logger.warning('Falha email para: %s', emails_lista)
            return False, 'Falha no envio para {}'.format(emails_lista)

    except Exception as e:
        logger.error('Erro email: %s', e)
        return False, str(e)
