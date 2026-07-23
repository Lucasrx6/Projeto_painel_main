# -*- coding: utf-8 -*-
import os
from backend.notificador_utils import setup_notificador_logging, get_db_config, get_smtp_config

# 4 levels up: tests_sistema/ → workers/ → notificadores/ → backend/ → project root
BASE_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))
LOG_DIR  = os.path.join(BASE_DIR, 'logs')

logger = setup_notificador_logging('worker_tests_sistema', 'worker_tests_sistema.log')

DB_CONFIG       = get_db_config()
REDIS_URL       = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
REDIS_MAXMEMORY = os.getenv('REDIS_MAXMEMORY', '256mb')

_smtp      = get_smtp_config()
SMTP_HOST  = _smtp['host']
SMTP_PORT  = _smtp['port']
SMTP_USER  = _smtp['user']
SMTP_PASS  = _smtp['password']
SMTP_FROM  = _smtp['sender']

GCHAT_WEBHOOK = os.getenv('GCHAT_WEBHOOK_PACIENTE_PS', '')

HOP_SERVER_HOST       = os.getenv('HOP_SERVER_HOST', 'localhost')
HOP_SERVER_PORT       = int(os.getenv('HOP_SERVER_PORT', '8080'))
HOP_FRESHNESS_AVISO_H = int(os.getenv('HOP_FRESHNESS_AVISO_H', '4'))
HOP_FRESHNESS_ERRO_H  = int(os.getenv('HOP_FRESHNESS_ERRO_H', '24'))

CPU_AVISO  = int(os.getenv('MONITOR_CPU_AVISO',  '75'))
CPU_ERRO   = int(os.getenv('MONITOR_CPU_ERRO',   '90'))
MEM_AVISO  = int(os.getenv('MONITOR_MEM_AVISO',  '80'))
MEM_ERRO   = int(os.getenv('MONITOR_MEM_ERRO',   '90'))
DISK_AVISO = int(os.getenv('MONITOR_DISK_AVISO', '80'))
DISK_ERRO  = int(os.getenv('MONITOR_DISK_ERRO',  '90'))

DB_CONN_AVISO_PCT    = int(os.getenv('MONITOR_DB_CONN_AVISO',  '70'))
DB_CONN_ERRO_PCT     = int(os.getenv('MONITOR_DB_CONN_ERRO',   '90'))
DB_LATENCIA_AVISO_MS = int(os.getenv('MONITOR_DB_LAT_AVISO',   '500'))
DB_LATENCIA_ERRO_MS  = int(os.getenv('MONITOR_DB_LAT_ERRO',    '2000'))
DB_IDLE_TRANS_MIN    = int(os.getenv('MONITOR_DB_IDLE_MIN',     '5'))
DB_QUERY_LENTA_S     = int(os.getenv('MONITOR_DB_SLOW_S',       '60'))
DISK_LOG_RETENCAO_D  = int(os.getenv('MONITOR_LOG_RETENCAO_D',  '30'))

EMAIL_RELATORIO = 'lucas.oliveira@saofranciscodf.med.br'
INTERVALO_HORAS = 12

TABELAS_CRITICAS = [
    ('usuarios',                   'Usuários do sistema'),
    ('permissoes_paineis',         'Permissões de painéis'),
    ('historico_usuarios',         'Histórico de usuários'),
    ('notificacoes_destinatarios', 'Destinatários de notificações'),
    ('notificacoes_tipos_evento',  'Tipos de evento (Painel26)'),
    ('notificacoes_log',           'Log de notificações'),
    ('notificacoes_historico',     'Histórico de envios'),
    ('painel_ps_analise',          'Dados PS'),
    ('medicos_ps',                 'Médicos ativos no PS'),
    ('painel17_atendimentos_ps',   'Atendimentos PS painel17'),
    ('pareceres_pendentes',        'Pareceres pendentes'),
    ('sentir_agir_responsaveis',   'Responsáveis Sentir e Agir'),
    ('notificacoes_snapshot',      'Snapshot dedup notificações'),
]

VIEWS_CRITICAS = [
    ('vw_ps_dashboard_dia',          'PS dashboard dia'),
    ('vw_ps_tempo_por_clinica',      'PS tempo por clínica'),
    ('vw_ps_aguardando_por_clinica', 'PS aguardando por clínica'),
    ('vw_ps_atendimentos_por_hora',  'PS atendimentos por hora'),
    ('vw_ps_desempenho_medico',      'PS desempenho médico'),
    ('vw_ps_desempenho_recepcao',    'PS desempenho recepção'),
    ('vw_notificacoes_resumo',       'Notificações resumo'),
    ('vw_destinatarios_completo',    'Destinatários completo'),
    ('vw_notificacoes_timeline',     'Timeline de envios'),
]

TIPOS_EVENTO = [
    ('parecer_pendente',       'Pareceres Pendentes'),
    ('paciente_ps_sem_medico', 'Paciente PS Sem Médico'),
]

# Threads daemon esperadas (por nome parcial)
_WORKERS_ESPERADOS = [
    ('notificador_pareceres',      'Notificador Pareceres'),
    ('notificador_sentir_agir',    'Notificador Sentir e Agir'),
    ('worker_sentir_agir_analise', 'Worker Análise IA Groq'),
    ('worker_imap_tratativas',     'Worker IMAP'),
    ('notificador_paciente_ps',    'Notificador Paciente PS'),
    ('worker_tests_sistema',       'Worker Verificação Sistema'),
]
