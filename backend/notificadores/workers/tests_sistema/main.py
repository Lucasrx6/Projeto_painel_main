# -*- coding: utf-8 -*-
import os
import sys
import threading
from .config import logger, INTERVALO_HORAS
from .verificacoes import executar_verificacoes
from .reparos import executar_reparos
from .relatorio import montar_saida_terminal, enviar_relatorio

_background_started = False
_stop_event = threading.Event()


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
    try:
        executar_tudo(enviar_email=True)
    except Exception as e:
        logger.error('[tests_sistema] Erro no ciclo automático: %s', e, exc_info=True)


def stop():
    _stop_event.set()


def start_in_background():
    """Inicia o worker como thread daemon junto com o Flask."""
    global _background_started
    if _background_started:
        return

    flask_debug = (os.environ.get('FLASK_ENV') == 'development' or
                   os.environ.get('FLASK_DEBUG', '0') in ('1', 'true', 'True'))
    if flask_debug and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        return

    _background_started = True
    _stop_event.clear()

    def _run():
        import schedule as _sched
        _scheduler = _sched.Scheduler()

        logger.info('[tests_sistema] Worker iniciado — verificação a cada %sh', INTERVALO_HORAS)
        _scheduler.every(INTERVALO_HORAS).hours.do(ciclo_automatico)

        while not _stop_event.is_set():
            _scheduler.run_pending()
            _stop_event.wait(60)

    t = threading.Thread(target=_run, name='worker_tests_sistema', daemon=True)
    t.start()
    logger.info('[tests_sistema] Thread daemon registrada (ciclo a cada %sh)', INTERVALO_HORAS)
    return _stop_event


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Verificação do Sistema HAC')
    parser.add_argument('--sem-email', action='store_true',
                        help='Não envia email com o relatório')
    args = parser.parse_args()

    dados = executar_tudo(enviar_email=not args.sem_email)
    print(dados['output'])
    sys.exit(1 if dados['report']['summary']['erros'] > 0 else 0)
