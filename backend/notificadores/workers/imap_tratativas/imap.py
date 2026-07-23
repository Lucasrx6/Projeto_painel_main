# -*- coding: utf-8 -*-
import imaplib
import email
import email.header
import re
from .config import IMAP_HOST, IMAP_PORT, SMTP_USER, SMTP_PASS

_DIAS_PT  = ['seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sab.', 'dom.']
_MESES_PT = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.',
             'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.']


def _formatar_data_email(date_header):
    """Converte header Date do email em formato legivel: sex., 22 de mai. de 2026 as 10:09,"""
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(date_header)
        return '{}, {} de {} de {} as {:02d}:{:02d},'.format(
            _DIAS_PT[dt.weekday()],
            dt.day,
            _MESES_PT[dt.month - 1],
            dt.year,
            dt.hour,
            dt.minute
        )
    except Exception:
        return ''


def _decodificar_header(valor):
    """Decodifica header MIME encoded-words."""
    if not valor:
        return ''
    partes = email.header.decode_header(valor)
    resultado = []
    for parte, charset in partes:
        if isinstance(parte, bytes):
            resultado.append(parte.decode(charset or 'utf-8', errors='replace'))
        else:
            resultado.append(parte)
    return ''.join(resultado)


def _extrair_texto_reply(msg):
    """
    Extrai apenas o texto novo da resposta.
    Ignora quoted text (linhas com ">") e cabecalhos de reply.
    Trunca em 2000 chars.
    """
    corpo = ''

    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == 'text/plain':
                try:
                    corpo = part.get_payload(decode=True).decode(
                        part.get_content_charset() or 'utf-8', errors='replace'
                    )
                    break
                except Exception:
                    pass
    else:
        try:
            corpo = msg.get_payload(decode=True).decode(
                msg.get_content_charset() or 'utf-8', errors='replace'
            )
        except Exception:
            corpo = str(msg.get_payload())

    linhas = []
    for linha in corpo.splitlines():
        if linha.startswith('>'):
            break
        if re.match(r'^(On |Em |De:|From:).{0,120}(wrote:|escreveu:)', linha, re.IGNORECASE):
            break
        if re.match(r'^Em \w{2,4}\.,?\s+\d{1,2} de ', linha):
            break
        linhas.append(linha)

    return '\n'.join(linhas).strip()[:2000]


def conectar_imap():
    imap = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    imap.login(SMTP_USER, SMTP_PASS)
    return imap
