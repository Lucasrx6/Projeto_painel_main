# -*- coding: utf-8 -*-
"""
==============================================================
  NOTIFICADOR PACIENTE PS SEM MEDICO - Email
  Hospital Anchieta Ceilandia
==============================================================

  Servico independente que monitora painel_ps_analise e medicos_ps.
  Dispara email quando detecta:
    - Pelo menos 1 paciente aguardando >= 10 min em uma clinica
    - E nenhum medico daquela clinica logado no consultorio

  Regras:
    - Verifica a cada 10 min (NOTIF_PACIENTE_PS_INTERVALO_MIN no .env)
    - Reenvia enquanto a condicao persistir (cooldown de 10 min por clinica)
    - Destinatarios configurados no Painel 26 (tipo: paciente_ps_sem_medico)
    - Credentials SMTP do .env (mesmo padrao do notificador_pareceres)

  Execucao:
    - Standalone: python notificador_paciente_ps.py
    - Background thread no Flask (NOTIF_PACIENTE_PS_AUTO=true)
==============================================================
"""

import psycopg2
from psycopg2.extras import RealDictCursor
import apprise
import schedule
import time
import logging
import logging.handlers
import os
import sys
import json
import unicodedata
from datetime import datetime
from dotenv import load_dotenv
from urllib.parse import quote as url_encode

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))


# =========================================================
# LOGGING
# =========================================================

LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

logger = logging.getLogger('notificador_paciente_ps')
logger.setLevel(logging.INFO)

file_handler = logging.handlers.RotatingFileHandler(
    os.path.join(LOG_DIR, 'notificador_paciente_ps.log'),
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
    'host':     os.getenv('DB_HOST', 'localhost'),
    'database': os.getenv('DB_NAME', 'postgres'),
    'user':     os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', ''),
    'port':     os.getenv('DB_PORT', '5432')
}

SMTP_HOST = os.getenv('SMTP_HOST', '')
SMTP_PORT = os.getenv('SMTP_PORT', '587')
SMTP_USER = os.getenv('SMTP_USER', '')
SMTP_PASS = os.getenv('SMTP_PASS', '')
SMTP_FROM = os.getenv('SMTP_FROM', '')

# Intervalo de verificacao e cooldown por clinica (em minutos)
INTERVALO_MIN   = int(os.getenv('NOTIF_PACIENTE_PS_INTERVALO_MIN', '10'))
COOLDOWN_MIN    = INTERVALO_MIN          # cooldown = mesmo intervalo
ESPERA_MIN_ALERTA = 10                   # paciente aguardando >= 10 min


# =========================================================
# NORMALIZACAO E ALIAS DE CLINICAS
# (mesma logica do painel10_routes.py)
# =========================================================

_ALIAS_ESPECIALIDADE = {
    'CLINICA GERAL':             'CLINICA MEDICA',
    'CIRURGIAL GERAL':           'CIRURGICA GERAL',
    'GINECOLOGIA E OBSTETRICIA': 'GINECOLOGIA',
    'OBSTETRICIA':               'GINECOLOGIA',
    'ORTOPEDIA E TRAUMATOLOGIA': 'ORTOPEDIA',
    'ORTOPEDIA':                 'ORTOPEDIA',
    'PEDIATRIA':                 'PEDIATRIA',
    'CLINICA MEDICA':            'CLINICA MEDICA',
    'EMERGENCISTA':              'EMERGENCISTA',
}


def _norm(texto):
    """Remove acentos e normaliza para comparacao de nomes de clinicas."""
    if not texto:
        return ''
    nfkd = unicodedata.normalize('NFKD', str(texto).upper().strip())
    return ''.join(c for c in nfkd if not unicodedata.combining(c))


def _clinica_tem_medico(ds_clinica, especialidades_ativas):
    """
    Verifica se ha medico logado para a clinica dada.
    especialidades_ativas: set de _norm(especialidade) dos medicos em medicos_ps.
    """
    ds_norm = _norm(ds_clinica)

    for esp_norm in especialidades_ativas:
        canonical = _ALIAS_ESPECIALIDADE.get(esp_norm, esp_norm)
        # Match exato
        if canonical == ds_norm:
            return True
        # Match parcial (ex.: "ORTOPEDIA" dentro de "ORTOPEDIA E TRAUMATOLOGIA")
        if ds_norm in esp_norm or esp_norm in ds_norm:
            return True
        if ds_norm in canonical or canonical in ds_norm:
            return True

    return False


# =========================================================
# CONEXAO
# =========================================================

def get_connection():
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        return conn
    except Exception as e:
        logger.error('Erro ao conectar no banco: %s', e)
        return None


# =========================================================
# BUSCAR DESTINATARIOS EMAIL
# =========================================================

def buscar_destinatarios_email(conn):
    """
    Busca destinatarios ativos para tipo_evento = 'paciente_ps_sem_medico'.
    Configurados via Painel 26.
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT DISTINCT ON (email) nome, email
        FROM notificacoes_destinatarios
        WHERE tipo_evento = 'paciente_ps_sem_medico'
          AND canal = 'email'
          AND ativo = true
        ORDER BY email
    """)
    destinatarios = [dict(r) for r in cursor.fetchall()]
    cursor.close()
    return destinatarios


# =========================================================
# DETECTAR CLINICAS EM ALERTA
# =========================================================

def detectar_alertas(conn):
    """
    Retorna lista de clinicas onde:
      - Ha pelo menos 1 paciente aguardando >= ESPERA_MIN_ALERTA minutos
      - Nenhum medico daquela clinica esta logado em medicos_ps
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    # 1. Clinicas com pacientes aguardando >= ESPERA_MIN_ALERTA min
    cursor.execute("""
        SELECT
            ds_clinica,
            COUNT(*) AS qt_aguardando,
            ROUND(
                EXTRACT(EPOCH FROM (NOW() - MIN(dt_entrada::timestamptz))) / 60
            )::int AS max_espera_min
        FROM painel_ps_analise
        WHERE (dt_atend_medico IS NULL OR dt_atend_medico = '')
          AND (dt_alta IS NULL OR dt_alta = '')
          AND dt_entrada::timestamptz >= NOW() - INTERVAL '24 hours'
        GROUP BY ds_clinica
        HAVING EXTRACT(EPOCH FROM
            (NOW() - MIN(dt_entrada::timestamptz))
        ) / 60 >= %s
    """, (ESPERA_MIN_ALERTA,))
    clinicas_aguardando = [dict(r) for r in cursor.fetchall()]

    if not clinicas_aguardando:
        cursor.close()
        return []

    # 2. Especialidades de medicos atualmente logados
    cursor.execute("""
        SELECT UPPER(especialidade) AS esp_upper
        FROM medicos_ps
        WHERE especialidade IS NOT NULL AND especialidade != ''
    """)
    especialidades_ativas = {_norm(r['esp_upper']) for r in cursor.fetchall()}
    cursor.close()

    # 3. Filtra clinicas SEM medico
    alertas = []
    for clinica in clinicas_aguardando:
        if not _clinica_tem_medico(clinica['ds_clinica'], especialidades_ativas):
            alertas.append(clinica)

    return alertas


# =========================================================
# COOLDOWN POR CLINICA (via notificacoes_log)
# =========================================================

def _chave_clinica(ds_clinica):
    return 'ps_sem_medico_{}_{}'.format(
        ds_clinica.lower().replace(' ', '_'),
        datetime.now().strftime('%Y%m%d')
    )


def clinica_em_cooldown(conn, ds_clinica):
    """Retorna True se ja enviamos alerta para esta clinica nos ultimos COOLDOWN_MIN min."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT dt_ultima_notificacao
        FROM notificacoes_log
        WHERE chave_evento = %s
          AND status = 'notificado'
          AND dt_ultima_notificacao >= NOW() - INTERVAL '%s minutes'
        LIMIT 1
    """, (_chave_clinica(ds_clinica), COOLDOWN_MIN))
    result = cursor.fetchone()
    cursor.close()
    return result is not None


def registrar_log(conn, ds_clinica, qt_aguardando, max_espera_min, sucesso, resposta):
    """
    Insere ou atualiza registro na notificacoes_log.
    Atualiza qt_notificacoes e dt_ultima_notificacao em cada reenvio.
    """
    cursor = conn.cursor()
    agora = datetime.now()
    chave = _chave_clinica(ds_clinica)

    # Verifica se ja existe registro hoje
    cursor.execute("""
        SELECT id FROM notificacoes_log
        WHERE chave_evento = %s
        LIMIT 1
    """, (chave,))
    existente = cursor.fetchone()

    dados_extra = json.dumps({
        'qt_aguardando': qt_aguardando,
        'max_espera_min': max_espera_min,
        'clinica': ds_clinica
    })

    if existente:
        cursor.execute("""
            UPDATE notificacoes_log
            SET dt_ultima_notificacao = %s,
                qt_notificacoes = qt_notificacoes + 1,
                status = %s,
                resposta_ntfy = %s,
                dados_extra = %s
            WHERE id = %s
        """, (
            agora,
            'notificado' if sucesso else 'erro',
            resposta,
            dados_extra,
            existente[0]
        ))
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
            'paciente_ps_sem_medico',
            chave,
            None,
            ds_clinica,
            dados_extra,
            None,
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
# MONTAR EMAIL HTML
# =========================================================

def montar_email_html(alertas):
    """
    Monta email HTML resumindo todas as clinicas em alerta.
    """
    agora = datetime.now().strftime('%d/%m/%Y %H:%M')

    linhas_tabela = ''
    for a in alertas:
        cor_espera = '#28a745' if a['max_espera_min'] < 20 else ('#ffc107' if a['max_espera_min'] < 40 else '#dc3545')
        linhas_tabela += """
            <tr>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600;">{clinica}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center;">
                    <span style="background:#fff3cd;color:#856404;padding:3px 10px;border-radius:4px;font-weight:700;">
                        {qt}
                    </span>
                </td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center;">
                    <span style="background:{cor};color:white;padding:3px 10px;border-radius:4px;font-weight:700;">
                        {espera} min
                    </span>
                </td>
            </tr>
        """.format(
            clinica=a['ds_clinica'],
            qt=a['qt_aguardando'],
            cor=cor_espera,
            espera=a['max_espera_min']
        )

    html = """
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:620px;margin:0 auto;padding:20px;">

        <div style="background:#dc3545;color:white;padding:16px 20px;border-radius:8px 8px 0 0;">
            <h2 style="margin:0;font-size:18px;">&#9888; Alerta: Pacientes sem Medico no PS</h2>
            <p style="margin:5px 0 0;font-size:13px;opacity:0.9;">Hospital Anchieta Ceilandia &mdash; {agora}</p>
        </div>

        <div style="border:1px solid #dee2e6;border-top:none;border-radius:0 0 8px 8px;overflow:hidden;">

            <div style="padding:16px 20px;background:#fff8f8;border-bottom:1px solid #f5c6cb;">
                <p style="margin:0;font-size:14px;color:#721c24;">
                    <strong>{qt_clinicas} cl&iacute;nica(s)</strong> com paciente(s) aguardando h&aacute; mais de
                    <strong>{espera_min} minutos</strong> sem m&eacute;dico atendendo.
                </p>
            </div>

            <table style="width:100%;border-collapse:collapse;font-size:14px;">
                <thead>
                    <tr style="background:#f8f9fa;">
                        <th style="padding:10px 12px;text-align:left;color:#6c757d;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Cl&iacute;nica</th>
                        <th style="padding:10px 12px;text-align:center;color:#6c757d;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Aguardando</th>
                        <th style="padding:10px 12px;text-align:center;color:#6c757d;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Maior Espera</th>
                    </tr>
                </thead>
                <tbody>
                    {linhas}
                </tbody>
            </table>

            <div style="padding:16px 20px;background:#f8f9fa;text-align:center;">
                <p style="margin:0;font-size:11px;color:#999;">
                    Notifica&ccedil;&atilde;o autom&aacute;tica &mdash; Sistema de Pain&eacute;is HAC<br>
                    Repete a cada {intervalo} minutos enquanto a condi&ccedil;&atilde;o persistir.
                </p>
            </div>
        </div>
    </div>
    """.format(
        agora=agora,
        qt_clinicas=len(alertas),
        espera_min=ESPERA_MIN_ALERTA,
        linhas=linhas_tabela,
        intervalo=INTERVALO_MIN
    )

    return html


# =========================================================
# ENVIAR EMAIL VIA APPRISE
# =========================================================

def enviar_email(destinatarios, titulo, corpo_html):
    if not destinatarios:
        logger.warning('Nenhum destinatario email configurado para paciente_ps_sem_medico')
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
            url = 'mailtos://{user}:{pwd}@{host}:{port}?from={sender}&to={to}&name=Notificacao+PS'.format(
                user=user_encoded,
                pwd=pass_encoded,
                host=SMTP_HOST,
                port=SMTP_PORT,
                sender=url_encode(from_addr, safe=''),
                to=url_encode(dest['email'], safe='')
            )
            ap.add(url)

        resultado = ap.notify(
            title=titulo,
            body=corpo_html,
            body_format=apprise.NotifyFormat.HTML,
            notify_type=apprise.NotifyType.FAILURE
        )

        emails_lista = ', '.join([d['email'] for d in destinatarios])

        if resultado:
            logger.info('Email PS OK para: %s', emails_lista)
            return True, 'Enviado para {}'.format(len(destinatarios))
        else:
            logger.warning('Falha email PS para: %s', emails_lista)
            return False, 'Falha no envio'

    except Exception as e:
        logger.error('Erro email PS: %s', e)
        return False, str(e)


# =========================================================
# CICLO PRINCIPAL
# =========================================================

def verificar_pacientes_ps():
    """
    Detecta clinicas com pacientes aguardando >= ESPERA_MIN_ALERTA min sem medico.
    Envia um email agrupado por ciclo. Reenvio controlado por cooldown por clinica.
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

        # Filtra clinicas que ainda nao estao em cooldown
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

        titulo = '[ALERTA PS] {} clinica(s) sem medico com pacientes aguardando'.format(
            len(alertas_novos)
        )

        corpo_html = montar_email_html(alertas_novos)
        sucesso, resposta = enviar_email(destinatarios, titulo, corpo_html)

        # Registra log por clinica
        for alerta in alertas_novos:
            registrar_log(
                conn,
                alerta['ds_clinica'],
                alerta['qt_aguardando'],
                alerta['max_espera_min'],
                sucesso,
                resposta
            )

        if sucesso:
            logger.info('[paciente_ps] Alerta enviado para %s destinatario(s).', len(destinatarios))
        else:
            logger.warning('[paciente_ps] Falha no envio: %s', resposta)

    except Exception as e:
        logger.error('[paciente_ps] Erro no ciclo: %s', e, exc_info=True)
    finally:
        conn.close()


# =========================================================
# MAIN (standalone)
# =========================================================

def main():
    logger.info('=' * 60)
    logger.info('  NOTIFICADOR PACIENTE PS SEM MEDICO')
    logger.info('  Intervalo: %s min | Alerta a partir de: %s min de espera', INTERVALO_MIN, ESPERA_MIN_ALERTA)
    logger.info('  SMTP: %s via %s:%s', SMTP_FROM or SMTP_USER, SMTP_HOST or '(nao configurado)', SMTP_PORT)
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

    # Primeiro ciclo imediato
    verificar_pacientes_ps()

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


# =========================================================
# INTEGRACAO FLASK (thread daemon)
# =========================================================

_background_started = False


def start_in_background():
    """
    Inicia o notificador como thread daemon junto com o Flask.
    OFF SWITCH: NOTIF_PACIENTE_PS_AUTO=false no .env
    """
    global _background_started
    if _background_started:
        return

    if os.getenv('NOTIF_PACIENTE_PS_AUTO', 'true').lower() != 'true':
        logger.info('[notificador_paciente_ps] Auto-start desativado (NOTIF_PACIENTE_PS_AUTO=false)')
        return

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
            _scheduler = _sched.Scheduler()

            logger.info('[notificador_paciente_ps] Thread daemon iniciada (PID %s, intervalo %smin)',
                        os.getpid(), INTERVALO_MIN)

            verificar_pacientes_ps()
            _scheduler.every(INTERVALO_MIN).minutes.do(verificar_pacientes_ps)

            while True:
                _scheduler.run_pending()
                time.sleep(30)

        except Exception as e:
            logger.error('[notificador_paciente_ps] Erro fatal na thread daemon: %s', e, exc_info=True)

    t = threading.Thread(target=_run, name='notificador_paciente_ps', daemon=True)
    t.start()
    logger.info('[notificador_paciente_ps] Thread daemon registrada')


if __name__ == '__main__':
    main()
