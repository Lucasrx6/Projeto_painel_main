"""
Configuração Gunicorn — Sistema de Paineis Hospitalares
======================================================

Arquitetura escolhida: 1 worker + gthread (threads)
  - Múltiplos workers fork o processo → cada worker reiniciaria os 6
    notificadores/workers daemon (pareceres, sentir-agir, IMAP, etc.)
    causando e-mails duplicados e múltiplas execuções simultâneas.
  - 1 worker com threads resolve a concorrência sem esse problema.

Capacidade: 8 threads simultâneas — suficiente para 50+ usuários
  (paineis têm refresh de 10-30s e queries de ~200-500ms cada)
"""

import os

# ── Processo ────────────────────────────────────────────────────────────────
workers     = int(os.getenv('GUNICORN_WORKERS', '1'))   # Mantenha 1 (veja nota acima)
worker_class = 'gthread'                                 # Threads por worker (não processos)
threads     = int(os.getenv('GUNICORN_THREADS', '8'))   # Requisições simultâneas

# ── Rede ────────────────────────────────────────────────────────────────────
bind        = os.getenv('GUNICORN_BIND', '0.0.0.0:5000')

# ── Timeouts ────────────────────────────────────────────────────────────────
timeout     = int(os.getenv('GUNICORN_TIMEOUT', '120'))  # 2 min (queries longas do ETL)
keepalive   = 5                                           # Conexões HTTP keep-alive

# ── App ─────────────────────────────────────────────────────────────────────
preload_app = False   # False = cada worker inicializa o pool após fork
                      # (True compartilharia o pool do pai entre workers — problema)

# ── Logs ────────────────────────────────────────────────────────────────────
accesslog   = '-'        # stdout
errorlog    = '-'        # stderr
loglevel    = os.getenv('GUNICORN_LOG_LEVEL', 'warning')
access_log_format = '%(h)s "%(r)s" %(s)s %(b)s %(Dms)sms'

# ── Hooks ───────────────────────────────────────────────────────────────────
def on_starting(server):
    server.log.info("Gunicorn iniciando — Sistema de Paineis HAC")

def post_fork(server, worker):
    server.log.info(f"Worker {worker.pid} iniciado ({threads} threads)")

def worker_exit(server, worker):
    try:
        from backend.database import close_connection_pool
        close_connection_pool()
    except Exception:
        pass
    server.log.warning(f"Worker {worker.pid} encerrado — pool fechado")
