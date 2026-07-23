# -*- coding: utf-8 -*-
import os
import sys
import time
import threading
from datetime import datetime, timedelta
from .config import logger, _cfg
from .banco import buscar_dados
from .excel import gerar_excel
from .email import gerar_corpo_html, enviar_email

_background_started = False
_stop_event = threading.Event()

# Estado observavel — consultado pelo endpoint /api/health/ocupacao
_status = {
    'thread_alive': False,
    'auto_start': None,
    'destinatarios_configurados': 0,
    'horarios_configurados': [],
    'ultimo_envio': None,
    'ultimo_resultado': None,
    'ultimo_erro': None,
    'proximo_envio': None,
    'erros_consecutivos': 0,
}


def get_status():
    """Retorna estado atual do worker para o endpoint de health check."""
    cfg = _cfg()
    alive = any(t.name == 'notificador_ocupacao' and t.is_alive() for t in threading.enumerate())
    return {
        **_status,
        'thread_alive': alive,
        'auto_start': os.getenv('NOTIF_OCUPACAO_AUTO', 'true').lower() == 'true',
        'destinatarios_configurados': len(cfg['destinatarios']),
        'horarios_configurados': cfg['horarios'],
    }


def executar_envio():
    global _status
    cfg = _cfg()
    if not cfg['destinatarios']:
        logger.warning("Nenhum destinatario em NOTIF_OCUPACAO_EMAILS. Pulando.")
        _status['ultimo_envio'] = datetime.now().isoformat()
        _status['ultimo_resultado'] = 'sem_destinatarios'
        return

    now = datetime.now()
    logger.info("Iniciando coleta de dados - %s", now.strftime('%d/%m/%Y %H:%M'))

    try:
        dashboard, cols_setor, setores, cols_pac, pacientes = buscar_dados()
    except Exception as e:
        logger.error("Erro ao buscar dados do banco: %s", e)
        _status['ultimo_envio'] = now.isoformat()
        _status['ultimo_resultado'] = 'erro'
        _status['ultimo_erro'] = str(e)
        _status['erros_consecutivos'] = _status.get('erros_consecutivos', 0) + 1
        return

    caminho = None
    try:
        caminho = gerar_excel(dashboard, cols_setor, setores, cols_pac, pacientes, now)
        html = gerar_corpo_html(dashboard, setores, now)
        ok = enviar_email(cfg['destinatarios'], html, caminho, now)
        _status['ultimo_envio'] = now.isoformat()
        _status['ultimo_resultado'] = 'ok' if ok else 'erro_smtp'
        if ok:
            _status['erros_consecutivos'] = 0
            _status['ultimo_erro'] = None
        else:
            _status['erros_consecutivos'] = _status.get('erros_consecutivos', 0) + 1
    except Exception as e:
        logger.error("Erro ao gerar/enviar relatorio: %s", e)
        _status['ultimo_envio'] = now.isoformat()
        _status['ultimo_resultado'] = 'erro'
        _status['ultimo_erro'] = str(e)
        _status['erros_consecutivos'] = _status.get('erros_consecutivos', 0) + 1
    finally:
        if caminho and os.path.exists(caminho):
            os.unlink(caminho)


def _proximo_horario(horarios):
    now = datetime.now()
    candidatos = []
    for h in horarios:
        try:
            hora, minuto = map(int, h.split(':'))
        except ValueError:
            continue
        c = now.replace(hour=hora, minute=minuto, second=0, microsecond=0)
        if c <= now:
            c += timedelta(days=1)
        candidatos.append(c)
    return min(candidatos) if candidatos else None


def stop():
    _stop_event.set()


def start_in_background():
    """
    Inicia como thread daemon junto ao Flask.
    OFF SWITCH: NOTIF_OCUPACAO_AUTO=false no .env
    """
    global _background_started
    if _background_started:
        return

    if os.getenv('NOTIF_OCUPACAO_AUTO', 'true').lower() != 'true':
        logger.info('[notificador_ocupacao] Auto-start desativado (NOTIF_OCUPACAO_AUTO=false)')
        return

    flask_debug = (os.environ.get('FLASK_ENV') == 'development' or
                   os.environ.get('FLASK_DEBUG', '0') in ('1', 'true', 'True'))
    if flask_debug and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        return

    _background_started = True
    _stop_event.clear()

    def _run():
        global _status
        try:
            cfg = _cfg()
            logger.info(
                '[notificador_ocupacao] Thread daemon iniciada - destinatarios: %s | horarios: %s | intervalo: %sh',
                cfg['destinatarios'], cfg['horarios'], cfg['intervalo_h']
            )
            while not _stop_event.is_set():
                cfg = _cfg()
                proximo = _proximo_horario(cfg['horarios']) if cfg['horarios'] else \
                          datetime.now() + timedelta(hours=cfg['intervalo_h'])
                if proximo is None:
                    proximo = datetime.now() + timedelta(hours=6)
                _status['proximo_envio'] = proximo.strftime('%d/%m/%Y %H:%M')
                logger.info('[notificador_ocupacao] Proximo envio: %s', proximo.strftime('%d/%m/%Y %H:%M'))
                while not _stop_event.is_set() and datetime.now() < proximo:
                    _stop_event.wait(30)
                if not _stop_event.is_set():
                    executar_envio()
        except Exception as e:
            logger.error('[notificador_ocupacao] Erro fatal na thread daemon: %s', e, exc_info=True)

    t = threading.Thread(target=_run, name='notificador_ocupacao', daemon=True)
    t.start()
    logger.info('[notificador_ocupacao] Thread daemon registrada')
    return _stop_event


def main():
    logger.info("=" * 50)
    logger.info("Notificador de Ocupacao Hospitalar - Iniciando")
    logger.info("=" * 50)

    cfg = _cfg()
    logger.info("Destinatarios : %s", cfg['destinatarios'] or '(nenhum)')
    logger.info("Horarios fixos: %s", cfg['horarios'] or '(nao configurado)')
    logger.info("Intervalo     : %sh", cfg['intervalo_h'])

    if not cfg['destinatarios']:
        logger.error("Configure NOTIF_OCUPACAO_EMAILS no .env e reinicie.")
        sys.exit(1)

    executar_envio()

    while True:
        cfg = _cfg()
        proximo = _proximo_horario(cfg['horarios']) if cfg['horarios'] else \
                  datetime.now() + timedelta(hours=cfg['intervalo_h'])
        if proximo is None:
            proximo = datetime.now() + timedelta(hours=6)
        logger.info("Proximo envio: %s", proximo.strftime('%d/%m/%Y %H:%M'))
        while datetime.now() < proximo:
            time.sleep(30)
        executar_envio()
