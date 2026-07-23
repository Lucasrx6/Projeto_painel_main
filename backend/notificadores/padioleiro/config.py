# -*- coding: utf-8 -*-
import os
from backend.notificador_utils import setup_notificador_logging

_BASE_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
os.makedirs(os.path.join(_BASE_DIR, 'logs'), exist_ok=True)

logger = setup_notificador_logging('notificador_padioleiro', 'notificador_padioleiro.log')


def _cfg():
    """Lida com configuracao dinamicamente (chamado em cada ciclo para capturar mudancas no .env)."""
    emails_raw   = os.getenv('NOTIF_PADIOLEIRO_EMAILS', '')
    horarios_raw = os.getenv('NOTIF_PADIOLEIRO_HORARIOS', '06:00,18:00')
    return {
        'destinatarios': [e.strip() for e in emails_raw.split(',') if e.strip()],
        'horarios':      [h.strip() for h in horarios_raw.split(',') if h.strip()],
    }
