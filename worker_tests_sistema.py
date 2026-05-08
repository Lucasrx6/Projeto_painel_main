# -*- coding: utf-8 -*-
"""
============================================================
  WORKER DE VERIFICAÇÃO E AUTO-REPARO DO SISTEMA
  Hospital Anchieta Ceilandia
============================================================

  Roda a cada 6 horas como thread daemon no Flask.
  Verifica todos os pontos críticos da infraestrutura,
  aplica reparos automáticos onde possível e envia
  email com o relatório de saúde do sistema.

  Categorias monitoradas:
    1. Servidor     — CPU, RAM, Disco, Uptime
    2. Infraestrutura — Redis, SMTP, GChat
    3. Apache HOP   — porta, processo, freshness ETL
    4. PostgreSQL   — tabelas, views, constraints, dados
    5. PG Saúde     — latência, conexões, idle, queries lentas, deadlocks
    6. Notificadores — tipos_evento, destinatários, responsáveis
    7. Workers Flask — threads daemon ativas
    8. Dados operacionais

  Execução manual:
    python worker_tests_sistema.py
    python worker_tests_sistema.py --sem-email
============================================================
"""

import os
import sys
import time
import socket
import json
import glob as _glob
import logging
import logging.handlers
import threading
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(BASE_DIR, '.env'))

# ─────────────────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────────────────

LOG_DIR = os.path.join(BASE_DIR, 'logs')
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

logger = logging.getLogger('worker_tests_sistema')
logger.setLevel(logging.INFO)

_fh = logging.handlers.RotatingFileHandler(
    os.path.join(LOG_DIR, 'worker_tests_sistema.log'),
    maxBytes=5 * 1024 * 1024, backupCount=3, encoding='utf-8'
)
_fh.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s', '%Y-%m-%d %H:%M:%S'))
logger.addHandler(_fh)

_ch = logging.StreamHandler(sys.stdout)
_ch.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s', '%H:%M:%S'))
logger.addHandler(_ch)


# ─────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────

DB_CONFIG = {
    'host':     os.getenv('DB_HOST', 'localhost'),
    'database': os.getenv('DB_NAME', 'postgres'),
    'user':     os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', ''),
    'port':     os.getenv('DB_PORT', '5432'),
}
REDIS_URL       = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
REDIS_MAXMEMORY = os.getenv('REDIS_MAXMEMORY', '256mb')
SMTP_HOST       = os.getenv('SMTP_HOST', '')
SMTP_PORT       = os.getenv('SMTP_PORT', '587')
SMTP_USER       = os.getenv('SMTP_USER', '')
SMTP_PASS       = os.getenv('SMTP_PASS', '')
SMTP_FROM       = os.getenv('SMTP_FROM', '')
GCHAT_WEBHOOK   = os.getenv('GCHAT_WEBHOOK_PACIENTE_PS', '')

# Apache HOP (ETL Tasy → PostgreSQL)
HOP_SERVER_HOST      = os.getenv('HOP_SERVER_HOST', 'localhost')
HOP_SERVER_PORT      = int(os.getenv('HOP_SERVER_PORT', '8080'))
HOP_FRESHNESS_AVISO_H = int(os.getenv('HOP_FRESHNESS_AVISO_H', '4'))
HOP_FRESHNESS_ERRO_H  = int(os.getenv('HOP_FRESHNESS_ERRO_H', '24'))

# Thresholds servidor
CPU_AVISO   = int(os.getenv('MONITOR_CPU_AVISO',  '75'))
CPU_ERRO    = int(os.getenv('MONITOR_CPU_ERRO',   '90'))
MEM_AVISO   = int(os.getenv('MONITOR_MEM_AVISO',  '80'))
MEM_ERRO    = int(os.getenv('MONITOR_MEM_ERRO',   '90'))
DISK_AVISO  = int(os.getenv('MONITOR_DISK_AVISO', '80'))
DISK_ERRO   = int(os.getenv('MONITOR_DISK_ERRO',  '90'))

# Thresholds PostgreSQL
DB_CONN_AVISO_PCT    = int(os.getenv('MONITOR_DB_CONN_AVISO',  '70'))
DB_CONN_ERRO_PCT     = int(os.getenv('MONITOR_DB_CONN_ERRO',   '90'))
DB_LATENCIA_AVISO_MS = int(os.getenv('MONITOR_DB_LAT_AVISO',   '500'))
DB_LATENCIA_ERRO_MS  = int(os.getenv('MONITOR_DB_LAT_ERRO',    '2000'))
DB_IDLE_TRANS_MIN    = int(os.getenv('MONITOR_DB_IDLE_MIN',     '5'))
DB_QUERY_LENTA_S     = int(os.getenv('MONITOR_DB_SLOW_S',       '60'))
DISK_LOG_RETENCAO_D  = int(os.getenv('MONITOR_LOG_RETENCAO_D',  '30'))

EMAIL_RELATORIO = 'lucas.oliveira@saofranciscodf.med.br'
INTERVALO_HORAS = 6

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

# Threads daemon esperadas (por nome)
_WORKERS_ESPERADOS = [
    ('notificador_pareceres',       'Notificador Pareceres'),
    ('notificador_sentir_agir',     'Notificador Sentir e Agir'),
    ('worker_sentir_agir_analise',  'Worker Análise IA Groq'),
    ('worker_imap_tratativas',      'Worker IMAP'),
    ('notificador_paciente_ps',     'Notificador Paciente PS'),
    ('worker_tests_sistema',        'Worker Verificação Sistema'),
]


# ─────────────────────────────────────────────────────────
# ESTRUTURA DE RESULTADO
# ─────────────────────────────────────────────────────────

def _r(categoria, item, ok, detalhe='', reparavel=False, nivel=None):
    """Cria um resultado de verificação.

    nivel: 'ok' | 'aviso' | 'erro'  (None = auto-detect pelo ok)
    """
    if nivel is None:
        nivel = 'ok' if ok else 'erro'
    return {
        'categoria': categoria,
        'item':      item,
        'ok':        ok,
        'nivel':     nivel,
        'detalhe':   detalhe or ('OK' if ok else 'FALHOU'),
        'reparavel': reparavel,
    }


def _aviso(categoria, item, detalhe='', reparavel=False):
    """Aviso: não é erro crítico mas requer atenção. ok=True, nivel='aviso'."""
    return {
        'categoria': categoria,
        'item':      item,
        'ok':        True,
        'nivel':     'aviso',
        'detalhe':   detalhe or 'Verificar',
        'reparavel': reparavel,
    }


# ─────────────────────────────────────────────────────────
# VERIFICAÇÃO 1: SERVIDOR (CPU / RAM / DISCO / UPTIME)
# ─────────────────────────────────────────────────────────

def _verificar_servidor(resultados):
    """Verifica CPU, RAM, disco e uptime via psutil."""
    try:
        import psutil
    except ImportError:
        resultados.append(_r('servidor', 'psutil instalado', False,
            'pip install psutil  (necessário para monitorar servidor)'))
        return

    # CPU (interval=1 para leitura real)
    try:
        cpu_pct = psutil.cpu_percent(interval=1)
        cpu_count = psutil.cpu_count(logical=True)
        detalhe = '{:.1f}% ({} núcleos lógicos)'.format(cpu_pct, cpu_count)
        if cpu_pct >= CPU_ERRO:
            resultados.append(_r('servidor', 'CPU', False,
                detalhe + ' — CRÍTICO (threshold: {}%)'.format(CPU_ERRO)))
        elif cpu_pct >= CPU_AVISO:
            resultados.append(_aviso('servidor', 'CPU',
                detalhe + ' — ELEVADO (threshold aviso: {}%)'.format(CPU_AVISO)))
        else:
            resultados.append(_r('servidor', 'CPU', True, detalhe))
    except Exception as e:
        resultados.append(_r('servidor', 'CPU', False, str(e)))

    # RAM
    try:
        mem = psutil.virtual_memory()
        mem_pct = mem.percent
        mem_livre_gb = round(mem.available / 1024**3, 1)
        mem_total_gb = round(mem.total / 1024**3, 1)
        detalhe = '{:.1f}% usado | {:.1f} GB livres de {:.1f} GB'.format(
            mem_pct, mem_livre_gb, mem_total_gb)
        if mem_pct >= MEM_ERRO:
            resultados.append(_r('servidor', 'Memória RAM', False,
                detalhe + ' — CRÍTICO'))
        elif mem_pct >= MEM_AVISO:
            resultados.append(_aviso('servidor', 'Memória RAM',
                detalhe + ' — ELEVADA'))
        else:
            resultados.append(_r('servidor', 'Memória RAM', True, detalhe))
    except Exception as e:
        resultados.append(_r('servidor', 'Memória RAM', False, str(e)))

    # Disco (partição do projeto)
    try:
        disk = psutil.disk_usage(BASE_DIR)
        disk_pct = disk.percent
        disk_livre_gb = round(disk.free / 1024**3, 1)
        disk_total_gb = round(disk.total / 1024**3, 1)
        detalhe = '{:.1f}% usado | {:.1f} GB livres de {:.1f} GB'.format(
            disk_pct, disk_livre_gb, disk_total_gb)
        if disk_pct >= DISK_ERRO:
            resultados.append(_r('servidor', 'Disco', False,
                detalhe + ' — CRÍTICO', reparavel=True))
        elif disk_pct >= DISK_AVISO:
            resultados.append(_aviso('servidor', 'Disco',
                detalhe + ' — ATENÇÃO', reparavel=True))
        else:
            resultados.append(_r('servidor', 'Disco', True, detalhe))
    except Exception as e:
        resultados.append(_r('servidor', 'Disco', False, str(e)))

    # Uptime
    try:
        boot = datetime.fromtimestamp(psutil.boot_time())
        uptime = datetime.now() - boot
        dias = uptime.days
        horas = uptime.seconds // 3600
        resultados.append(_r('servidor', 'Uptime', True,
            '{} dias e {} h (ligado desde {})'.format(
                dias, horas, boot.strftime('%d/%m/%Y %H:%M'))))
    except Exception as e:
        resultados.append(_r('servidor', 'Uptime', False, str(e)))

    # Processos
    try:
        n_proc = sum(1 for _ in psutil.process_iter())
        resultados.append(_r('servidor', 'Processos ativos', True,
            '{} processos em execução'.format(n_proc)))
    except Exception as e:
        resultados.append(_r('servidor', 'Processos ativos', False, str(e)))


# ─────────────────────────────────────────────────────────
# VERIFICAÇÃO 2: REDIS + SMTP
# ─────────────────────────────────────────────────────────

def _verificar_redis(resultados):
    """Testa conexão Redis e configuração de memória."""
    redis_client = None
    try:
        import redis as redis_lib
        redis_client = redis_lib.Redis.from_url(
            REDIS_URL, socket_connect_timeout=3, decode_responses=True)
        redis_client.ping()
        info_mem = redis_client.info('memory')
        info_srv = redis_client.info('server')
        mem_mb   = round(info_mem.get('used_memory', 0) / 1024**2, 1)
        peak_mb  = round(info_mem.get('used_memory_peak', 0) / 1024**2, 1)
        versao   = info_srv.get('redis_version', '?')
        resultados.append(_r('infra', 'Redis conexão', True,
            'v{} | uso {}MB | pico {}MB'.format(versao, mem_mb, peak_mb)))

        max_cfg = redis_client.config_get('maxmemory')
        max_val = int(max_cfg.get('maxmemory', 0))
        if max_val == 0:
            resultados.append(_r('infra', 'Redis maxmemory', False,
                'SEM LIMITE — risco de consumo ilimitado de RAM', reparavel=True))
        else:
            resultados.append(_r('infra', 'Redis maxmemory', True,
                '{:.0f} MB configurado'.format(max_val / 1024**2)))

        policy = redis_client.config_get('maxmemory-policy').get('maxmemory-policy', 'noeviction')
        ok_pol = policy in ('allkeys-lru', 'allkeys-lfu', 'volatile-lru')
        resultados.append(_r('infra', 'Redis eviction policy', ok_pol,
            policy + (' ← OK' if ok_pol else ' ← recomendado: allkeys-lru'),
            reparavel=not ok_pol))

        n_keys = redis_client.dbsize()
        resultados.append(_r('infra', 'Redis chaves', True,
            '{} chaves em cache'.format(n_keys)))

    except Exception as e:
        resultados.append(_r('infra', 'Redis conexão', False, str(e)))

    return redis_client


def _verificar_smtp(resultados):
    """Verifica configuração de SMTP e GChat."""
    ok = bool(SMTP_HOST and SMTP_USER and SMTP_PASS)
    resultados.append(_r('infra', 'SMTP configurado', ok,
        '{}:{} ({})'.format(SMTP_HOST, SMTP_PORT, SMTP_USER)
        if ok else 'SMTP_HOST/USER/PASS ausentes no .env'))
    resultados.append(_r('infra', 'GChat webhook PS', bool(GCHAT_WEBHOOK),
        'configurado' if GCHAT_WEBHOOK else 'não configurado (opcional)'))


# ─────────────────────────────────────────────────────────
# VERIFICAÇÃO 3: APACHE HOP
# ─────────────────────────────────────────────────────────

def _verificar_hop(resultados, conn):
    """Verifica se o Apache HOP está ativo e se os dados ETL estão atualizados."""

    # 3a. Porta HOP Server
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        porta_ok = sock.connect_ex((HOP_SERVER_HOST, HOP_SERVER_PORT)) == 0
        sock.close()
        resultados.append(_r('hop', 'HOP Server porta {}:{}'.format(
                HOP_SERVER_HOST, HOP_SERVER_PORT), porta_ok,
            'respondendo' if porta_ok else
            'PORTA FECHADA — HOP Server pode estar desativado'))
    except Exception as e:
        resultados.append(_r('hop', 'HOP Server porta', False, str(e)))

    # 3b. Processo HOP (psutil)
    try:
        import psutil
        hop_proc = None
        for p in psutil.process_iter(['pid', 'name', 'cmdline', 'status']):
            try:
                nome = (p.info.get('name') or '').lower()
                cmd  = ' '.join(p.info.get('cmdline') or []).lower()
                if ('hop' in nome or
                        'hoprun' in cmd or
                        'hop-run' in cmd or
                        'hop-server' in cmd or
                        'apache-hop' in cmd or
                        ('hop' in cmd and ('java' in nome or 'java.exe' in nome))):
                    hop_proc = p
                    break
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        if hop_proc:
            resultados.append(_r('hop', 'Processo HOP', True,
                'PID {} | {} | {}'.format(
                    hop_proc.pid, hop_proc.name(), hop_proc.status())))
        else:
            resultados.append(_r('hop', 'Processo HOP', False,
                'Nenhum processo HOP detectado (java+hop ou hop-run)'))
    except ImportError:
        resultados.append(_aviso('hop', 'Processo HOP',
            'psutil não instalado — verificação de processo ignorada'))
    except Exception as e:
        resultados.append(_r('hop', 'Processo HOP', False, str(e)))

    if conn is None:
        return

    cursor = conn.cursor()

    # 3c. Freshness: painel17_atendimentos_ps
    try:
        cursor.execute("""
            SELECT MAX(dt_entrada) AS ultima,
                   COUNT(*) FILTER (WHERE dt_entrada >= NOW() - INTERVAL '24 hours') AS hoje
            FROM painel17_atendimentos_ps
        """)
        row = cursor.fetchone()
        ultima = row[0]
        hoje   = row[1] or 0

        if ultima is None:
            resultados.append(_r('hop', 'ETL painel17 (PS atendimentos)', False,
                'Sem registros — tabela vazia'))
        else:
            ultima_dt = ultima.replace(tzinfo=None) if hasattr(ultima, 'tzinfo') else ultima
            diff_h = (datetime.now() - ultima_dt).total_seconds() / 3600
            det = 'último: {} ({:.1f}h atrás) | {} registros 24h'.format(
                ultima_dt.strftime('%d/%m %H:%M'), diff_h, hoje)
            if diff_h >= HOP_FRESHNESS_ERRO_H:
                resultados.append(_r('hop', 'ETL painel17 (PS atendimentos)', False,
                    det + ' — DADOS DESATUALIZADOS (ETL parado?)'))
            elif diff_h >= HOP_FRESHNESS_AVISO_H:
                resultados.append(_aviso('hop', 'ETL painel17 (PS atendimentos)',
                    det + ' — verificar agendamento HOP'))
            else:
                resultados.append(_r('hop', 'ETL painel17 (PS atendimentos)', True, det))
    except Exception as e:
        resultados.append(_r('hop', 'ETL painel17 (PS atendimentos)', False, str(e)))
        conn.rollback()

    # 3d. Freshness: painel_ps_analise (dt_entrada é varchar → cast)
    try:
        cursor.execute("""
            SELECT MAX(dt_entrada::timestamptz) AS ultima,
                   COUNT(*) FILTER (
                       WHERE dt_entrada::timestamptz >= NOW() - INTERVAL '24 hours'
                   ) AS hoje
            FROM painel_ps_analise
        """)
        row = cursor.fetchone()
        ultima = row[0]
        hoje   = row[1] or 0

        if ultima is None:
            resultados.append(_r('hop', 'ETL painel_ps_analise', False,
                'Sem registros — tabela vazia'))
        else:
            ultima_dt = ultima.replace(tzinfo=None) if hasattr(ultima, 'tzinfo') else ultima
            diff_h = (datetime.now() - ultima_dt).total_seconds() / 3600
            det = 'último: {} ({:.1f}h atrás) | {} registros 24h'.format(
                ultima_dt.strftime('%d/%m %H:%M'), diff_h, hoje)
            if diff_h >= HOP_FRESHNESS_ERRO_H:
                resultados.append(_r('hop', 'ETL painel_ps_analise', False,
                    det + ' — DADOS DESATUALIZADOS'))
            elif diff_h >= HOP_FRESHNESS_AVISO_H:
                resultados.append(_aviso('hop', 'ETL painel_ps_analise',
                    det + ' — verificar agendamento HOP'))
            else:
                resultados.append(_r('hop', 'ETL painel_ps_analise', True, det))
    except Exception as e:
        resultados.append(_r('hop', 'ETL painel_ps_analise', False, str(e)))
        conn.rollback()

    # 3e. medicos_ps populada
    try:
        cursor.execute("SELECT COUNT(*) AS qt FROM medicos_ps")
        qt = cursor.fetchone()[0]
        resultados.append(_r('hop', 'medicos_ps populada', qt > 0,
            '{} médico(s) registrado(s)'.format(qt)))
    except Exception as e:
        resultados.append(_r('hop', 'medicos_ps populada', False, str(e)))
        conn.rollback()

    cursor.close()


# ─────────────────────────────────────────────────────────
# VERIFICAÇÃO 4: POSTGRESQL — TABELAS / VIEWS / CONSTRAINTS
# ─────────────────────────────────────────────────────────

def _verificar_postgres(resultados):
    """Testa conexão, tabelas, views, constraints e dados críticos."""
    import psycopg2
    from psycopg2.extras import RealDictCursor

    try:
        conn = psycopg2.connect(**DB_CONFIG, connect_timeout=5)
        resultados.append(_r('infra', 'PostgreSQL conexão', True,
            '{}@{}:{}/{}'.format(
                DB_CONFIG['user'], DB_CONFIG['host'],
                DB_CONFIG['port'], DB_CONFIG['database'])))
    except Exception as e:
        resultados.append(_r('infra', 'PostgreSQL conexão', False, str(e)))
        return None

    cursor = conn.cursor(cursor_factory=RealDictCursor)

    # Tabelas
    for tabela, label in TABELAS_CRITICAS:
        try:
            cursor.execute("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_name = %s AND table_schema = 'public'
                ) AS existe
            """, (tabela,))
            existe = cursor.fetchone()['existe']
            if existe:
                cursor.execute('SELECT COUNT(*) AS total FROM {}'.format(tabela))
                total = cursor.fetchone()['total']
                resultados.append(_r('tabelas', label, True,
                    '{} ({} linhas)'.format(tabela, total)))
            else:
                resultados.append(_r('tabelas', label, False,
                    'tabela {} NÃO EXISTE'.format(tabela)))
        except Exception as e:
            resultados.append(_r('tabelas', label, False, str(e)))
            conn.rollback()

    # Views
    for view, label in VIEWS_CRITICAS:
        try:
            cursor.execute('SELECT 1 FROM {} LIMIT 1'.format(view))
            cursor.fetchall()
            resultados.append(_r('views', label, True, view))
        except Exception as e:
            resultados.append(_r('views', label, False, str(e)))
            conn.rollback()

    # Constraint: topico_ntfy deve ser nullable
    try:
        cursor.execute("""
            SELECT is_nullable FROM information_schema.columns
            WHERE table_name = 'notificacoes_log' AND column_name = 'topico_ntfy'
              AND table_schema = 'public'
        """)
        row = cursor.fetchone()
        if row:
            nullable = row['is_nullable'] == 'YES'
            resultados.append(_r('constraints', 'notificacoes_log.topico_ntfy nullable', nullable,
                'OK' if nullable else 'NOT NULL — rode migration_notificacoes_log_nullable.sql',
                reparavel=not nullable))
        else:
            resultados.append(_r('constraints', 'notificacoes_log.topico_ntfy', False,
                'Coluna não encontrada'))
    except Exception as e:
        resultados.append(_r('constraints', 'topico_ntfy constraint', False, str(e)))
        conn.rollback()

    # Colunas criado_em
    for tabela, col in [('historico_usuarios', 'criado_em'), ('permissoes_paineis', 'criado_em')]:
        try:
            cursor.execute("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = %s AND column_name = %s AND table_schema = 'public'
                ) AS existe
            """, (tabela, col))
            existe = cursor.fetchone()['existe']
            resultados.append(_r('constraints', '{}.{} presente'.format(tabela, col), existe,
                'presente' if existe else 'AUSENTE — init_db corrigirá no próximo restart',
                reparavel=not existe))
        except Exception as e:
            resultados.append(_r('constraints', '{}.{}'.format(tabela, col), False, str(e)))
            conn.rollback()

    # Notificadores: tipos_evento cadastrados
    for codigo, label in TIPOS_EVENTO:
        try:
            cursor.execute(
                "SELECT ativo FROM notificacoes_tipos_evento WHERE codigo = %s", (codigo,))
            tipo = cursor.fetchone()
            if not tipo:
                resultados.append(_r('notificadores', '{} tipo cadastrado'.format(label), False,
                    "código '{}' ausente".format(codigo), reparavel=True))
            else:
                resultados.append(_r('notificadores', '{} tipo cadastrado'.format(label), True,
                    'ativo={}'.format(tipo['ativo'])))

            cursor.execute("""
                SELECT COUNT(*) AS qt FROM notificacoes_destinatarios
                WHERE tipo_evento = %s AND canal = 'email' AND ativo = true
            """, (codigo,))
            qt = cursor.fetchone()['qt']
            resultados.append(_r('notificadores', '{} destinatários email'.format(label), qt > 0,
                '{} destinatário(s)'.format(qt)))
        except Exception as e:
            resultados.append(_r('notificadores', label, False, str(e)))
            conn.rollback()

    # Sentir e Agir responsáveis
    try:
        cursor.execute("SELECT COUNT(*) AS qt FROM sentir_agir_responsaveis WHERE ativo = true")
        qt = cursor.fetchone()['qt']
        resultados.append(_r('notificadores', 'Sentir e Agir responsáveis', qt > 0,
            '{} responsável(is) ativo(s)'.format(qt)))
    except Exception as e:
        resultados.append(_r('notificadores', 'Sentir e Agir responsáveis', False, str(e)))
        conn.rollback()

    # Dados operacionais
    try:
        cursor.execute("""
            SELECT COUNT(*) AS qt FROM notificacoes_historico
            WHERE dt_envio::date = CURRENT_DATE AND sucesso = false
        """)
        erros_hoje = cursor.fetchone()['qt']
        resultados.append(_r('dados', 'Erros de envio hoje', erros_hoje == 0,
            '{} erro(s)'.format(erros_hoje)))
    except Exception as e:
        resultados.append(_r('dados', 'Erros de envio hoje', False, str(e)))
        conn.rollback()

    try:
        cursor.execute("""
            SELECT COUNT(*) AS qt FROM painel_ps_analise
            WHERE dt_entrada::timestamptz >= NOW() - INTERVAL '24 hours'
        """)
        qt = cursor.fetchone()['qt']
        resultados.append(_r('dados', 'Atendimentos PS 24h', qt >= 0,
            '{} registro(s)'.format(qt)))
    except Exception as e:
        resultados.append(_r('dados', 'Atendimentos PS 24h', False, str(e)))
        conn.rollback()

    cursor.close()
    return conn


# ─────────────────────────────────────────────────────────
# VERIFICAÇÃO 5: SAÚDE DO POSTGRESQL
# ─────────────────────────────────────────────────────────

def _verificar_postgres_saude(resultados, conn):
    """Latência, conexões, idle in transaction, queries lentas, deadlocks, tamanho."""
    if conn is None:
        return

    from psycopg2.extras import RealDictCursor
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    # 5a. Latência (SELECT 1)
    try:
        t0 = time.time()
        cursor.execute("SELECT 1 AS x")
        cursor.fetchone()
        lat_ms = round((time.time() - t0) * 1000, 1)
        if lat_ms >= DB_LATENCIA_ERRO_MS:
            resultados.append(_r('pg_saude', 'PostgreSQL latência', False,
                '{:.1f}ms — BANCO MUITO LENTO (limite: {}ms)'.format(lat_ms, DB_LATENCIA_ERRO_MS)))
        elif lat_ms >= DB_LATENCIA_AVISO_MS:
            resultados.append(_aviso('pg_saude', 'PostgreSQL latência',
                '{:.1f}ms — lento (aviso: {}ms)'.format(lat_ms, DB_LATENCIA_AVISO_MS)))
        else:
            resultados.append(_r('pg_saude', 'PostgreSQL latência', True,
                '{:.1f}ms'.format(lat_ms)))
    except Exception as e:
        resultados.append(_r('pg_saude', 'PostgreSQL latência', False, str(e)))
        conn.rollback()

    # 5b. Conexões ativas vs max_connections
    try:
        cursor.execute("""
            SELECT
                COUNT(*) FILTER (WHERE state IS NOT NULL) AS ativas,
                COUNT(*) FILTER (WHERE state = 'active') AS executando,
                COUNT(*) FILTER (WHERE state = 'idle in transaction') AS idle_trans,
                COUNT(*) FILTER (WHERE state = 'idle') AS idle,
                (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn
            FROM pg_stat_activity
            WHERE datname = current_database()
        """)
        row = cursor.fetchone()
        ativas      = row['ativas'] or 0
        executando  = row['executando'] or 0
        idle_trans  = row['idle_trans'] or 0
        max_conn    = row['max_conn'] or 100
        pct = round(ativas / max_conn * 100, 1)

        det = '{}/{} conexões ({:.1f}%) | {} executando | {} idle | {} idle-in-trans'.format(
            ativas, max_conn, pct, executando, row['idle'] or 0, idle_trans)

        if pct >= DB_CONN_ERRO_PCT:
            resultados.append(_r('pg_saude', 'PostgreSQL conexões', False,
                det + ' — CRÍTICO'))
        elif pct >= DB_CONN_AVISO_PCT:
            resultados.append(_aviso('pg_saude', 'PostgreSQL conexões', det))
        else:
            resultados.append(_r('pg_saude', 'PostgreSQL conexões', True, det))
    except Exception as e:
        resultados.append(_r('pg_saude', 'PostgreSQL conexões', False, str(e)))
        conn.rollback()

    # 5c. Sessões idle in transaction por muito tempo (potencial lock/deadlock)
    try:
        cursor.execute("""
            SELECT pid, usename, application_name,
                   ROUND(EXTRACT(EPOCH FROM (NOW() - xact_start)) / 60) AS minutos,
                   LEFT(query, 100) AS query_trunc
            FROM pg_stat_activity
            WHERE state = 'idle in transaction'
              AND xact_start IS NOT NULL
              AND EXTRACT(EPOCH FROM (NOW() - xact_start)) / 60 > %s
            ORDER BY minutos DESC
            LIMIT 5
        """, (DB_IDLE_TRANS_MIN,))
        idle_probs = cursor.fetchall()
        if idle_probs:
            info = '; '.join('PID {} ({}min)'.format(r['pid'], r['minutos'])
                             for r in idle_probs)
            resultados.append(_r('pg_saude', 'Idle in transaction', False,
                '{} sessão(ões) travada(s) > {}min: {}'.format(
                    len(idle_probs), DB_IDLE_TRANS_MIN, info),
                reparavel=True))
        else:
            resultados.append(_r('pg_saude', 'Idle in transaction', True,
                'Nenhuma sessão travada > {}min'.format(DB_IDLE_TRANS_MIN)))
    except Exception as e:
        resultados.append(_r('pg_saude', 'Idle in transaction', False, str(e)))
        conn.rollback()

    # 5d. Queries lentas em execução agora
    try:
        cursor.execute("""
            SELECT pid, usename,
                   ROUND(EXTRACT(EPOCH FROM (NOW() - query_start))) AS segundos,
                   LEFT(query, 100) AS query_trunc
            FROM pg_stat_activity
            WHERE state = 'active'
              AND query_start IS NOT NULL
              AND query NOT LIKE '%%pg_stat_activity%%'
              AND EXTRACT(EPOCH FROM (NOW() - query_start)) > %s
            ORDER BY segundos DESC
            LIMIT 5
        """, (DB_QUERY_LENTA_S,))
        lentas = cursor.fetchall()
        if lentas:
            info = '; '.join('PID {} ({}s)'.format(r['pid'], r['segundos'])
                             for r in lentas)
            resultados.append(_r('pg_saude', 'Queries lentas', False,
                '{} query(ies) > {}s: {}'.format(
                    len(lentas), DB_QUERY_LENTA_S, info)))
        else:
            resultados.append(_r('pg_saude', 'Queries lentas', True,
                'Nenhuma query > {}s em execução'.format(DB_QUERY_LENTA_S)))
    except Exception as e:
        resultados.append(_r('pg_saude', 'Queries lentas', False, str(e)))
        conn.rollback()

    # 5e. Deadlocks acumulados (desde último RESET STATISTICS)
    try:
        cursor.execute("""
            SELECT deadlocks, conflicts,
                   blk_read_time::int AS read_ms,
                   blk_write_time::int AS write_ms
            FROM pg_stat_database
            WHERE datname = current_database()
        """)
        row = cursor.fetchone()
        deadlocks = row['deadlocks'] if row else 0
        if deadlocks > 0:
            resultados.append(_aviso('pg_saude', 'Deadlocks acumulados',
                '{} deadlock(s) desde o último reset de estatísticas'.format(deadlocks)))
        else:
            resultados.append(_r('pg_saude', 'Deadlocks acumulados', True, 'Nenhum deadlock'))
    except Exception as e:
        resultados.append(_r('pg_saude', 'Deadlocks acumulados', False, str(e)))
        conn.rollback()

    # 5f. Bloqueios ativos (locks esperando liberação)
    try:
        cursor.execute("""
            SELECT COUNT(*) AS n_bloqueios
            FROM pg_locks l
            JOIN pg_stat_activity a ON l.pid = a.pid
            WHERE NOT l.granted
              AND a.wait_event_type = 'Lock'
        """)
        row = cursor.fetchone()
        n_locks = row['n_bloqueios'] if row else 0
        if n_locks > 0:
            resultados.append(_r('pg_saude', 'Bloqueios (locks) ativos', False,
                '{} processo(s) aguardando liberação de lock'.format(n_locks)))
        else:
            resultados.append(_r('pg_saude', 'Bloqueios (locks) ativos', True,
                'Nenhum bloqueio ativo'))
    except Exception as e:
        resultados.append(_r('pg_saude', 'Bloqueios (locks)', False, str(e)))
        conn.rollback()

    # 5g. Tamanho do banco
    try:
        cursor.execute("""
            SELECT pg_size_pretty(pg_database_size(current_database())) AS tam,
                   pg_database_size(current_database()) AS bytes
        """)
        row = cursor.fetchone()
        tam_gb = round(row['bytes'] / 1024**3, 2)
        resultados.append(_r('pg_saude', 'Tamanho do banco', True,
            '{} ({:.2f} GB)'.format(row['tam'], tam_gb)))
    except Exception as e:
        resultados.append(_r('pg_saude', 'Tamanho do banco', False, str(e)))
        conn.rollback()

    cursor.close()


# ─────────────────────────────────────────────────────────
# VERIFICAÇÃO 6: WORKERS FLASK (THREADS DAEMON)
# ─────────────────────────────────────────────────────────

def _verificar_workers_flask(resultados):
    """Verifica se os workers daemon do Flask estão com threads ativas."""
    threads_ativas = {t.name: t for t in threading.enumerate()}

    for nome, label in _WORKERS_ESPERADOS:
        encontradas = [n for n in threads_ativas if nome in n]
        resultados.append(_r('workers', label, bool(encontradas),
            'thread ativa: {}'.format(encontradas[0]) if encontradas
            else 'thread NÃO encontrada — worker pode ter falhado'))


# ─────────────────────────────────────────────────────────
# ORQUESTRADOR DE VERIFICAÇÕES
# ─────────────────────────────────────────────────────────

def executar_verificacoes():
    """
    Executa todas as verificações críticas.
    Retorna (resultados, conn_pg, redis_client, duracao_s).
    """
    resultados = []
    t0 = time.time()

    _verificar_servidor(resultados)
    _verificar_smtp(resultados)
    redis_client = _verificar_redis(resultados)
    conn = _verificar_postgres(resultados)
    _verificar_postgres_saude(resultados, conn)
    _verificar_hop(resultados, conn)
    _verificar_workers_flask(resultados)

    duracao = round(time.time() - t0, 2)
    return resultados, conn, redis_client, duracao


# ─────────────────────────────────────────────────────────
# REPAROS AUTOMÁTICOS
# ─────────────────────────────────────────────────────────

def executar_reparos(resultados, conn, redis_client):
    """
    Tenta reparar automaticamente problemas identificados.
    Retorna lista de (item, sucesso, detalhe).
    """
    reparos = []
    problemas = [r for r in resultados if r['reparavel']]

    if not problemas:
        return reparos

    nomes = {p['item'] for p in problemas}

    # ── Redis: maxmemory e policy ──────────────────────────────────────────
    if redis_client:
        if 'Redis maxmemory' in nomes:
            try:
                redis_client.config_set('maxmemory', REDIS_MAXMEMORY)
                redis_client.config_set('maxmemory-policy', 'allkeys-lru')
                reparos.append(('Redis maxmemory', True,
                    'Configurado {} com policy allkeys-lru'.format(REDIS_MAXMEMORY)))
                logger.info('[reparo] Redis maxmemory: %s allkeys-lru', REDIS_MAXMEMORY)
            except Exception as e:
                reparos.append(('Redis maxmemory', False, str(e)))

        if 'Redis eviction policy' in nomes:
            try:
                redis_client.config_set('maxmemory-policy', 'allkeys-lru')
                reparos.append(('Redis eviction policy', True, 'Definida como allkeys-lru'))
                logger.info('[reparo] Redis policy: allkeys-lru')
            except Exception as e:
                reparos.append(('Redis eviction policy', False, str(e)))

    # ── Disco: limpar logs antigos ─────────────────────────────────────────
    if any('Disco' in p['item'] for p in problemas):
        try:
            cutoff = time.time() - DISK_LOG_RETENCAO_D * 86400
            removidos = []
            # Logs rotacionados (RotatingFileHandler gera .log.1, .log.2, ...)
            for f in _glob.glob(os.path.join(LOG_DIR, '*.log.*')):
                try:
                    if os.path.getmtime(f) < cutoff:
                        os.remove(f)
                        removidos.append(os.path.basename(f))
                except Exception:
                    pass
            # Logs de crash Python (se houver)
            for f in _glob.glob(os.path.join(BASE_DIR, '*.log')):
                try:
                    if os.path.getmtime(f) < cutoff and os.path.getsize(f) < 1024:
                        pass  # não remove logs principais mesmo que velhos
                except Exception:
                    pass
            if removidos:
                reparos.append(('Disco', True,
                    'Removidos {} log(s) antigo(s) (>{} dias): {}'.format(
                        len(removidos), DISK_LOG_RETENCAO_D,
                        ', '.join(removidos[:5]) + ('...' if len(removidos) > 5 else ''))))
                logger.info('[reparo] Disco: removidos %d logs antigos', len(removidos))
            else:
                reparos.append(('Disco', False,
                    'Nenhum log antigo encontrado para limpeza (>{} dias)'.format(
                        DISK_LOG_RETENCAO_D)))
        except Exception as e:
            reparos.append(('Disco', False, 'Erro ao limpar logs: {}'.format(e)))

    if conn:
        cursor = conn.cursor()

        # ── Idle in transaction: encerra sessões travadas ──────────────────
        if 'Idle in transaction' in nomes:
            try:
                cursor.execute("""
                    SELECT pg_terminate_backend(pid)
                    FROM pg_stat_activity
                    WHERE state = 'idle in transaction'
                      AND xact_start IS NOT NULL
                      AND EXTRACT(EPOCH FROM (NOW() - xact_start)) / 60 > %s
                      AND pid <> pg_backend_pid()
                """, (DB_IDLE_TRANS_MIN,))
                n = cursor.rowcount
                conn.commit()
                reparos.append(('Idle in transaction', True,
                    '{} sessão(ões) travada(s) encerrada(s)'.format(n)))
                logger.info('[reparo] Idle-in-transaction: %d sessão(ões) encerrada(s)', n)
            except Exception as e:
                conn.rollback()
                reparos.append(('Idle in transaction', False, str(e)))

        # ── notificacoes_log.topico_ntfy NOT NULL ─────────────────────────
        if any('topico_ntfy' in p['item'] for p in problemas):
            try:
                cursor.execute("""
                    ALTER TABLE notificacoes_log
                    ALTER COLUMN topico_ntfy DROP NOT NULL
                """)
                conn.commit()
                reparos.append(('notificacoes_log.topico_ntfy nullable', True,
                    'Constraint NOT NULL removida'))
                logger.info('[reparo] topico_ntfy: NOT NULL removido')
            except Exception as e:
                conn.rollback()
                reparos.append(('notificacoes_log.topico_ntfy nullable', False, str(e)))

        # ── Colunas criado_em ausentes ─────────────────────────────────────
        for tabela in ('historico_usuarios', 'permissoes_paineis', 'usuarios'):
            chave = '{}.criado_em presente'.format(tabela)
            if chave in nomes:
                try:
                    cursor.execute("""
                        ALTER TABLE {} ADD COLUMN IF NOT EXISTS criado_em
                        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    """.format(tabela))
                    conn.commit()
                    reparos.append((chave, True,
                        'criado_em adicionada em {}'.format(tabela)))
                    logger.info('[reparo] criado_em adicionada em %s', tabela)
                except Exception as e:
                    conn.rollback()
                    reparos.append((chave, False, str(e)))

        # ── tipo_evento paciente_ps_sem_medico ────────────────────────────
        if 'Paciente PS Sem Médico tipo cadastrado' in nomes:
            try:
                cursor.execute("""
                    INSERT INTO notificacoes_tipos_evento
                        (codigo, nome, descricao, icone, cor, tabela_origem, ativo)
                    SELECT
                        'paciente_ps_sem_medico',
                        'Paciente PS Sem Médico',
                        'Alerta quando há paciente aguardando mais de 10 minutos sem médico no PS',
                        'fa-user-clock', '#dc3545', 'painel_ps_analise', true
                    WHERE NOT EXISTS (
                        SELECT 1 FROM notificacoes_tipos_evento
                        WHERE codigo = 'paciente_ps_sem_medico'
                    )
                """)
                conn.commit()
                reparos.append(('Paciente PS Sem Médico tipo cadastrado', True,
                    'Tipo de evento inserido'))
                logger.info('[reparo] tipo_evento paciente_ps_sem_medico inserido')
            except Exception as e:
                conn.rollback()
                reparos.append(('Paciente PS Sem Médico tipo cadastrado', False, str(e)))

        # ── tipo_evento parecer_pendente ──────────────────────────────────
        if 'Pareceres Pendentes tipo cadastrado' in nomes:
            try:
                cursor.execute("""
                    INSERT INTO notificacoes_tipos_evento
                        (codigo, nome, descricao, icone, cor, tabela_origem, ativo)
                    SELECT
                        'parecer_pendente', 'Parecer Pendente',
                        'Alerta de parecer médico aguardando resposta',
                        'fa-file-medical', '#0d6efd', 'pareceres_pendentes', true
                    WHERE NOT EXISTS (
                        SELECT 1 FROM notificacoes_tipos_evento
                        WHERE codigo = 'parecer_pendente'
                    )
                """)
                conn.commit()
                reparos.append(('Pareceres Pendentes tipo cadastrado', True, 'Tipo inserido'))
                logger.info('[reparo] tipo_evento parecer_pendente inserido')
            except Exception as e:
                conn.rollback()
                reparos.append(('Pareceres Pendentes tipo cadastrado', False, str(e)))

        cursor.close()

    return reparos


# ─────────────────────────────────────────────────────────
# FORMATAÇÃO: TERMINAL
# ─────────────────────────────────────────────────────────

_TITULOS_CAT = {
    'servidor':      '1. Servidor (CPU / RAM / Disco / Uptime)',
    'infra':         '2. Infraestrutura (Redis / SMTP)',
    'tabelas':       '3. Tabelas Críticas',
    'views':         '4. Views Críticas',
    'constraints':   '5. Constraints e Colunas',
    'pg_saude':      '6. Saúde do PostgreSQL',
    'hop':           '7. Apache HOP (ETL Tasy → PostgreSQL)',
    'notificadores': '8. Notificadores',
    'dados':         '9. Dados Operacionais',
    'workers':       '10. Workers Flask (Threads Daemon)',
}


def montar_saida_terminal(resultados, reparos, duracao):
    """Gera string de saída no estilo terminal para o frontend e logs."""
    linhas = []
    agora  = datetime.now().strftime('%d/%m/%Y %H:%M:%S')

    linhas.append('=' * 70)
    linhas.append('  VERIFICAÇÃO DO SISTEMA — Hospital Anchieta Ceilandia')
    linhas.append('  Executado em: {}'.format(agora))
    linhas.append('=' * 70)

    cat_atual = None
    for r in resultados:
        if r['categoria'] != cat_atual:
            cat_atual = r['categoria']
            linhas.append('')
            linhas.append('─' * 70)
            linhas.append('  ' + _TITULOS_CAT.get(cat_atual, cat_atual.upper()))
            linhas.append('─' * 70)

        nivel = r.get('nivel', 'ok' if r['ok'] else 'erro')
        if nivel == 'aviso':
            icone = '[AVISO] '
        elif r['ok']:
            icone = '[OK]    '
        else:
            icone = '[ERRO]  '

        item_fmt = (r['item'] + ' ').ljust(50, '.')
        linhas.append('{}{} {}'.format(icone, item_fmt, r['detalhe']))

    if reparos:
        linhas.append('')
        linhas.append('─' * 70)
        linhas.append('  REPAROS AUTOMÁTICOS APLICADOS')
        linhas.append('─' * 70)
        for item, ok, detalhe in reparos:
            icone = '[REP]   ' if ok else '[FALHOU]'
            linhas.append('{}{} {}'.format(icone, (item + ' ').ljust(50, '.'), detalhe))

    total    = len(resultados)
    erros    = sum(1 for r in resultados if not r['ok'])
    avisos   = sum(1 for r in resultados if r.get('nivel') == 'aviso')
    ok_qt    = total - erros - avisos
    rep_ok   = sum(1 for _, ok, _ in reparos if ok)

    linhas.append('')
    linhas.append('=' * 70)
    linhas.append('  RESULTADO: {} OK | {} AVISO(S) | {} ERRO(S) | {} REPARO(S) | {:.1f}s'.format(
        ok_qt, avisos, erros, rep_ok, duracao))
    linhas.append('=' * 70)

    return '\n'.join(linhas)


# ─────────────────────────────────────────────────────────
# FORMATAÇÃO: EMAIL HTML
# ─────────────────────────────────────────────────────────

def montar_email_html(resultados, reparos, duracao):
    """Gera email HTML com o relatório completo."""
    agora   = datetime.now().strftime('%d/%m/%Y %H:%M')
    total   = len(resultados)
    erros   = sum(1 for r in resultados if not r['ok'])
    avisos  = sum(1 for r in resultados if r.get('nivel') == 'aviso')
    ok_qt   = total - erros - avisos
    rep_ok  = sum(1 for _, ok, _ in reparos if ok)

    if erros > 0:
        cor_hdr = '#dc3545'
        status  = '{} ERRO(S) DETECTADO(S)'.format(erros)
    elif avisos > 0:
        cor_hdr = '#fd7e14'
        status  = 'SISTEMA OK COM {} AVISO(S)'.format(avisos)
    else:
        cor_hdr = '#28a745'
        status  = 'SISTEMA SAUDÁVEL'

    linhas_resultados = ''
    cat_atual = None
    for r in resultados:
        if r['categoria'] != cat_atual:
            cat_atual = r['categoria']
            titulo_cat = _TITULOS_CAT.get(cat_atual, cat_atual.upper())
            linhas_resultados += '''
        <tr>
            <td colspan="4" style="padding:6px 10px;background:#f0f4f8;
                font-size:11px;font-weight:700;color:#374151;
                text-transform:uppercase;letter-spacing:.6px;
                border-bottom:2px solid #d1d5db;">{}</td>
        </tr>'''.format(titulo_cat)

        nivel = r.get('nivel', 'ok' if r['ok'] else 'erro')
        if nivel == 'aviso':
            cor   = '#856404'
            icone = '⚠'
            bg    = '#fffbeb'
        elif r['ok']:
            cor   = '#166534'
            icone = '✓'
            bg    = '#f0fdf4'
        else:
            cor   = '#991b1b'
            icone = '✗'
            bg    = '#fff1f2'

        linhas_resultados += '''
        <tr style="background:{bg};">
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;
                font-size:11px;color:#6b7280;text-transform:uppercase;">{cat}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;
                font-size:13px;font-weight:500;">{item}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;
                text-align:center;">
                <span style="color:{cor};font-weight:700;font-size:17px;">{icone}</span>
            </td>
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;
                font-size:12px;color:#4b5563;">{detalhe}</td>
        </tr>'''.format(
            bg=bg, cat=r['categoria'], item=r['item'],
            cor=cor, icone=icone, detalhe=r['detalhe']
        )

    secao_reparos = ''
    if reparos:
        linhas_reparos = ''
        for item, ok, detalhe in reparos:
            cor   = '#166534' if ok else '#991b1b'
            icone = '🔧' if ok else '✗'
            linhas_reparos += '''
            <tr>
                <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;
                    font-size:13px;">{item}</td>
                <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;
                    text-align:center;color:{cor};font-weight:700;font-size:16px;">{icone}</td>
                <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;
                    font-size:12px;color:#4b5563;">{detalhe}</td>
            </tr>'''.format(item=item, cor=cor, icone=icone, detalhe=detalhe)

        secao_reparos = '''
        <div style="margin-top:20px;">
            <h3 style="font-size:14px;font-weight:600;color:#92400e;margin:0 0 8px;">
                🔧 Reparos Automáticos Aplicados
            </h3>
            <table style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr style="background:#fef3c7;">
                        <th style="padding:8px 10px;text-align:left;font-size:11px;
                            color:#92400e;text-transform:uppercase;">Item</th>
                        <th style="padding:8px 10px;text-align:center;font-size:11px;
                            color:#92400e;text-transform:uppercase;width:60px;">Status</th>
                        <th style="padding:8px 10px;text-align:left;font-size:11px;
                            color:#92400e;text-transform:uppercase;">Detalhe</th>
                    </tr>
                </thead>
                <tbody>{}</tbody>
            </table>
        </div>'''.format(linhas_reparos)

    proximo = (datetime.now() + timedelta(hours=INTERVALO_HORAS)).strftime('%d/%m/%Y às %H:%M')
    cor_erros = '#dc3545' if erros > 0 else '#6b7280'

    return '''
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
     max-width:750px;margin:0 auto;padding:20px;">

    <div style="background:{cor_hdr};color:white;padding:16px 20px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:18px;">🏥 Relatório de Saúde do Sistema — HAC</h2>
        <p style="margin:6px 0 0;font-size:13px;opacity:.9;">{status} &mdash; {agora}</p>
    </div>

    <div style="border:1px solid #d1d5db;border-top:none;border-radius:0 0 8px 8px;overflow:hidden;">

        <div style="display:flex;border-bottom:1px solid #d1d5db;">
            <div style="flex:1;padding:14px;text-align:center;background:#f9fafb;">
                <div style="font-size:26px;font-weight:700;color:#166534;">{ok_qt}</div>
                <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">OK</div>
            </div>
            <div style="flex:1;padding:14px;text-align:center;background:#fffbeb;
                border-left:1px solid #d1d5db;">
                <div style="font-size:26px;font-weight:700;color:#92400e;">{avisos}</div>
                <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Avisos</div>
            </div>
            <div style="flex:1;padding:14px;text-align:center;background:#f9fafb;
                border-left:1px solid #d1d5db;">
                <div style="font-size:26px;font-weight:700;color:{cor_erros};">{erros}</div>
                <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Erros</div>
            </div>
            <div style="flex:1;padding:14px;text-align:center;background:#f9fafb;
                border-left:1px solid #d1d5db;">
                <div style="font-size:26px;font-weight:700;color:#0d6efd;">{rep_ok}</div>
                <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Reparados</div>
            </div>
            <div style="flex:1;padding:14px;text-align:center;background:#f9fafb;
                border-left:1px solid #d1d5db;">
                <div style="font-size:26px;font-weight:700;color:#6b7280;">{duracao}s</div>
                <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Duração</div>
            </div>
        </div>

        <div style="padding:16px 20px;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                    <tr style="background:#f9fafb;">
                        <th style="padding:8px 10px;text-align:left;font-size:11px;
                            color:#6b7280;text-transform:uppercase;width:90px;">Categoria</th>
                        <th style="padding:8px 10px;text-align:left;font-size:11px;
                            color:#6b7280;text-transform:uppercase;">Verificação</th>
                        <th style="padding:8px 10px;text-align:center;font-size:11px;
                            color:#6b7280;text-transform:uppercase;width:50px;"></th>
                        <th style="padding:8px 10px;text-align:left;font-size:11px;
                            color:#6b7280;text-transform:uppercase;">Detalhe</th>
                    </tr>
                </thead>
                <tbody>{linhas}</tbody>
            </table>
            {reparos}
        </div>

        <div style="padding:12px 20px;background:#f9fafb;text-align:center;
            border-top:1px solid #d1d5db;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">
                Verificação automática a cada {intervalo}h &mdash; Próxima: {proximo}<br>
                Sistema de Painéis HAC &mdash;
                <a href="http://172.16.1.75:5000/api/admin/tests/page"
                   style="color:#0d6efd;">Ver painel de testes</a>
            </p>
        </div>
    </div>
</div>'''.format(
        cor_hdr=cor_hdr, status=status, agora=agora,
        ok_qt=ok_qt, avisos=avisos,
        erros=erros, cor_erros=cor_erros,
        rep_ok=rep_ok, duracao=duracao,
        linhas=linhas_resultados,
        reparos=secao_reparos,
        intervalo=INTERVALO_HORAS, proximo=proximo
    )


# ─────────────────────────────────────────────────────────
# ENVIO DE EMAIL
# ─────────────────────────────────────────────────────────

def enviar_relatorio(resultados, reparos, duracao):
    """Envia relatório por email para EMAIL_RELATORIO."""
    if not SMTP_HOST or not SMTP_USER or not SMTP_PASS:
        logger.warning('[tests_sistema] SMTP não configurado — relatório não enviado')
        return False

    try:
        import apprise
        from urllib.parse import quote as url_encode

        erros  = sum(1 for r in resultados if not r['ok'])
        avisos = sum(1 for r in resultados if r.get('nivel') == 'aviso')
        rep_ok = sum(1 for _, ok, _ in reparos if ok)

        if erros > 0:
            status = '{} ERRO(S)'.format(erros)
        elif avisos > 0:
            status = '{} AVISO(S)'.format(avisos)
        else:
            status = 'OK'

        titulo = '[HAC Sistema] {} — Relatório {}'.format(
            status, datetime.now().strftime('%d/%m/%Y %H:%M'))

        html = montar_email_html(resultados, reparos, duracao)

        ap = apprise.Apprise()
        from_addr = SMTP_FROM or SMTP_USER
        url = 'mailtos://{user}:{pwd}@{host}:{port}?from={sender}&to={to}&name=Sistema+HAC'.format(
            user=url_encode(SMTP_USER, safe=''),
            pwd=url_encode(SMTP_PASS, safe=''),
            host=SMTP_HOST, port=SMTP_PORT,
            sender=url_encode(from_addr, safe=''),
            to=url_encode(EMAIL_RELATORIO, safe='')
        )
        ap.add(url)

        if erros > 0:
            tipo_notif = apprise.NotifyType.FAILURE
        elif avisos > 0:
            tipo_notif = apprise.NotifyType.WARNING
        else:
            tipo_notif = apprise.NotifyType.SUCCESS

        ok = ap.notify(title=titulo, body=html,
                       body_format=apprise.NotifyFormat.HTML,
                       notify_type=tipo_notif)
        if ok:
            logger.info('[tests_sistema] Relatório enviado para %s', EMAIL_RELATORIO)
        else:
            logger.warning('[tests_sistema] Falha ao enviar relatório por email')
        return ok

    except Exception as e:
        logger.error('[tests_sistema] Erro ao enviar email: %s', e)
        return False


# ─────────────────────────────────────────────────────────
# CICLO PRINCIPAL
# ─────────────────────────────────────────────────────────

def executar_tudo(enviar_email=True):
    """
    Executa verificações + reparos e opcionalmente envia email.
    Retorna dict compatível com o frontend /api/admin/tests/sistema/run.
    """
    logger.info('[tests_sistema] Iniciando verificação do sistema...')
    resultados, conn, redis_client, duracao = executar_verificacoes()
    reparos = executar_reparos(resultados, conn, redis_client)

    erros  = sum(1 for r in resultados if not r['ok'])
    avisos = sum(1 for r in resultados if r.get('nivel') == 'aviso')
    ok_qt  = len(resultados) - erros - avisos
    rep_ok = sum(1 for _, ok, _ in reparos if ok)

    logger.info(
        '[tests_sistema] Concluído: %s checks | %s OK | %s aviso(s) | %s erro(s) | %s reparo(s) | %.1fs',
        len(resultados), ok_qt, avisos, erros, rep_ok, duracao)

    if conn:
        try:
            conn.close()
        except Exception:
            pass

    if enviar_email:
        enviar_relatorio(resultados, reparos, duracao)

    saida = montar_saida_terminal(resultados, reparos, duracao)

    return {
        'output':  saida,
        'duracao': duracao,
        'report': {
            'summary': {
                'total':     len(resultados),
                'ok':        ok_qt,
                'avisos':    avisos,
                'erros':     erros,
                'reparados': rep_ok,
            },
            'duration':   duracao,
            'resultados': resultados,
            'reparos':    [{'item': i, 'ok': o, 'detalhe': d} for i, o, d in reparos],
        }
    }


def ciclo_automatico():
    """Ciclo de 6h: verifica, repara e envia email."""
    try:
        executar_tudo(enviar_email=True)
    except Exception as e:
        logger.error('[tests_sistema] Erro no ciclo automático: %s', e, exc_info=True)


# ─────────────────────────────────────────────────────────
# INTEGRAÇÃO FLASK (thread daemon)
# ─────────────────────────────────────────────────────────

_background_started = False


def start_in_background():
    """Inicia o worker como thread daemon junto com o Flask."""
    global _background_started
    if _background_started:
        return

    try:
        from werkzeug.serving import is_running_from_reloader
        if is_running_from_reloader() and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
            return
    except ImportError:
        pass

    _background_started = True

    def _run():
        import schedule as _sched
        _scheduler = _sched.Scheduler()

        logger.info('[tests_sistema] Worker iniciado — verificação a cada %sh', INTERVALO_HORAS)

        time.sleep(30)
        ciclo_automatico()

        _scheduler.every(INTERVALO_HORAS).hours.do(ciclo_automatico)

        while True:
            _scheduler.run_pending()
            time.sleep(60)

    t = threading.Thread(target=_run, name='worker_tests_sistema', daemon=True)
    t.start()
    logger.info('[tests_sistema] Thread daemon registrada (ciclo a cada %sh)', INTERVALO_HORAS)


# ─────────────────────────────────────────────────────────
# MAIN (execução manual)
# ─────────────────────────────────────────────────────────

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Verificação do Sistema HAC')
    parser.add_argument('--sem-email', action='store_true',
                        help='Não envia email com o relatório')
    args = parser.parse_args()

    dados = executar_tudo(enviar_email=not args.sem_email)
    print(dados['output'])
    erros = dados['report']['summary']['erros']
    sys.exit(1 if erros > 0 else 0)
