# -*- coding: utf-8 -*-
import os
import time
import email
import threading
import traceback
from .config import logger, INTERVALO_SEG, _TOKEN_RE
from .imap import conectar_imap, _decodificar_header, _extrair_texto_reply, _formatar_data_email
from .banco import _get_conn, processar_resposta

_background_started = False
_stop_event = threading.Event()


def verificar_respostas_email():
    """
    Conecta ao IMAP, procura emails nao lidos que contenham [TRAT:N] no assunto,
    processa cada resposta e marca como lido.
    """
    logger.info('[IMAP] Iniciando verificacao de respostas...')

    try:
        imap = conectar_imap()
    except Exception as e:
        logger.error('[IMAP] Falha ao conectar ao IMAP: %s', e)
        return

    try:
        imap.select('INBOX')
        _, ids = imap.search(None, 'UNSEEN')
        ids_lista = [i for i in ids[0].split() if i]

        if not ids_lista:
            logger.info('[IMAP] Nenhum email nao lido.')
            imap.logout()
            return

        logger.info('[IMAP] %d email(s) nao lido(s) na INBOX.', len(ids_lista))
        processados = 0

        for uid in ids_lista:
            try:
                _, data = imap.fetch(uid, '(RFC822)')
                raw = data[0][1]
                msg = email.message_from_bytes(raw)

                assunto = _decodificar_header(msg.get('Subject', ''))
                remetente = _decodificar_header(msg.get('From', ''))
                date_header = msg.get('Date', '')

                match = _TOKEN_RE.search(assunto)
                if not match:
                    # Nao e resposta de tratativa — apenas marca como lido
                    imap.store(uid, '+FLAGS', '\\Seen')
                    continue

                tratativa_id = int(match.group(1))
                corpo = _extrair_texto_reply(msg)
                data_email = _formatar_data_email(date_header)

                logger.info('[IMAP] Email encontrado | Tratativa #%d | De: %s | Assunto: %s',
                            tratativa_id, remetente, assunto)

                try:
                    conn = _get_conn()
                    try:
                        ok = processar_resposta(conn, tratativa_id, remetente, corpo, data_email)
                        if ok:
                            processados += 1
                    finally:
                        conn.close()
                except Exception as e:
                    logger.error('[IMAP] Erro ao processar resposta da tratativa #%d: %s',
                                 tratativa_id, e)

                # Marca como lido independente do resultado (evita reprocessar)
                imap.store(uid, '+FLAGS', '\\Seen')

            except Exception as e:
                logger.error('[IMAP] Erro ao processar email uid=%s: %s', uid, e)

        logger.info('[IMAP] Verificacao concluida. Processados: %d/%d emails com token TRAT.',
                    processados, len(ids_lista))

    except Exception as e:
        logger.error('[IMAP] Erro durante verificacao de emails: %s', e)
        traceback.print_exc()
    finally:
        try:
            imap.logout()
        except Exception:
            pass


def stop():
    _stop_event.set()


def start_in_background():
    """
    Inicia como thread daemon junto ao Flask.
    OFF SWITCH: WORKER_IMAP_TRATATIVAS_AUTO=false no .env
    Aguarda 30s no startup para nao sobrecarregar a inicializacao do Flask.
    """
    global _background_started
    if _background_started:
        return

    if os.getenv('WORKER_IMAP_TRATATIVAS_AUTO', 'true').lower() != 'true':
        logger.info('[imap_tratativas] Auto-start desativado (WORKER_IMAP_TRATATIVAS_AUTO=false)')
        return

    flask_debug = (os.environ.get('FLASK_ENV') == 'development' or
                   os.environ.get('FLASK_DEBUG', '0') in ('1', 'true', 'True'))
    if flask_debug and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        return

    _background_started = True
    _stop_event.clear()

    def _run():
        try:
            logger.info('[imap_tratativas] Thread daemon iniciada. Aguardando 30s...')
            _stop_event.wait(30)

            if _stop_event.is_set():
                return

            logger.info('[imap_tratativas] Iniciando ciclos (intervalo: %ds = %.1fh)',
                        INTERVALO_SEG, INTERVALO_SEG / 3600)

            while not _stop_event.is_set():
                try:
                    verificar_respostas_email()
                except Exception as e:
                    logger.error('[imap_tratativas] Erro no ciclo: %s', e, exc_info=True)

                _stop_event.wait(INTERVALO_SEG)

        except Exception as e:
            logger.error('[imap_tratativas] Erro fatal na thread daemon: %s', e, exc_info=True)

    t = threading.Thread(target=_run, name='worker_imap_tratativas', daemon=True)
    t.start()
    logger.info('[imap_tratativas] Thread daemon registrada')
    return _stop_event


def main():
    logger.info('=' * 60)
    logger.info('WORKER IMAP TRATATIVAS - INICIANDO')
    logger.info('Intervalo: %.1fh (%ds)', INTERVALO_SEG / 3600, INTERVALO_SEG)
    logger.info('=' * 60)

    while True:
        try:
            verificar_respostas_email()
        except KeyboardInterrupt:
            logger.info('Worker encerrado pelo usuario.')
            break
        except Exception as e:
            logger.error('[IMAP] Erro no loop principal: %s', e)
            traceback.print_exc()

        try:
            time.sleep(INTERVALO_SEG)
        except KeyboardInterrupt:
            logger.info('Worker encerrado pelo usuario.')
            break
