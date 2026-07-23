# -*- coding: utf-8 -*-
import os
from backend.notificador_utils import setup_notificador_logging, get_db_config

DB_CONFIG = get_db_config()
NTFY_URL = os.getenv('NTFY_URL', 'https://ntfy.sh')
INTERVALO_VERIFICACAO = int(os.getenv('NOTIF_INTERVALO_MIN', '15'))

logger = setup_notificador_logging('notificador', 'notificador.log')
