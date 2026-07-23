# -*- coding: utf-8 -*-
import os
import sys
import time
import threading
from psycopg2.extras import RealDictCursor
from .config import logger, DB_CONFIG, NTFY_URL, INTERVALO_VERIFICACAO, SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM
from .banco import get_connection, buscar_destinatarios_email, buscar_topicos_ntfy
from .email import montar_email_html, enviar_email
from .ntfy import enviar_ntfy_topicos
from .snapshot import registrar_log

_background_started = False
_stop_event = threading.Event()


def verificar_pareceres():
    """
    Detecta novos pareceres comparando com snapshot anterior.

    Primeira execucao (snapshot vazio): popula snapshot SEM notificar.
    Execucoes seguintes: detecta delta com horas_pendente <= 0.5 (30min).
    """
    logger.info('=' * 50)
    logger.info('Verificando pareceres pendentes...')

    conn = get_connection()
    if not conn:
        return

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        topicos_ntfy = buscar_topicos_ntfy(conn)

        cursor.execute("""
            SELECT nr_parecer, nr_atendimento, especialidade_destino,
                   horas_pendente, ds_tipo_atendimento, status_parecer
            FROM pareceres_pendentes
            WHERE status_parecer = 'A' OR status_parecer IS NULL
        """)

        pareceres_atuais = cursor.fetchall()
        pareceres_map = {p['nr_parecer']: dict(p) for p in pareceres_atuais}
        pareceres_atuais_set = set(pareceres_map.keys())

        cursor.execute("""
            SELECT nr_atendimento
            FROM notificacoes_snapshot
            WHERE tipo_snapshot = 'pareceres_ativos'
        """)
        pareceres_anteriores = {row['nr_atendimento'] for row in cursor.fetchall()}

        # PRIMEIRA EXECUCAO: popula snapshot sem notificar
        if not pareceres_anteriores:
            logger.info(
                '[pareceres] Primeira execucao - populando snapshot com %s pareceres (sem notificar)',
                len(pareceres_atuais_set)
            )
            for nr_parecer in pareceres_atuais_set:
                cursor.execute("""
                    INSERT INTO notificacoes_snapshot (tipo_snapshot, nr_atendimento)
                    VALUES ('pareceres_ativos', %s)
                """, (nr_parecer,))
            conn.commit()
            cursor.close()
            logger.info('[pareceres] Snapshot populado. Proximos ciclos detectarao novos.')
            return

        novos = pareceres_atuais_set - pareceres_anteriores
        notificados = 0
        ignorados = 0

        for nr_parecer in novos:
            parecer = pareceres_map[nr_parecer]
            horas = parecer.get('horas_pendente') or 0

            if horas > 0.5:
                ignorados += 1
                logger.debug('[pareceres] %s ignorado (%.1fh)', nr_parecer, horas)
                continue

            especialidade = parecer.get('especialidade_destino')
            destinatarios = buscar_destinatarios_email(conn, especialidade)
            titulo = 'Parecer Pendente - {}'.format(especialidade or 'Sem especialidade')

            sucesso_email = False
            resposta_email = 'Sem destinatarios email'

            if destinatarios:
                corpo_html = montar_email_html(parecer)
                sucesso_email, resposta_email = enviar_email(destinatarios, titulo, corpo_html)
            else:
                logger.info('[pareceres] Sem destinatarios email para: %s', especialidade)

            # LGPD: ntfy e publico — apenas especialidade, sem dados do paciente
            mensagem_ntfy = 'Novo parecer pendente: {}'.format(especialidade or '-')
            enviar_ntfy_topicos(topicos_ntfy, titulo, mensagem_ntfy)

            sucesso = sucesso_email or len(topicos_ntfy) > 0
            registrar_log(
                conn, nr_parecer,
                parecer.get('nr_atendimento'),
                especialidade,
                destinatarios,
                topicos_ntfy,
                sucesso, resposta_email
            )
            notificados += 1

        cursor.execute("DELETE FROM notificacoes_snapshot WHERE tipo_snapshot = 'pareceres_ativos'")
        for nr_parecer in pareceres_atuais_set:
            cursor.execute("""
                INSERT INTO notificacoes_snapshot (tipo_snapshot, nr_atendimento)
                VALUES ('pareceres_ativos', %s)
            """, (nr_parecer,))
        conn.commit()
        cursor.close()

        if notificados > 0:
            logger.info('[pareceres] %s notificados (email + %s topicos ntfy)', notificados, len(topicos_ntfy))
        elif ignorados > 0:
            logger.info('[pareceres] %s novos ignorados (> 30min)', ignorados)
        else:
            logger.info('[pareceres] Nenhum novo (%s ativos)', len(pareceres_atuais))

    except Exception as e:
        logger.error('[pareceres] Erro: %s', e)
    finally:
        conn.close()


def stop():
    _stop_event.set()


def start_in_background():
    """
    Inicia como thread daemon junto ao Flask.
    OFF SWITCH: NOTIF_PARECERES_AUTO=false no .env
    """
    global _background_started
    if _background_started:
        return

    if os.getenv('NOTIF_PARECERES_AUTO', 'true').lower() != 'true':
        logger.info('[notificador_pareceres] Auto-start desativado (NOTIF_PARECERES_AUTO=false)')
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

            logger.info('[notificador_pareceres] Thread daemon iniciada (PID %s, intervalo %smin)',
                        os.getpid(), INTERVALO_VERIFICACAO)

            verificar_pareceres()
            _scheduler.every(INTERVALO_VERIFICACAO).minutes.do(verificar_pareceres)

            while not _stop_event.is_set():
                _scheduler.run_pending()
                _stop_event.wait(30)

        except Exception as e:
            logger.error('[notificador_pareceres] Erro fatal na thread daemon: %s', e, exc_info=True)

    t = threading.Thread(target=_run, name='notificador_pareceres', daemon=True)
    t.start()
    logger.info('[notificador_pareceres] Thread daemon registrada')
    return _stop_event


def main():
    """Ponto de entrada standalone."""
    logger.info('=' * 60)
    logger.info('  NOTIFICADOR DE PARECERES - Email + ntfy')
    logger.info('  Intervalo: %s minutos', INTERVALO_VERIFICACAO)
    logger.info('  SMTP: %s via %s:%s', SMTP_FROM or '(usar SMTP_USER)', SMTP_HOST or '(nao configurado)', 587)
    logger.info('  ntfy base: %s', NTFY_URL)
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

    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT
            COUNT(*) FILTER (WHERE canal = 'email') AS qt_email,
            COUNT(*) FILTER (WHERE canal = 'ntfy') AS qt_ntfy
        FROM notificacoes_destinatarios
        WHERE tipo_evento = 'parecer_pendente' AND ativo = true
    """)
    dest_count = cursor.fetchone()
    cursor.close()
    conn.close()

    logger.info('Destinatarios ativos: %s email, %s ntfy', dest_count['qt_email'], dest_count['qt_ntfy'])
    if dest_count['qt_email'] == 0 and dest_count['qt_ntfy'] == 0:
        logger.warning('ATENCAO: Nenhum destinatario configurado no Painel 26!')

    logger.info('Conexao com banco OK')

    verificar_pareceres()

    import schedule
    schedule.every(INTERVALO_VERIFICACAO).minutes.do(verificar_pareceres)
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
