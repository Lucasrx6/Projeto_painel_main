# -*- coding: utf-8 -*-
import os
from backend.notificador_utils import setup_notificador_logging, get_db_config

GROQ_API_KEY = os.getenv('GROQ_API_KEY', '')
GROQ_MODEL = 'llama-3.3-70b-versatile'
HORARIO_EXECUCAO = '18:00'
DIAS_RETROATIVOS = 7
HORARIO_SEMANAL = os.getenv('WORKER_SENTIR_AGIR_SEMANAL_HORA', '08:00')
PERIODO_SEMANAL_DIAS = int(os.getenv('WORKER_SENTIR_AGIR_SEMANAL_DIAS', '7'))

DB_CONFIG = get_db_config()

logger = setup_notificador_logging('worker_sentir_agir_analise', 'worker_sentir_agir_analise.log')
logger.propagate = False  # evita duplicacao: nao sobe para o root logger do Flask
