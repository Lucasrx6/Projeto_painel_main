# -*- coding: utf-8 -*-
"""
==============================================================
  NOTIFICADOR DE PARECERES - Email + ntfy
  Hospital Anchieta Ceilandia
==============================================================

  Servico independente que monitora a tabela pareceres_pendentes
  e envia notificacoes por email e push quando detecta novos.

  Funcionalidades:
  - Detecta novos pareceres comparando com snapshot anterior
  - Primeira execucao popula snapshot SEM notificar
  - So notifica pareceres dos ultimos 30 minutos
  - Envia email HTML via Apprise (SMTP configurado no .env)
  - Motivo da consulta limpo via funcao PostgreSQL limpar_rtf()
  - Envia ntfy para multiplos topicos (lidos do banco)
  - Destinatarios email configuraveis por especialidade
  - Tudo centralizado no Painel 26

  CREDENCIAIS:
  - SMTP via .env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
  - Topicos ntfy via tabela notificacoes_destinatarios
  - ZERO credenciais hardcoded no codigo

  Execucao:
  - Standalone: python notificador_pareceres.py
  - Servico Windows via NSSM
==============================================================
"""

import psycopg2
from psycopg2.extras import RealDictCursor
import apprise
import requests
import schedule
import time
import logging
import logging.handlers
import os
import sys
import json
from datetime import datetime
from dotenv import load_dotenv
from urllib.parse import quote as url_encode

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))


# =========================================================
# CONFIGURACAO DE LOGGING
# =========================================================

LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

logger = logging.getLogger('notificador_pareceres')
logger.setLevel(logging.INFO)

file_handler = logging.handlers.RotatingFileHandler(
    os.path.join(LOG_DIR, 'notificador_pareceres.log'),
    maxBytes=5 * 1024 * 1024,
    backupCount=5,
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
# CONFIGURACOES (sem credenciais hardcoded)
# =========================================================

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'database': os.getenv('DB_NAME', 'postgres'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', ''),
    'port': os.getenv('DB_PORT', '5432')
}

# SMTP - lidos exclusivamente do .env
SMTP_HOST = os.getenv('SMTP_HOST', '')
SMTP_PORT = os.getenv('SMTP_PORT', '587')
SMTP_USER = os.getenv('SMTP_USER', '')
SMTP_PASS = os.getenv('SMTP_PASS', '')
SMTP_FROM = os.getenv('SMTP_FROM', '')

# ntfy - URL base (topicos vem do banco)
NTFY_URL = os.getenv('NTFY_URL', 'https://ntfy.sh')

# Intervalo de verificacao
INTERVALO_VERIFICACAO = int(os.getenv('NOTIF_PARECER_INTERVALO_MIN', '15'))


# =========================================================
# CONEXAO COM BANCO
# =========================================================

def get_connection():
    """Abre conexao com PostgreSQL usando o pool central."""
    try:
        from backend.database import get_db_connection
        conn = get_db_connection()
        return conn
    except Exception as e:
        logger.error('Erro ao conectar no banco: %s', e)
        return None


# =========================================================
# BUSCAR DESTINATARIOS EMAIL (do banco)
# =========================================================

def buscar_destinatarios_email(conn, especialidade=None):
    """
    Busca destinatarios EMAIL da tabela notificacoes_destinatarios.
    Filtra por especialidade quando informada.
    Destinatarios com especialidade NULL recebem de todas.
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute("""
        SELECT DISTINCT ON (email) nome, email
        FROM notificacoes_destinatarios
        WHERE tipo_evento = 'parecer_pendente'
          AND canal = 'email'
          AND ativo = true
          AND (
              especialidade IS NULL
              OR especialidade = %s
          )
        ORDER BY email
    """, (especialidade,))

    destinatarios = cursor.fetchall()
    cursor.close()

    return [dict(d) for d in destinatarios]


# =========================================================
# BUSCAR TOPICOS NTFY (do banco)
# =========================================================

def buscar_topicos_ntfy(conn):
    """
    Busca topicos ntfy da tabela notificacoes_destinatarios.
    Retorna lista de topicos ativos para parecer_pendente.
    Configuravel via Painel 26.
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute("""
        SELECT email AS topico
        FROM notificacoes_destinatarios
        WHERE tipo_evento = 'parecer_pendente'
          AND canal = 'ntfy'
          AND ativo = true
    """)

    topicos = [row['topico'] for row in cursor.fetchall() if row['topico']]
    cursor.close()

    return topicos


# =========================================================
# MONTAR EMAIL HTML
# =========================================================

def montar_email_html(parecer):
    """
    Monta corpo do email em HTML com dados do parecer.
    Motivo da consulta ja vem limpo do PostgreSQL (funcao limpar_rtf).
    """
    motivo = parecer.get('ds_motivo_consulta', '') or 'Nao informado'
    motivo_html = motivo.replace('\n', '<br>')

    html = """
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #dc3545; color: white; padding: 15px 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0; font-size: 18px;">Parecer Medico Pendente</h2>
            <p style="margin: 5px 0 0; font-size: 13px; opacity: 0.9;">Hospital Anchieta Ceilandia - Sistema de Notificacoes</p>
        </div>

        <div style="border: 1px solid #dee2e6; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">

            <table style="width: 100%%; border-collapse: collapse; font-size: 14px;">
                <tr>
                    <td style="padding: 8px 0; color: #6c757d; width: 140px;">Especialidade:</td>
                    <td style="padding: 8px 0; font-weight: bold;">%s</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #6c757d;">Paciente:</td>
                    <td style="padding: 8px 0;">%s</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #6c757d;">Setor:</td>
                    <td style="padding: 8px 0;">%s</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #6c757d;">Leito:</td>
                    <td style="padding: 8px 0;">%s</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #6c757d;">Atendimento:</td>
                    <td style="padding: 8px 0;">%s</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #6c757d;">Convenio:</td>
                    <td style="padding: 8px 0;">%s</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #6c757d;">Solicitante:</td>
                    <td style="padding: 8px 0;">%s</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #6c757d;">Solicitado em:</td>
                    <td style="padding: 8px 0;">%s</td>
                </tr>
            </table>

            <div style="margin-top: 15px; padding: 12px; background: #f8f9fa; border-radius: 6px; border-left: 4px solid #dc3545;">
                <p style="margin: 0; font-size: 12px; color: #6c757d; font-weight: bold;">Motivo da consulta:</p>
                <p style="margin: 5px 0 0; font-size: 14px; color: #333;">%s</p>
            </div>

            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 11px; color: #999; margin: 0; text-align: center;">
                Notificacao automatica - Sistema de Paineis HAC<br>
                Enviado em %s
            </p>
        </div>
    </div>
    """ % (
        parecer.get('especialidade_destino', '-'),
        parecer.get('nm_paciente', '-'),
        parecer.get('nm_setor', '-'),
        parecer.get('cd_leito', '-'),
        parecer.get('nr_atendimento', '-'),
        parecer.get('ds_convenio', '-'),
        parecer.get('nm_medico_solicitante', '-'),
        parecer.get('dt_solicitacao', '-'),
        motivo_html,
        datetime.now().strftime('%d/%m/%Y %H:%M')
    )

    return html


# =========================================================
# ENVIAR EMAIL VIA APPRISE
# =========================================================

def enviar_email(destinatarios, titulo, corpo_html):
    """
    Envia email para lista de destinatarios via Apprise.
    Credenciais SMTP lidas do .env.
    """
    if not destinatarios:
        logger.warning('Nenhum destinatario email para enviar')
        return False, 'Sem destinatarios'

    if not SMTP_USER or not SMTP_PASS:
        logger.error('SMTP nao configurado no .env')
        return False, 'SMTP nao configurado'

    try:
        ap = apprise.Apprise()

        user_encoded = url_encode(SMTP_USER, safe='')
        pass_encoded = url_encode(SMTP_PASS, safe='')
        from_addr = SMTP_FROM if SMTP_FROM else SMTP_USER

        for dest in destinatarios:
            email_dest = dest['email']
            url = 'mailtos://{user}:{pwd}@{host}:{port}?from={sender}&to={to}&name=Notificacao+Tasy'.format(
                user=user_encoded,
                pwd=pass_encoded,
                host=SMTP_HOST,
                port=SMTP_PORT,
                sender=url_encode(from_addr, safe=''),
                to=url_encode(email_dest, safe='')
            )
            ap.add(url)

        resultado = ap.notify(
            title=titulo,
            body=corpo_html,
            body_format=apprise.NotifyFormat.HTML,
            notify_type=apprise.NotifyType.WARNING
        )

        emails_lista = ', '.join([d['email'] for d in destinatarios])

        if resultado:
            logger.info('Email OK para: %s', emails_lista)
            return True, 'Email enviado para {}'.format(len(destinatarios))
        else:
            logger.warning('Falha email para: %s', emails_lista)
            return False, 'Falha no envio para {}'.format(emails_lista)

    except Exception as e:
        logger.error('Erro email: %s', e)
        return False, str(e)


# =========================================================
# ENVIAR NTFY PARA MULTIPLOS TOPICOS (do banco)
# =========================================================

def enviar_ntfy_topicos(topicos, titulo, mensagem):
    """
    Envia push para todos os topicos ntfy configurados no banco.
    Cada topico recebe a mesma mensagem.
    """
    if not topicos:
        logger.debug('Nenhum topico ntfy configurado para parecer_pendente')
        return

    enviados = 0
    erros = 0

    for topico in topicos:
        try:
            url = '{}/{}'.format(NTFY_URL, topico)
            resp = requests.post(
                url,
                data=mensagem.encode('utf-8'),
                headers={
                    'Title': titulo.encode('utf-8'),
                    'Priority': '3',
                },
                timeout=10
            )

            if resp.status_code == 200:
                logger.info('ntfy OK: [%s] %s', topico, titulo)
                enviados += 1
            else:
                logger.warning('ntfy [%s] status %s', topico, resp.status_code)
                erros += 1

        except requests.exceptions.Timeout:
            logger.error('Timeout ntfy: %s', topico)
            erros += 1
        except requests.exceptions.ConnectionError:
            logger.error('Conexao recusada ntfy: %s', topico)
            erros += 1
        except Exception as e:
            logger.error('Erro ntfy [%s]: %s', topico, e)
            erros += 1

    if enviados > 0 or erros > 0:
        logger.info('ntfy resumo: %s enviados, %s erros de %s topicos', enviados, erros, len(topicos))


# =========================================================
# REGISTRAR NO LOG
# =========================================================

def registrar_log(conn, nr_parecer, nr_atendimento, especialidade, destinatarios, topicos, sucesso, resposta):
    """Registra notificacao no log com detalhes de destinatarios e topicos."""
    cursor = conn.cursor()
    agora = datetime.now()

    chave = 'parecer_email_{}_{}'.format(nr_parecer, agora.strftime('%Y%m%d'))

    # Verifica se ja foi notificado hoje
    cursor.execute("""
        SELECT id FROM notificacoes_log
        WHERE chave_evento = %s AND status = 'notificado'
        LIMIT 1
    """, (chave,))

    if cursor.fetchone():
        cursor.close()
        return

    emails = ', '.join([d['email'] for d in destinatarios]) if destinatarios else 'nenhum'
    topicos_str = ', '.join(topicos) if topicos else 'nenhum'

    dados_extra = json.dumps({
        'destinatarios_email': emails,
        'topicos_ntfy': topicos_str,
        'especialidade': especialidade or 'geral'
    })

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
        'parecer_email', chave, nr_atendimento, especialidade,
        dados_extra,
        topicos_str,
        'notificado' if sucesso else 'erro',
        agora,
        agora if sucesso else None,
        agora if sucesso else None,
        1 if sucesso else 0,
        resposta
    ))

    conn.commit()
    cursor.close()


# =========================================================
# CICLO PRINCIPAL: VERIFICAR PARECERES NOVOS
# =========================================================

def verificar_pareceres():
    """
    Detecta novos pareceres comparando com snapshot anterior.

    PRIMEIRA EXECUCAO (snapshot vazio):
      Popula snapshot SEM notificar.

    EXECUCOES SEGUINTES:
      Detecta delta com horas_pendente <= 0.5 (30min).
      Envia email para destinatarios por especialidade.
      Envia ntfy para todos os topicos configurados.
    """
    logger.info('=' * 50)
    logger.info('Verificando pareceres pendentes...')

    conn = get_connection()
    if not conn:
        return

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Busca topicos ntfy do banco (uma vez por ciclo)
        topicos_ntfy = buscar_topicos_ntfy(conn)

        # Busca pareceres atuais (motivo limpo via funcao PostgreSQL)
        cursor.execute("""
            SELECT nr_parecer, nr_atendimento, nm_paciente,
                   nm_medico_solicitante, especialidade_destino,
                   limpar_rtf(ds_motivo_consulta) AS ds_motivo_consulta,
                   dt_solicitacao, horas_pendente,
                   ds_convenio, nm_setor, cd_leito,
                   ds_tipo_atendimento, status_parecer
            FROM pareceres_pendentes
            WHERE status_parecer = 'A' OR status_parecer IS NULL
        """)

        pareceres_atuais = cursor.fetchall()
        pareceres_map = {p['nr_parecer']: dict(p) for p in pareceres_atuais}
        pareceres_atuais_set = set(pareceres_map.keys())

        # Busca snapshot anterior
        cursor.execute("""
            SELECT nr_atendimento
            FROM notificacoes_snapshot
            WHERE tipo_snapshot = 'pareceres_ativos'
        """)

        pareceres_anteriores = {row['nr_atendimento'] for row in cursor.fetchall()}

        # PRIMEIRA EXECUCAO: snapshot vazio -> popula sem notificar
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

        # EXECUCOES SEGUINTES: detecta novos (delta)
        novos = pareceres_atuais_set - pareceres_anteriores
        notificados = 0
        ignorados = 0

        for nr_parecer in novos:
            parecer = pareceres_map[nr_parecer]

            # So notifica pareceres dos ultimos 30min
            horas = parecer.get('horas_pendente') or 0
            if horas > 0.5:
                ignorados += 1
                logger.debug('[pareceres] %s ignorado (%.1fh)', nr_parecer, horas)
                continue

            especialidade = parecer.get('especialidade_destino')

            # Busca destinatarios EMAIL para essa especialidade
            destinatarios = buscar_destinatarios_email(conn, especialidade)

            # Monta titulo
            titulo = 'Parecer Pendente - {} - {}'.format(
                especialidade or 'Sem especialidade',
                parecer.get('nm_setor', '-')
            )

            # Envia email (se houver destinatarios)
            sucesso_email = False
            resposta_email = 'Sem destinatarios email'

            if destinatarios:
                corpo_html = montar_email_html(parecer)
                sucesso_email, resposta_email = enviar_email(destinatarios, titulo, corpo_html)
            else:
                logger.info('[pareceres] Sem destinatarios email para: %s', especialidade)

            # Envia ntfy para TODOS os topicos (sem dados de paciente)
            mensagem_ntfy = 'Novo parecer: {} | Setor: {} | Leito: {} | Atend: {}'.format(
                especialidade or '-',
                parecer.get('nm_setor', '-'),
                parecer.get('cd_leito', '-'),
                parecer.get('nr_atendimento', '-')
            )
            enviar_ntfy_topicos(topicos_ntfy, titulo, mensagem_ntfy)

            # Registra no log
            sucesso = sucesso_email or len(topicos_ntfy) > 0
            resposta = resposta_email

            registrar_log(
                conn, nr_parecer,
                parecer.get('nr_atendimento'),
                especialidade,
                destinatarios,
                topicos_ntfy,
                sucesso, resposta
            )

            notificados += 1

        # Atualiza snapshot com estado atual
        cursor.execute("DELETE FROM notificacoes_snapshot WHERE tipo_snapshot = 'pareceres_ativos'")

        for nr_parecer in pareceres_atuais_set:
            cursor.execute("""
                INSERT INTO notificacoes_snapshot (tipo_snapshot, nr_atendimento)
                VALUES ('pareceres_ativos', %s)
            """, (nr_parecer,))

        conn.commit()
        cursor.close()

        # Log de resultado
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


# =========================================================
# MAIN
# =========================================================

def main():
    """Ponto de entrada do notificador de pareceres."""
    logger.info('=' * 60)
    logger.info('  NOTIFICADOR DE PARECERES - Email + ntfy')
    logger.info('  Intervalo: %s minutos', INTERVALO_VERIFICACAO)
    logger.info('  SMTP: %s via %s:%s', SMTP_FROM or '(usar SMTP_USER)', SMTP_HOST or '(nao configurado)', SMTP_PORT)
    logger.info('  ntfy base: %s', NTFY_URL)
    logger.info('  Topicos ntfy: lidos da tabela notificacoes_destinatarios')
    logger.info('  Banco: %s@%s:%s/%s',
                 DB_CONFIG['user'], DB_CONFIG['host'],
                 DB_CONFIG['port'], DB_CONFIG['database'])
    logger.info('=' * 60)

    # Valida SMTP
    if not SMTP_USER or not SMTP_PASS:
        logger.error('SMTP_USER e/ou SMTP_PASS nao configurados no .env')
        logger.error('Adicione ao .env: SMTP_USER=seu@email.com e SMTP_PASS=suasenha')
        sys.exit(1)

    if not SMTP_HOST:
        logger.error('SMTP_HOST nao configurado no .env')
        sys.exit(1)

    # SMTP_FROM usa SMTP_USER se vazio
    if not SMTP_FROM:
        logger.info('SMTP_FROM nao definido, usando SMTP_USER: %s', SMTP_USER)

    # Testa conexao com banco
    conn = get_connection()
    if not conn:
        logger.error('Falha na conexao inicial. Encerrando.')
        sys.exit(1)

    # Valida se existem destinatarios configurados
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

    logger.info('Destinatarios ativos: %s email, %s ntfy',
                 dest_count['qt_email'], dest_count['qt_ntfy'])

    if dest_count['qt_email'] == 0 and dest_count['qt_ntfy'] == 0:
        logger.warning('ATENCAO: Nenhum destinatario configurado no Painel 26!')
        logger.warning('Cadastre destinatarios em: Central de Notificacoes > Novo')

    logger.info('Conexao com banco OK')

    # Primeiro ciclo imediato
    verificar_pareceres()

    # Agenda ciclos
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


# =========================================================
# INICIALIZACAO INTEGRADA (modo thread daemon no Flask)
# =========================================================

_background_started = False


def start_in_background():
    """
    Inicia o notificador como thread daemon junto com o Flask.

    OFF SWITCHES (em ordem de praticidade):
      1. .env  -> NOTIF_PARECERES_AUTO=false  (desativa sem tocar no codigo)
      2. app.py -> comentar o bloco de 3 linhas (reverte comportamento anterior)
      3. Qualquer excecao de startup e capturada (nunca derruba o servidor Flask)

    Compativel com:
      - python app.py (processo unico, desenvolvimento)
      - Werkzeug debug reloader (evita duplicar thread no processo pai)
    """
    global _background_started
    if _background_started:
        return

    # OFF SWITCH 1: variavel de ambiente
    if os.getenv('NOTIF_PARECERES_AUTO', 'true').lower() != 'true':
        logger.info('[notificador_pareceres] Auto-start desativado (NOTIF_PARECERES_AUTO=false)')
        return

    # Guard Werkzeug: inicia apenas no processo filho (WERKZEUG_RUN_MAIN='true').
    # O processo monitor/watcher NÃO define WERKZEUG_RUN_MAIN, mas is_running_from_reloader()
    # retorna True em AMBOS os processos — o AND garante que só o filho passa.
    # Em modo standalone (sem reloader), is_running_from_reloader() = False → thread inicia normalmente.
    try:
        from werkzeug.serving import is_running_from_reloader
        if is_running_from_reloader() and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
            return
    except ImportError:
        pass

    _background_started = True

    import threading

    def _run():
        try:
            import schedule as _sched
            _scheduler = _sched.Scheduler()  # instancia isolada, nao interfere no scheduler global

            logger.info('[notificador_pareceres] Thread daemon iniciada (PID %s, intervalo %smin)',
                        os.getpid(), INTERVALO_VERIFICACAO)

            verificar_pareceres()
            _scheduler.every(INTERVALO_VERIFICACAO).minutes.do(verificar_pareceres)

            while True:
                _scheduler.run_pending()
                time.sleep(30)

        except Exception as e:
            logger.error('[notificador_pareceres] Erro fatal na thread daemon: %s', e, exc_info=True)

    t = threading.Thread(target=_run, name='notificador_pareceres', daemon=True)
    t.start()
    logger.info('[notificador_pareceres] Thread daemon registrada')


if __name__ == '__main__':
    main()