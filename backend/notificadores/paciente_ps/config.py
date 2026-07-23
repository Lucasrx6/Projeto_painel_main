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

INTERVALO_MIN = int(os.getenv('NOTIF_PACIENTE_PS_INTERVALO_MIN', '10'))
COOLDOWN_MIN = INTERVALO_MIN
ESPERA_MIN_ALERTA = 10

GCHAT_WEBHOOK_PS = os.getenv('GCHAT_WEBHOOK_PACIENTE_PS', '')

logger = setup_notificador_logging('notificador_paciente_ps', 'notificador_paciente_ps.log')
