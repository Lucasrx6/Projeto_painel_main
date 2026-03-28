# -*- coding: utf-8 -*-
"""
==============================================================
  NOTIFICADOR DE PARECERES - Email via Apprise
  Hospital Anchieta Ceilandia
==============================================================

  Servico independente que monitora a tabela pareceres_pendentes
  e envia notificacoes por email quando detecta novos pareceres.

  Funcionalidades:
  - Detecta novos pareceres comparando com snapshot anterior
  - Primeira execucao popula snapshot SEM notificar
  - So notifica pareceres dos ultimos 30 minutos
  - Envia email HTML formatado via Apprise (SMTP)
  - Parser RTF integrado para motivo da consulta
  - Destinatarios configuraveis por especialidade ou geral
  - Tambem envia ntfy para manter alerta push

  Configuracao SMTP via .env:
  - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM

  Destinatarios via tabela: notificacoes_destinatarios

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
import re
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
# CONFIGURACOES
# =========================================================

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'database': os.getenv('DB_NAME', 'postgres'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', 'postgres'),
    'port': os.getenv('DB_PORT', '5432')
}

# SMTP para envio de email
SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = os.getenv('SMTP_PORT', '587')
SMTP_USER = os.getenv('SMTP_USER', 'hac.notificacaotasy@saofranciscodf.med.br')
SMTP_PASS = os.getenv('SMTP_PASS', 'dkyyifukkoqecohb')
SMTP_FROM = os.getenv('SMTP_FROM', 'hac.notificacaotasy@saofranciscodf.med.br')

# ntfy para notificacao push
NTFY_URL = os.getenv('NTFY_URL', 'https://ntfy.sh')
NTFY_TOPIC = os.getenv('NTFY_TOPIC_PARECER', 'hac-parecer')

# Intervalo de verificacao
INTERVALO_VERIFICACAO = int(os.getenv('NOTIF_PARECER_INTERVALO_MIN', '15'))


# =========================================================
# CONEXAO COM BANCO
# =========================================================

def get_connection():
    """Abre conexao com PostgreSQL."""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        return conn
    except Exception as e:
        logger.error('Erro ao conectar no banco: %s', e)
        return None


# =========================================================
# PARSER RTF -> TEXTO LIMPO
# =========================================================

def limpar_rtf(texto_raw):
    """
    Converte texto RTF do Tasy para texto limpo.
    O Tasy salva DS_MOTIVO_CONSULTA em formato RTF.
    Remove fonttbl, colortbl, stylesheet, comandos e metadados.

    Args:
        texto_raw: string RTF ou texto simples

    Returns:
        string com texto limpo
    """
    if not texto_raw or not texto_raw.strip():
        return ''

    texto = texto_raw.strip()

    # Se nao for RTF, retorna direto
    if not texto.startswith('{\\rtf'):
        return texto

    # Remove grupos RTF aninhados entre chaves (fonttbl, colortbl, etc)
    # Repete ate nao ter mais grupos aninhados
    for _ in range(15):
        novo = re.sub(r'\{[^{}]*\}', ' ', texto)
        if novo == texto:
            break
        texto = novo

    # Converte caracteres acentuados \'xx (encoding cp1252 do Windows)
    texto = re.sub(
        r"\\\'([0-9a-fA-F]{2})",
        lambda m: bytes([int(m.group(1), 16)]).decode('cp1252', errors='replace'),
        texto
    )

    # Remove comandos RTF (\palavra ou \palavraN ou \palavra-N)
    texto = re.sub(r'\\[a-zA-Z]+[-]?\d*\s?', ' ', texto)

    # Remove barras soltas, asteriscos e chaves restantes
    texto = re.sub(r'[\\*{}]', '', texto)

    # Remove quebras de linha RTF residuais
    texto = texto.replace('\r', '\n').replace('\n\n', '\n')

    # Limpa espacos multiplos
    texto = re.sub(r'[ \t]+', ' ', texto)

    # Limpa linhas vazias multiplas
    texto = re.sub(r'\n\s*\n', '\n\n', texto)

    return texto.strip()


# =========================================================
# BUSCAR DESTINATARIOS
# =========================================================

def buscar_destinatarios(conn, especialidade=None):
    """
    Busca destinatarios da tabela notificacoes_destinatarios.

    Retorna emails de:
    1. Destinatarios com especialidade correspondente
    2. Destinatarios gerais (especialidade IS NULL) - recebem de todas

    Args:
        conn: conexao PostgreSQL
        especialidade: especialidade do parecer (ou None)

    Returns:
        list de dicts {nome, email}
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute("""
        SELECT DISTINCT nome, email
        FROM notificacoes_destinatarios
        WHERE tipo_evento = 'parecer_pendente'
          AND ativo = true
          AND (
              especialidade IS NULL
              OR especialidade = %s
          )
    """, (especialidade,))

    destinatarios = cursor.fetchall()
    cursor.close()

    return [dict(d) for d in destinatarios]


# =========================================================
# MONTAR EMAIL HTML
# =========================================================

def montar_email_html(parecer):
    """
    Monta corpo do email em HTML com dados do parecer.
    Formatacao profissional e limpa.
    Inclui motivo da consulta parseado do RTF.
    """
    # Limpa motivo RTF
    motivo_limpo = parecer.get('ds_motivo_consulta', '') or 'Nao informado'
    motivo_html = motivo_limpo.replace('\n', '<br>')

    if not motivo_limpo:
        motivo_limpo = 'Nao informado'

    # Converte quebras de linha para <br> no HTML
    motivo_html = motivo_limpo.replace('\n', '<br>')

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

    Args:
        destinatarios: list de dicts {nome, email}
        titulo: assunto do email
        corpo_html: corpo HTML do email

    Returns:
        (sucesso: bool, resposta: str)
    """
    if not destinatarios:
        logger.warning('Nenhum destinatario para enviar email')
        return False, 'Sem destinatarios'

    try:
        ap = apprise.Apprise()

        user_encoded = url_encode(SMTP_USER, safe='')
        pass_encoded = url_encode(SMTP_PASS, safe='')

        for dest in destinatarios:
            email_dest = dest['email']
            url = 'mailtos://{user}:{pwd}@{host}:{port}?from={sender}&to={to}&name=ParecerPendente'.format(
                user=user_encoded,
                pwd=pass_encoded,
                host=SMTP_HOST,
                port=SMTP_PORT,
                sender=url_encode(SMTP_FROM, safe=''),
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
            logger.info('Email enviado OK para: %s', emails_lista)
            return True, 'Email enviado para {} destinatarios'.format(len(destinatarios))
        else:
            logger.warning('Falha ao enviar email para: %s', emails_lista)
            return False, 'Falha no envio'

    except Exception as e:
        logger.error('Erro ao enviar email: %s', e)
        return False, str(e)


# =========================================================
# ENVIAR NTFY (push notification)
# =========================================================

def enviar_ntfy(titulo, mensagem):
    """Envia notificacao push via ntfy."""
    try:
        url = '{}/{}'.format(NTFY_URL, NTFY_TOPIC)
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
            logger.info('ntfy OK: %s', titulo)
        else:
            logger.warning('ntfy status %s', resp.status_code)

    except Exception as e:
        logger.error('Erro ntfy: %s', e)


# =========================================================
# REGISTRAR NO LOG
# =========================================================

def registrar_log(conn, nr_parecer, nr_atendimento, especialidade, destinatarios, sucesso, resposta):
    """Registra notificacao no log."""
    cursor = conn.cursor()
    agora = datetime.now()

    chave = 'parecer_email_{}_{}'.format(nr_parecer, agora.strftime('%Y%m%d'))

    # Verifica se ja foi notificado hoje
    cursor.execute("""
        SELECT id FROM notificacoes_log
        WHERE chave_evento = %s
          AND status = 'notificado'
        LIMIT 1
    """, (chave,))

    if cursor.fetchone():
        cursor.close()
        return

    emails = ', '.join([d['email'] for d in destinatarios]) if destinatarios else 'nenhum'

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
        json.dumps({'destinatarios': emails}),
        NTFY_TOPIC,
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
    Detecta novos pareceres comparando pareceres_pendentes
    com o snapshot anterior.

    PRIMEIRA EXECUCAO (snapshot vazio):
      Popula o snapshot SEM notificar ninguem.

    EXECUCOES SEGUINTES:
      Detecta novos pareceres (delta) com horas_pendente <= 0.5
      (solicitados nos ultimos 30min) e notifica por email + ntfy.
    """
    logger.info('=' * 50)
    logger.info('Verificando pareceres pendentes...')

    conn = get_connection()
    if not conn:
        return

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Busca pareceres atuais
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
            logger.info('[pareceres] Snapshot populado. Proximos ciclos detectarao novos pareceres.')
            return

        # EXECUCOES SEGUINTES: detecta novos (delta)
        novos = pareceres_atuais_set - pareceres_anteriores
        notificados = 0
        ignorados = 0

        for nr_parecer in novos:
            parecer = pareceres_map[nr_parecer]

            # So notifica pareceres solicitados nos ultimos 30min
            horas = parecer.get('horas_pendente') or 0
            if horas > 0.5:
                ignorados += 1
                logger.debug(
                    '[pareceres] Parecer %s ignorado (%.1fh pendente, nao e recente)',
                    nr_parecer, horas
                )
                continue

            especialidade = parecer.get('especialidade_destino')

            # Busca destinatarios para essa especialidade
            destinatarios = buscar_destinatarios(conn, especialidade)

            if not destinatarios:
                logger.warning('Sem destinatarios para especialidade: %s', especialidade)
                continue

            # Monta titulo
            titulo = 'Parecer Pendente - {} - {}'.format(
                especialidade or 'Sem especialidade',
                parecer.get('nm_setor', '-')
            )

            # Envia email HTML
            corpo_html = montar_email_html(parecer)
            sucesso, resposta = enviar_email(destinatarios, titulo, corpo_html)

            # Envia ntfy push (sem dados de paciente)
            mensagem_ntfy = 'Novo parecer solicitado. Setor: {}, Leito: {}, Atend: {}'.format(
                parecer.get('nm_setor', '-'),
                parecer.get('cd_leito', '-'),
                parecer.get('nr_atendimento', '-')
            )
            enviar_ntfy(titulo, mensagem_ntfy)

            # Registra no log
            registrar_log(
                conn, nr_parecer,
                parecer.get('nr_atendimento'),
                especialidade,
                destinatarios,
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
            logger.info('[pareceres] %s novos pareceres notificados por email', notificados)
        elif ignorados > 0:
            logger.info('[pareceres] %s novos detectados mas ignorados (> 30min)', ignorados)
        else:
            logger.info('[pareceres] Nenhum parecer novo detectado (%s ativos)', len(pareceres_atuais))

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
    logger.info('  SMTP: %s via %s:%s', SMTP_FROM, SMTP_HOST, SMTP_PORT)
    logger.info('  ntfy: %s/%s', NTFY_URL, NTFY_TOPIC)
    logger.info('  Banco: %s@%s:%s/%s',
                 DB_CONFIG['user'], DB_CONFIG['host'],
                 DB_CONFIG['port'], DB_CONFIG['database'])
    logger.info('=' * 60)

    # Testa conexao
    conn = get_connection()
    if not conn:
        logger.error('Falha na conexao inicial. Encerrando.')
        sys.exit(1)
    conn.close()
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


if __name__ == '__main__':
    main()