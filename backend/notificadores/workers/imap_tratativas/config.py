# -*- coding: utf-8 -*-
import os
import re
from backend.notificador_utils import setup_notificador_logging, get_db_config

DB_CONFIG = get_db_config()

SMTP_USER = os.getenv('SMTP_USER', '')
SMTP_PASS = os.getenv('SMTP_PASS', '')
IMAP_HOST = os.getenv('IMAP_HOST', 'imap.gmail.com')
IMAP_PORT = int(os.getenv('IMAP_PORT', 993))

INTERVALO_HORAS = float(os.getenv('IMAP_REPLY_INTERVALO_H', '1'))
INTERVALO_SEG   = int(INTERVALO_HORAS * 3600)

# Regex que extrai o tratativa_id do assunto: [TRAT:12345]
_TOKEN_RE = re.compile(r'\[TRAT:(\d+)\]', re.IGNORECASE)

logger = setup_notificador_logging('worker_imap_tratativas', 'worker_imap_tratativas.log')
