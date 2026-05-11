# -*- coding: utf-8 -*-
"""
Worker IMAP - Captura de Respostas para Tratativas (Sentir e Agir)
===================================================================

Monitora a caixa IMAP buscando respostas aos emails de notificacao de
tratativas. Quando uma resposta e encontrada:
  - Extrai o ID da tratativa do token [TRAT:XXXXX] no assunto
  - Atualiza status → regularizado
  - Preenche observacoes_resolucao com o corpo da resposta
  - Registra resolvido_por com o email do respondente
  - Atualiza status_tratativa da visita pai automaticamente
  - Registra a acao em sentir_agir_log (auditoria)

Intervalo configuravel via IMAP_REPLY_INTERVALO_H no .env (padrao: 1h)

OFF SWITCH: WORKER_IMAP_TRATATIVAS_AUTO=false no .env

Execucao:
    python worker_imap_tratativas.py         (standalone)
    integrado em app.py via start_in_background()
"""

import imaplib
import email
import email.header
import psycopg2
from psycopg2.extras import RealDictCursor
import os
import re
import time
import logging
import logging.handlers
import sys
import threading
from datetime import datetime
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))


# =========================================================
# LOGGING
# =========================================================

LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
os.makedirs(LOG_DIR, exist_ok=True)

logger = logging.getLogger('worker_imap_tratativas')
logger.setLevel(logging.INFO)

file_handler = logging.handlers.RotatingFileHandler(
    os.path.join(LOG_DIR, 'worker_imap_tratativas.log'),
    maxBytes=5 * 1024 * 1024,
    backupCount=3,
    encoding='utf-8'
)
file_handler.setFormatter(logging.Formatter(
    '%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
))
logger.addHandler(file_handler)

console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(logging.Formatter(
    '%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
))
logger.addHandler(console_handler)


# =========================================================
# CONFIGURACAO
# =========================================================

DB_CONFIG = {
    'host':     os.getenv('DB_HOST', 'localhost'),
    'database': os.getenv('DB_NAME', 'postgres'),
    'user':     os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', ''),
    'port':     os.getenv('DB_PORT', '5432')
}

SMTP_USER   = os.getenv('SMTP_USER', '')
SMTP_PASS   = os.getenv('SMTP_PASS', '')
IMAP_HOST   = os.getenv('IMAP_HOST', 'imap.gmail.com')
IMAP_PORT   = int(os.getenv('IMAP_PORT', 993))

INTERVALO_HORAS = float(os.getenv('IMAP_REPLY_INTERVALO_H', '1'))
INTERVALO_SEG   = int(INTERVALO_HORAS * 3600)

# Regex que extrai o tratativa_id do assunto
_TOKEN_RE = re.compile(r'\[TRAT:(\d+)\]', re.IGNORECASE)


# =========================================================
# BANCO
# =========================================================

def _get_conn():
    return psycopg2.connect(**DB_CONFIG)


# =========================================================
# IMAP — HELPERS
# =========================================================

def _decodificar_header(valor: str) -> str:
    """Decodifica header MIME encoded-words."""
    if not valor:
        return ''
    partes = email.header.decode_header(valor)
    resultado = []
    for parte, charset in partes:
        if isinstance(parte, bytes):
            resultado.append(parte.decode(charset or 'utf-8', errors='replace'))
        else:
            resultado.append(parte)
    return ''.join(resultado)


def _extrair_texto_reply(msg) -> str:
    """
    Extrai apenas o texto novo da resposta.
    Ignora quoted text (linhas com ">") e cabecalhos de reply.
    Trunca em 2000 chars para nao sobrecarregar o banco.
    """
    corpo = ''

    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == 'text/plain':
                try:
                    corpo = part.get_payload(decode=True).decode(
                        part.get_content_charset() or 'utf-8', errors='replace'
                    )
                    break
                except Exception:
                    pass
    else:
        try:
            corpo = msg.get_payload(decode=True).decode(
                msg.get_content_charset() or 'utf-8', errors='replace'
            )
        except Exception:
            corpo = str(msg.get_payload())

    linhas = []
    for linha in corpo.splitlines():
        # Quoted text: linha começa com ">"
        if linha.startswith('>'):
            break
        # Cabecalho de reply: "On <data>... wrote:" / "Em <data>... escreveu:"
        if re.match(r'^(On |Em |De:|From:).{0,120}(wrote:|escreveu:)', linha, re.IGNORECASE):
            break
        linhas.append(linha)

    return '\n'.join(linhas).strip()[:2000]


def conectar_imap() -> imaplib.IMAP4_SSL:
    imap = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    imap.login(SMTP_USER, SMTP_PASS)
    return imap


# =========================================================
# PROCESSAMENTO DE UMA RESPOSTA
# =========================================================

def _processar_resposta(conn, tratativa_id: int, remetente: str, corpo: str) -> bool:
    """
    Atualiza a tratativa no banco com os dados da resposta por email.

    Campos atualizados em sentir_agir_tratativas:
      - status                → 'regularizado'
      - observacoes_resolucao ← corpo da resposta + metadados do email
      - resolvido_por         ← email/nome do remetente
      - data_resolucao        ← NOW()
      - data_inicio_tratativa ← NOW() se ainda nao tiver sido preenchido

    Tambem atualiza status_tratativa na sentir_agir_visitas.
    Registra acao em sentir_agir_log para auditoria.
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute(
        "SELECT id, status, visita_id FROM sentir_agir_tratativas WHERE id = %s",
        (tratativa_id,)
    )
    tratativa = cursor.fetchone()

    if not tratativa:
        logger.warning('[IMAP] Tratativa #%d nao encontrada no banco', tratativa_id)
        cursor.close()
        return False

    if tratativa['status'] in ('regularizado', 'cancelado'):
        logger.info(
            '[IMAP] Tratativa #%d ja esta com status "%s" — resposta ignorada',
            tratativa_id, tratativa['status']
        )
        cursor.close()
        return False

    # Monta texto da resolucao
    texto_resposta = corpo or '(Resposta sem texto extraivel)'
    obs_completa = 'Regularizado via resposta por email.\n\n{}'.format(texto_resposta)

    cursor.execute("""
        UPDATE sentir_agir_tratativas
        SET
            status                = 'regularizado',
            observacoes_resolucao = %s,
            resolvido_por         = %s,
            data_resolucao        = NOW(),
            data_inicio_tratativa = COALESCE(data_inicio_tratativa, NOW()),
            atualizado_em         = NOW()
        WHERE id = %s
    """, (obs_completa[:3000], remetente[:200], tratativa_id))

    # Log de auditoria
    cursor.execute("""
        INSERT INTO sentir_agir_log
            (entidade, entidade_id, acao, campo_alterado,
             valor_anterior, valor_novo, usuario, ip_origem)
        VALUES ('tratativa', %s, 'resposta_email', 'status',
                %s, 'regularizado', %s, 'imap_worker')
    """, (tratativa_id, tratativa['status'], remetente[:200]))

    # Recalcula status_tratativa da visita pai
    visita_id = tratativa['visita_id']
    cursor.execute("""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'pendente'      THEN 1 ELSE 0 END) AS pendentes,
            SUM(CASE WHEN status = 'em_tratativa'  THEN 1 ELSE 0 END) AS em_tratativa
        FROM sentir_agir_tratativas
        WHERE visita_id = %s
    """, (visita_id,))
    stats = cursor.fetchone()

    total        = stats['total']        or 0
    pendentes    = stats['pendentes']    or 0
    em_tratativa = stats['em_tratativa'] or 0

    if total == 0:
        novo_status_visita = 'sem_pendencia'
    elif pendentes > 0:
        novo_status_visita = 'pendente'
    elif em_tratativa > 0:
        novo_status_visita = 'em_tratativa'
    else:
        novo_status_visita = 'regularizado'

    cursor.execute("""
        UPDATE sentir_agir_visitas
        SET status_tratativa = %s, atualizado_em = NOW()
        WHERE id = %s
    """, (novo_status_visita, visita_id))

    conn.commit()
    cursor.close()

    logger.info(
        '[IMAP] Tratativa #%d regularizada por email | Remetente: %s | Status visita: %s',
        tratativa_id, remetente, novo_status_visita
    )
    return True


# =========================================================
# CICLO PRINCIPAL
# =========================================================

def verificar_respostas_email():
    """
    Conecta ao IMAP, varre INBOX por emails nao lidos com token [TRAT:XXXXX]
    e processa as respostas encontradas.
    """
    logger.info('[IMAP] Iniciando verificacao de respostas...')

    try:
        imap = conectar_imap()
    except Exception as e:
        logger.error('[IMAP] Falha ao conectar IMAP (%s:%s): %s', IMAP_HOST, IMAP_PORT, e)
        return

    processados = 0
    ignorados   = 0
    erros       = 0

    try:
        imap.select('INBOX')
        _, nums = imap.search(None, 'UNSEEN')

        if not nums[0]:
            logger.info('[IMAP] Nenhum email nao lido encontrado.')
            return

        ids = nums[0].split()
        logger.info('[IMAP] %d email(s) nao lido(s) na caixa de entrada', len(ids))

        conn = _get_conn()

        for num in ids:
            try:
                # BODY.PEEK[] — nao marca como lido automaticamente
                _, data = imap.fetch(num, '(BODY.PEEK[])')
                raw  = data[0][1]
                msg  = email.message_from_bytes(raw)

                assunto   = _decodificar_header(msg.get('Subject', ''))
                remetente = _decodificar_header(msg.get('From', ''))

                # Ignora emails enviados pela propria conta (original da notificacao)
                if SMTP_USER.lower() in remetente.lower():
                    imap.store(num, '+FLAGS', '\\Seen')
                    ignorados += 1
                    continue

                # Busca token de tratativa no assunto
                match = _TOKEN_RE.search(assunto)
                if not match:
                    # Email sem token — nao e uma resposta de tratativa
                    ignorados += 1
                    continue

                tratativa_id = int(match.group(1))
                corpo = _extrair_texto_reply(msg)

                logger.info(
                    '[IMAP] Resposta recebida: Tratativa #%d | De: %s',
                    tratativa_id, remetente
                )

                ok = _processar_resposta(conn, tratativa_id, remetente, corpo)

                # Marca como lido independente do resultado (evita reprocessamento)
                imap.store(num, '+FLAGS', '\\Seen')

                if ok:
                    processados += 1
                else:
                    ignorados += 1

            except Exception as e:
                logger.error('[IMAP] Erro ao processar email %s: %s', num, e, exc_info=True)
                erros += 1

        conn.close()

    finally:
        try:
            imap.logout()
        except Exception:
            pass

    logger.info(
        '[IMAP] Verificacao concluida: %d regularizada(s) | %d ignorada(s) | %d erro(s)',
        processados, ignorados, erros
    )


# =========================================================
# MAIN (modo standalone)
# =========================================================

def main():
    logger.info('=' * 60)
    logger.info('  WORKER IMAP - RESPOSTAS DE TRATATIVAS')
    logger.info('  IMAP: %s:%s | Conta: %s', IMAP_HOST, IMAP_PORT, SMTP_USER)
    logger.info('  Intervalo: %.1fh (%ds)', INTERVALO_HORAS, INTERVALO_SEG)
    logger.info('=' * 60)

    if not SMTP_USER or not SMTP_PASS:
        logger.error('SMTP_USER/SMTP_PASS nao configurados no .env')
        sys.exit(1)

    # Testa conexao com banco
    try:
        conn = _get_conn()
        conn.close()
        logger.info('Conexao com banco OK')
    except Exception as e:
        logger.error('Falha ao conectar no banco: %s', e)
        sys.exit(1)

    # Testa conexao IMAP
    try:
        imap = conectar_imap()
        imap.logout()
        logger.info('Conexao IMAP OK')
    except Exception as e:
        logger.error('Falha ao conectar IMAP: %s', e)
        sys.exit(1)

    # Loop principal
    while True:
        try:
            verificar_respostas_email()
        except Exception as e:
            logger.error('[IMAP] Erro inesperado no ciclo: %s', e, exc_info=True)

        logger.info('[IMAP] Proxima verificacao em %.1fh...', INTERVALO_HORAS)
        time.sleep(INTERVALO_SEG)


# =========================================================
# INTEGRACAO COM FLASK (thread daemon)
# =========================================================

_background_started = False


def start_in_background():
    """
    Inicia o worker como thread daemon junto com o Flask.
    Chamado em app.py no startup.

    OFF SWITCH: WORKER_IMAP_TRATATIVAS_AUTO=false no .env
    """
    global _background_started
    if _background_started:
        return

    if os.getenv('WORKER_IMAP_TRATATIVAS_AUTO', 'true').lower() != 'true':
        logger.info('[worker_imap_tratativas] Auto-start desativado (WORKER_IMAP_TRATATIVAS_AUTO=false)')
        return

    # Guard: no modo debug o Werkzeug reloader cria dois processos (monitor + filho).
    # Só o processo filho (WERKZEUG_RUN_MAIN='true') deve iniciar threads.
    # Em produção/gunicorn não há reloader → FLASK_ENV != 'development' → passa normalmente.
    flask_debug = (os.environ.get('FLASK_ENV') == 'development' or
                   os.environ.get('FLASK_DEBUG', '0') in ('1', 'true', 'True'))
    if flask_debug and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        return

    _background_started = True

    def _run():
        try:
            logger.info(
                '[worker_imap_tratativas] Thread daemon iniciada | Intervalo: %.1fh',
                INTERVALO_HORAS
            )
            # Aguarda 30s no startup para nao sobrecarregar a inicializacao do Flask
            time.sleep(30)
            while True:
                try:
                    verificar_respostas_email()
                except Exception as e:
                    logger.error('[worker_imap_tratativas] Erro no ciclo: %s', e, exc_info=True)
                time.sleep(INTERVALO_SEG)
        except Exception as e:
            logger.error('[worker_imap_tratativas] Erro fatal: %s', e, exc_info=True)

    t = threading.Thread(target=_run, name='worker_imap_tratativas', daemon=True)
    t.start()
    logger.info('[worker_imap_tratativas] Thread daemon registrada (intervalo %.1fh)', INTERVALO_HORAS)


if __name__ == '__main__':
    main()
