# -*- coding: utf-8 -*-
import os
from backend.notificador_utils import setup_notificador_logging, get_db_config, get_smtp_config

DB_CONFIG = get_db_config()

_smtp = get_smtp_config()
SMTP_HOST = _smtp['host']
SMTP_PORT = _smtp['port']
SMTP_USER = _smtp['user']
SMTP_PASS = _smtp['password']
SMTP_FROM = _smtp['sender']

INTERVALO_VERIFICACAO = int(os.getenv('NOTIF_SENTIR_AGIR_INTERVALO_MIN', '5'))
APP_BASE_URL = os.getenv('APP_BASE_URL', '').rstrip('/')

logger = setup_notificador_logging('notificador_sentir_agir', 'notificador_sentir_agir.log')
