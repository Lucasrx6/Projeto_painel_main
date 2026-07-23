# -*- coding: utf-8 -*-
import os
import sys
import time
import threading
from .config import logger, DB_CONFIG, SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM, INTERVALO_VERIFICACAO
from .banco import get_connection, buscar_tratativas_pendentes, buscar_visitas_atencao, buscar_responsaveis
from .email import montar_email_html, montar_email_html_atencao, enviar_email, _formatar_data
from .snapshot import (
    ja_notificado, ja_notificado_por_chave,
    registrar_log, registrar_log_chave,
    _chave_atencao
)

_background_started = False
_stop_event = threading.Event()


def verificar_tratativas():
    """
    Verifica e notifica:
      1. Tratativas pendentes de itens CRITICOS (email detalhado com obs do item)
      2. Visitas com avaliacao ATENCAO ainda nao notificadas (email de alerta simples)
    Idempotente: reiniciar o servico nao perde nem duplica notificacoes.
    """
    logger.info('=' * 50)
    logger.info('Verificando tratativas criticas e alertas de atencao...')

    conn = get_connection()
    if not conn:
        return

    try:
        # BLOCO 1: itens CRITICOS
        tratativas_atuais = buscar_tratativas_pendentes(conn)
        notif_critico = 0
        ignorados_critico = 0
        sem_resp_critico = 0

        for t in tratativas_atuais:
            tid = t['tratativa_id']
            if ja_notificado(conn, tid):
                ignorados_critico += 1
                continue

            responsaveis = buscar_responsaveis(conn, t['categoria_id'], t['setor_id'])
            titulo = 'Sentir e Agir - CRITICO - {} - {} [TRAT:{}]'.format(
                t.get('categoria_nome', '-'), t.get('setor_nome', '-'), tid
            )

            sucesso_email = False
            resposta_email = 'Sem responsavel com email cadastrado'

            if responsaveis:
                corpo_html = montar_email_html(t)
                sucesso_email, resposta_email = enviar_email(responsaveis, titulo, corpo_html)
            else:
                sem_resp_critico += 1
                logger.info('[critico] Sem responsavel para categoria=%s setor=%s',
                            t.get('categoria_nome'), t.get('setor_nome'))

            registrar_log(conn, tid, t.get('nr_atendimento'),
                          t.get('categoria_nome'), t.get('setor_nome'),
                          responsaveis, sucesso_email, resposta_email)
            notif_critico += 1

        if tratativas_atuais:
            logger.info('[critico] %s notificadas | %s sem responsavel | %s ja enviadas',
                        notif_critico, sem_resp_critico, ignorados_critico)
        else:
            logger.info('[critico] Nenhuma tratativa pendente no momento')

        # BLOCO 2: visitas de ATENCAO
        visitas_atencao = buscar_visitas_atencao(conn)
        notif_atencao = 0
        ignorados_atencao = 0
        sem_resp_atencao = 0

        for v in visitas_atencao:
            vid = v['visita_id']
            chave = _chave_atencao(vid)
            if ja_notificado_por_chave(conn, chave):
                ignorados_atencao += 1
                continue

            responsaveis = buscar_responsaveis(conn, None, v['setor_id'])
            titulo = 'Sentir e Agir - ATENCAO - {} - {}'.format(
                v.get('setor_nome', '-'), _formatar_data(v.get('data_ronda'))
            )

            sucesso_email = False
            resposta_email = 'Sem responsavel com email cadastrado'

            if responsaveis:
                corpo_html = montar_email_html_atencao(v)
                sucesso_email, resposta_email = enviar_email(responsaveis, titulo, corpo_html)
            else:
                sem_resp_atencao += 1
                logger.info('[atencao] Sem responsavel para setor=%s', v.get('setor_nome'))

            registrar_log_chave(conn, 'sentir_agir_atencao', chave,
                                v.get('nr_atendimento'), 'atencao', v.get('setor_nome'),
                                responsaveis, sucesso_email, resposta_email)
            notif_atencao += 1

        if visitas_atencao:
            logger.info('[atencao] %s notificadas | %s sem responsavel | %s ja enviadas',
                        notif_atencao, sem_resp_atencao, ignorados_atencao)
        else:
            logger.info('[atencao] Nenhuma visita de atencao no momento')

    except Exception as e:
        logger.error('[sentir_agir] Erro: %s', e)
    finally:
        conn.close()


def stop():
    _stop_event.set()


def start_in_background():
    """
    Inicia como thread daemon junto ao Flask.
    OFF SWITCH: NOTIF_SENTIR_AGIR_AUTO=false no .env
    """
    global _background_started
    if _background_started:
        return

    if os.getenv('NOTIF_SENTIR_AGIR_AUTO', 'true').lower() != 'true':
        logger.info('[notificador_sentir_agir] Auto-start desativado (NOTIF_SENTIR_AGIR_AUTO=false)')
        return

    flask_debug = (os.environ.get('FLASK_ENV') == 'development' or
                   os.environ.get('FLASK_DEBUG', '0') in ('1', 'true', 'True'))
    if flask_debug and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        return

    _background_started = True
    _stop_event.clear()

    def _run():
        try:
            import schedule as _sched
            _scheduler = _sched.Scheduler()
            logger.info('[notificador_sentir_agir] Thread daemon iniciada (PID %s, intervalo %smin)',
                        os.getpid(), INTERVALO_VERIFICACAO)
            verificar_tratativas()
            _scheduler.every(INTERVALO_VERIFICACAO).minutes.do(verificar_tratativas)
            while not _stop_event.is_set():
                _scheduler.run_pending()
                _stop_event.wait(30)
        except Exception as e:
            logger.error('[notificador_sentir_agir] Erro fatal na thread daemon: %s', e, exc_info=True)

    t = threading.Thread(target=_run, name='notificador_sentir_agir', daemon=True)
    t.start()
    logger.info('[notificador_sentir_agir] Thread daemon registrada')
    return _stop_event


def main():
    """Ponto de entrada standalone."""
    logger.info('=' * 60)
    logger.info('  NOTIFICADOR SENTIR E AGIR - Email')
    logger.info('  Intervalo: %s minutos (padrao 5)', INTERVALO_VERIFICACAO)
    logger.info('  SMTP: %s via %s:%s', SMTP_FROM or '(usar SMTP_USER)', SMTP_HOST or '(nao configurado)', SMTP_PORT)
    logger.info('  Banco: %s@%s:%s/%s',
                DB_CONFIG['user'], DB_CONFIG['host'],
                DB_CONFIG['port'], DB_CONFIG['database'])
    logger.info('=' * 60)

    if not SMTP_USER or not SMTP_PASS:
        logger.error('SMTP_USER e/ou SMTP_PASS nao configurados no .env')
        sys.exit(1)

    if not SMTP_HOST:
        logger.error('SMTP_HOST nao configurado no .env')
        sys.exit(1)

    if not SMTP_FROM:
        logger.info('SMTP_FROM nao definido, usando SMTP_USER: %s', SMTP_USER)

    conn = get_connection()
    if not conn:
        logger.error('Falha na conexao inicial. Encerrando.')
        sys.exit(1)
    conn.close()
    logger.info('Conexao com banco OK')

    verificar_tratativas()

    import schedule
    schedule.every(INTERVALO_VERIFICACAO).minutes.do(verificar_tratativas)
    logger.info('Scheduler ativo. Proximo ciclo em %s min...', INTERVALO_VERIFICACAO)

    try:
        while True:
            schedule.run_pending()
            time.sleep(30)
    except KeyboardInterrupt:
        logger.info('Encerrado pelo usuario (Ctrl+C)')
    except Exception as e:
        logger.error('Erro fatal: %s', e)
        sys.exit(1)
