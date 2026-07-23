# -*- coding: utf-8 -*-
import os
import sys
import json
import time
import threading
from datetime import datetime
from psycopg2.extras import RealDictCursor
from .config import (logger, DB_CONFIG, SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM,
                     INTERVALO_MIN, GCHAT_WEBHOOK_PS)
from .banco import get_connection, buscar_destinatarios_email, detectar_alertas, clinica_em_cooldown, _chave_clinica
from .email import montar_email_html, enviar_email, enviar_gchat

_background_started = False
_stop_event = threading.Event()


def _registrar_log(conn, ds_clinica, qt_aguardando, max_espera_min, sucesso, resposta):
    """Insere ou atualiza registro no log de notificacoes (upsert por chave diaria)."""
    cursor = conn.cursor()
    agora = datetime.now()
    chave = _chave_clinica(ds_clinica)

    cursor.execute("SELECT id FROM notificacoes_log WHERE chave_evento = %s LIMIT 1", (chave,))
    existente = cursor.fetchone()

    dados_extra = json.dumps({'qt_aguardando': qt_aguardando, 'max_espera_min': max_espera_min, 'clinica': ds_clinica})

    if existente:
        cursor.execute("""
            UPDATE notificacoes_log
            SET dt_ultima_notificacao = %s,
                qt_notificacoes = qt_notificacoes + 1,
                status = %s,
                resposta_ntfy = %s,
                dados_extra = %s
            WHERE id = %s
        """, (agora, 'notificado' if sucesso else 'erro', resposta, dados_extra, existente[0]))
    else:
        cursor.execute("""
            INSERT INTO notificacoes_log
                (tipo_evento, chave_evento, nr_atendimento, nm_setor,
                 dados_extra, topico_ntfy, status, dt_detectado,
                 dt_primeira_notificacao, dt_ultima_notificacao,
                 qt_notificacoes, resposta_ntfy)
            VALUES
                (%s, %s, %s, %s,
                 %s, %s, %s, %s,
                 %s, %s,
                 %s, %s)
        """, (
            'paciente_ps_sem_medico', chave, None, ds_clinica,
            dados_extra, '',
            'notificado' if sucesso else 'erro',
            agora,
            agora if sucesso else None,
            agora if sucesso else None,
            1 if sucesso else 0,
            resposta
        ))
    conn.commit()
    cursor.close()


def verificar_pacientes_ps():
    """
    Detecta clinicas com pacientes aguardando >= ESPERA_MIN_ALERTA min sem medico.
    Envia email agrupado por ciclo. Reenvio controlado por cooldown por clinica.
    """
    logger.info('=' * 50)
    logger.info('Verificando pacientes PS sem medico...')

    conn = get_connection()
    if not conn:
        return

    try:
        alertas = detectar_alertas(conn)

        if not alertas:
            logger.info('[paciente_ps] Nenhuma clinica em alerta.')
            return

        logger.info('[paciente_ps] %s clinica(s) em alerta: %s',
                    len(alertas), [a['ds_clinica'] for a in alertas])

        alertas_novos = [a for a in alertas if not clinica_em_cooldown(conn, a['ds_clinica'])]

        if not alertas_novos:
            logger.info('[paciente_ps] Todas as clinicas em cooldown. Aguardando proximo ciclo.')
            return

        logger.info('[paciente_ps] %s clinica(s) a notificar: %s',
                    len(alertas_novos), [a['ds_clinica'] for a in alertas_novos])

        destinatarios = buscar_destinatarios_email(conn)
        if not destinatarios:
            logger.warning('[paciente_ps] Sem destinatarios ativos. Cadastre no Painel 26.')
            return

        titulo = '[ALERTA PS] {} clinica(s) sem medico com pacientes aguardando'.format(len(alertas_novos))
        corpo_html = montar_email_html(alertas_novos)
        sucesso_email, resposta_email = enviar_email(destinatarios, titulo, corpo_html)

        # Google Chat independente — falha de um nao cancela o outro
        sucesso_gchat, resposta_gchat = enviar_gchat(alertas_novos)
        if GCHAT_WEBHOOK_PS:
            if sucesso_gchat:
                logger.info('[paciente_ps] Google Chat enviado.')
            else:
                logger.warning('[paciente_ps] Falha Google Chat: %s', resposta_gchat)

        sucesso = sucesso_email or sucesso_gchat
        resposta = 'email={} gchat={}'.format(resposta_email, resposta_gchat)

        for alerta in alertas_novos:
            _registrar_log(conn, alerta['ds_clinica'], alerta['qt_aguardando'],
                           alerta['max_espera_min'], sucesso, resposta)

        if sucesso_email:
            logger.info('[paciente_ps] Email enviado para %s destinatario(s).', len(destinatarios))
        else:
            logger.warning('[paciente_ps] Falha email: %s', resposta_email)

    except Exception as e:
        logger.error('[paciente_ps] Erro no ciclo: %s', e, exc_info=True)
    finally:
        conn.close()


def stop():
    _stop_event.set()


def start_in_background():
    """
    Inicia como thread daemon junto ao Flask.
    OFF SWITCH: NOTIF_PACIENTE_PS_AUTO=false no .env
    """
    global _background_started
    if _background_started:
        return

    if os.getenv('NOTIF_PACIENTE_PS_AUTO', 'true').lower() != 'true':
        logger.info('[notificador_paciente_ps] Auto-start desativado (NOTIF_PACIENTE_PS_AUTO=false)')
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
            logger.info('[notificador_paciente_ps] Thread daemon iniciada (PID %s, intervalo %smin)',
                        os.getpid(), INTERVALO_MIN)
            verificar_pacientes_ps()
            _scheduler.every(INTERVALO_MIN).minutes.do(verificar_pacientes_ps)
            while not _stop_event.is_set():
                _scheduler.run_pending()
                _stop_event.wait(30)
        except Exception as e:
            logger.error('[notificador_paciente_ps] Erro fatal na thread daemon: %s', e, exc_info=True)

    t = threading.Thread(target=_run, name='notificador_paciente_ps', daemon=True)
    t.start()
    logger.info('[notificador_paciente_ps] Thread daemon registrada')
    return _stop_event


def main():
    logger.info('=' * 60)
    logger.info('  NOTIFICADOR PACIENTE PS SEM MEDICO')
    logger.info('  Intervalo: %s min | Alerta a partir de: 10 min de espera', INTERVALO_MIN)
    logger.info('  SMTP: %s via %s:%s', SMTP_FROM or SMTP_USER, SMTP_HOST or '(nao configurado)', 587)
    logger.info('  GChat: %s', GCHAT_WEBHOOK_PS[:60] + '...' if GCHAT_WEBHOOK_PS else '(nao configurado)')
    logger.info('  Banco: %s@%s:%s/%s',
                DB_CONFIG['user'], DB_CONFIG['host'],
                DB_CONFIG['port'], DB_CONFIG['database'])
    logger.info('=' * 60)

    if not SMTP_USER or not SMTP_PASS or not SMTP_HOST:
        logger.error('SMTP nao configurado no .env (SMTP_HOST, SMTP_USER, SMTP_PASS obrigatorios)')
        sys.exit(1)

    conn = get_connection()
    if not conn:
        logger.error('Falha na conexao inicial. Encerrando.')
        sys.exit(1)

    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT COUNT(*) AS qt
        FROM notificacoes_destinatarios
        WHERE tipo_evento = 'paciente_ps_sem_medico' AND ativo = true
    """)
    qt = cursor.fetchone()['qt']
    cursor.close()
    conn.close()

    logger.info('Destinatarios ativos para paciente_ps_sem_medico: %s', qt)
    if qt == 0:
        logger.warning('ATENCAO: Nenhum destinatario configurado! Cadastre no Painel 26.')

    verificar_pacientes_ps()

    import schedule
    schedule.every(INTERVALO_MIN).minutes.do(verificar_pacientes_ps)
    logger.info('Scheduler ativo. Proximo ciclo em %s min...', INTERVALO_MIN)

    try:
        while True:
            schedule.run_pending()
            time.sleep(30)
    except KeyboardInterrupt:
        logger.info('Encerrado pelo usuario (Ctrl+C)')
    except Exception as e:
        logger.error('Erro fatal: %s', e)
        sys.exit(1)
