# -*- coding: utf-8 -*-
import os
import sys
import time
import threading
from datetime import datetime, timedelta
from .config import logger, _cfg
from .banco import buscar_dados
from .utils import _calcular_periodo
from .excel import gerar_excel
from .email import gerar_html, enviar_email

_background_started = False
_stop_event = threading.Event()


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


def executar_envio():
    cfg = _cfg()
    if not cfg['destinatarios']:
        logger.warning("Nenhum destinatario em NOTIF_PADIOLEIRO_EMAILS. Pulando.")
        return

    now = datetime.now()
    inicio, fim, horas_periodo, nome_periodo, turno = _calcular_periodo(now)

    logger.info("Iniciando coleta - %s - %s (%s -> %s)",
                now.strftime('%d/%m/%Y %H:%M'), nome_periodo,
                inicio.strftime('%d/%m %H:%M'), fim.strftime('%d/%m %H:%M'))

    try:
        resumo, por_padioleiro, por_setor, por_hora, tendencia_7d, todos_hoje, cancelados = buscar_dados(inicio, fim)
    except Exception as e:
        logger.error("Erro ao buscar dados do banco: %s", e)
        return

    logger.info("Dados: total=%s concluidos=%s cancelados=%s padioleiros=%s",
                resumo.get('total', 0), resumo.get('concluidos', 0),
                resumo.get('cancelados', 0), len(por_padioleiro))

    excel_path = None
    try:
        excel_path = gerar_excel(resumo, por_padioleiro, por_setor, por_hora, tendencia_7d, todos_hoje, cancelados,
                                 now, horas_periodo, nome_periodo)
        html = gerar_html(resumo, por_padioleiro, por_setor, cancelados, now, nome_periodo)
        enviar_email(cfg['destinatarios'], html, excel_path, now, nome_periodo, turno)
    except Exception as e:
        logger.error("Erro ao gerar/enviar relatorio: %s", e)
    finally:
        if excel_path and os.path.exists(excel_path):
            os.unlink(excel_path)


def stop():
    _stop_event.set()


def start_in_background():
    """
    Inicia como thread daemon junto ao Flask.
    OFF SWITCH: NOTIF_PADIOLEIRO_AUTO=false no .env
    """
    global _background_started
    if _background_started:
        return

    if os.getenv('NOTIF_PADIOLEIRO_AUTO', 'true').lower() != 'true':
        logger.info('[notificador_padioleiro] Auto-start desativado (NOTIF_PADIOLEIRO_AUTO=false)')
        return

    flask_debug = (os.environ.get('FLASK_ENV') == 'development' or
                   os.environ.get('FLASK_DEBUG', '0') in ('1', 'true', 'True'))
    if flask_debug and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        return

    _background_started = True
    _stop_event.clear()

    def _run():
        try:
            cfg = _cfg()
            logger.info('[notificador_padioleiro] Thread daemon iniciada - destinatarios: %s | horarios: %s',
                        cfg['destinatarios'], cfg['horarios'])
            while not _stop_event.is_set():
                cfg = _cfg()
                proximo = _proximo_horario(cfg['horarios']) if cfg['horarios'] else \
                          datetime.now() + timedelta(hours=12)
                if proximo is None:
                    proximo = datetime.now() + timedelta(hours=12)
                logger.info('[notificador_padioleiro] Proximo envio: %s', proximo.strftime('%d/%m/%Y %H:%M'))
                while not _stop_event.is_set() and datetime.now() < proximo:
                    _stop_event.wait(30)
                if not _stop_event.is_set():
                    executar_envio()
        except Exception as e:
            logger.error('[notificador_padioleiro] Erro fatal na thread daemon: %s', e, exc_info=True)

    t = threading.Thread(target=_run, name='notificador_padioleiro', daemon=True)
    t.start()
    logger.info('[notificador_padioleiro] Thread daemon registrada')
    return _stop_event


def main():
    logger.info("=" * 50)
    logger.info("Notificador de Movimentacoes Padioleiro - Iniciando")
    logger.info("=" * 50)

    cfg = _cfg()
    logger.info("Destinatarios : %s", cfg['destinatarios'] or '(nenhum)')
    logger.info("Horarios      : %s", cfg['horarios'] or '(nao configurado)')

    if not cfg['destinatarios']:
        logger.error("Configure NOTIF_PADIOLEIRO_EMAILS no .env e reinicie.")
        sys.exit(1)

    executar_envio()

    while True:
        cfg = _cfg()
        proximo = _proximo_horario(cfg['horarios']) if cfg['horarios'] else \
                  datetime.now() + timedelta(hours=12)
        if proximo is None:
            proximo = datetime.now() + timedelta(hours=12)
        logger.info("Proximo envio: %s", proximo.strftime('%d/%m/%Y %H:%M'))
        while datetime.now() < proximo:
            time.sleep(30)
        executar_envio()
