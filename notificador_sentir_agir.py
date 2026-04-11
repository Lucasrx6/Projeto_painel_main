# -*- coding: utf-8 -*-
"""
==============================================================
  NOTIFICADOR SENTIR E AGIR - Email
  Hospital Anchieta Ceilandia
==============================================================

  Servico independente que monitora sentir_agir_tratativas
  e envia email quando detecta novas tratativas com avaliacao
  critico ou atencao.

  Funcionalidades:
  - Detecta novas tratativas (status=pendente + avaliacao critico/atencao)
  - Primeira execucao popula snapshot SEM notificar
  - Envia email HTML via Apprise (SMTP configurado no .env)
  - Destinatario: responsavel cadastrado na categoria ou setor
  - Deduplicacao via tabela notificacoes_snapshot
  - Logs rotativos em logs/notificador_sentir_agir.log

  CREDENCIAIS:
  - SMTP via .env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
  - ZERO credenciais hardcoded no codigo

  Execucao:
  - Standalone: python notificador_sentir_agir.py
  - Servico Windows via NSSM
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

logger = logging.getLogger('notificador_sentir_agir')
logger.setLevel(logging.INFO)

file_handler = logging.handlers.RotatingFileHandler(
    os.path.join(LOG_DIR, 'notificador_sentir_agir.log'),
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

# Intervalo de verificacao
INTERVALO_VERIFICACAO = int(os.getenv('NOTIF_SENTIR_AGIR_INTERVALO_MIN', '5'))


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
# BUSCAR TRATATIVAS PENDENTES CRITICAS/ATENCAO
# =========================================================

def buscar_tratativas_pendentes(conn):
    """
    Retorna todas as tratativas com status=pendente cuja visita
    tem avaliacao_final em critico ou atencao.
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute("""
        SELECT
            t.id AS tratativa_id,
            t.status,
            t.criado_em,
            i.descricao AS item_descricao,
            c.nome AS categoria_nome,
            c.id AS categoria_id,
            v.nm_paciente,
            v.nr_atendimento,
            v.leito,
            v.avaliacao_final,
            v.observacoes AS visita_observacoes,
            r.data_ronda,
            s.nome AS setor_nome,
            s.sigla AS setor_sigla,
            s.id AS setor_id,
            d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS dupla_nome
        FROM sentir_agir_tratativas t
        JOIN sentir_agir_visitas v ON v.id = t.visita_id
        JOIN sentir_agir_rondas r ON r.id = v.ronda_id
        JOIN sentir_agir_itens i ON i.id = t.item_id
        JOIN sentir_agir_categorias c ON c.id = i.categoria_id
        JOIN sentir_agir_setores s ON s.id = v.setor_id
        JOIN sentir_agir_duplas d ON d.id = r.dupla_id
        WHERE t.status = 'pendente'
          AND v.avaliacao_final IN ('critico', 'atencao')
    """)

    rows = cursor.fetchall()
    cursor.close()
    return [dict(r) for r in rows]


# =========================================================
# BUSCAR RESPONSAVEIS POR CATEGORIA OU SETOR
# =========================================================

def buscar_responsaveis(conn, categoria_id, setor_id):
    """
    Busca responsaveis com email cadastrado na categoria ou setor.
    Prioriza categoria; aceita ambos na mesma consulta.
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute("""
        SELECT DISTINCT nome, email
        FROM sentir_agir_responsaveis
        WHERE ativo = true
          AND email IS NOT NULL
          AND email <> ''
          AND (categoria_id = %s OR setor_id = %s)
        LIMIT 10
    """, (categoria_id, setor_id))

    responsaveis = cursor.fetchall()
    cursor.close()
    return [dict(r) for r in responsaveis]


# =========================================================
# MONTAR EMAIL HTML
# =========================================================

def _formatar_data(valor):
    """Formata data ou datetime para DD/MM/AAAA."""
    if not valor:
        return '--'
    if hasattr(valor, 'strftime'):
        return valor.strftime('%d/%m/%Y')
    partes = str(valor).split('T')[0].split('-')
    return '{}/{}/{}'.format(partes[2], partes[1], partes[0]) if len(partes) == 3 else str(valor)


def montar_email_html(t):
    """
    Monta corpo do email em HTML com dados da tratativa.
    Cor e label variam conforme avaliacao (critico=vermelho, atencao=laranja).
    """
    avaliacao = t.get('avaliacao_final', 'critico')
    cor = '#dc3545' if avaliacao == 'critico' else '#fd7e14'
    label = 'CRITICO' if avaliacao == 'critico' else 'ATENCAO'

    obs = t.get('visita_observacoes', '') or ''
    obs_html = obs.replace('\n', '<br>')
    bloco_obs = ''
    if obs:
        bloco_obs = (
            '<div style="margin-top:14px;padding:10px 14px;background:#f8f9fa;'
            'border-radius:4px;border-left:4px solid #6c757d;">'
            '<p style="margin:0;font-size:12px;color:#6c757d;font-weight:bold;">Observacoes da visita:</p>'
            '<p style="margin:6px 0 0;font-size:13px;color:#333;">' + obs_html + '</p>'
            '</div>'
        )

    html = """
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: {cor}; color: white; padding: 15px 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0; font-size: 18px;">Nova Tratativa - {label}</h2>
            <p style="margin: 5px 0 0; font-size: 13px; opacity: 0.9;">Hospital Anchieta Ceilandia - Projeto Sentir e Agir</p>
        </div>

        <div style="border: 1px solid #dee2e6; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">

            <div style="background: {cor}18; border-left: 4px solid {cor}; padding: 10px 14px; border-radius: 4px; margin-bottom: 16px;">
                <strong style="color: {cor}; font-size: 15px;">{item}</strong><br>
                <small style="color: #555;">Categoria: {categoria}</small>
            </div>

            <table style="width: 100%%; border-collapse: collapse; font-size: 14px;">
                <tr>
                    <td style="padding: 7px 0; color: #6c757d; width: 130px; vertical-align:top;">Paciente:</td>
                    <td style="padding: 7px 0; font-weight: bold;">{paciente}</td>
                </tr>
                <tr>
                    <td style="padding: 7px 0; color: #6c757d;">Atendimento:</td>
                    <td style="padding: 7px 0;">{atendimento}</td>
                </tr>
                <tr>
                    <td style="padding: 7px 0; color: #6c757d;">Setor:</td>
                    <td style="padding: 7px 0;">{setor}</td>
                </tr>
                <tr>
                    <td style="padding: 7px 0; color: #6c757d;">Leito:</td>
                    <td style="padding: 7px 0;">{leito}</td>
                </tr>
                <tr>
                    <td style="padding: 7px 0; color: #6c757d;">Data da Ronda:</td>
                    <td style="padding: 7px 0;">{data_ronda}</td>
                </tr>
                <tr>
                    <td style="padding: 7px 0; color: #6c757d;">Dupla:</td>
                    <td style="padding: 7px 0;">{dupla}</td>
                </tr>
                <tr>
                    <td style="padding: 7px 0; color: #6c757d;">Avaliacao:</td>
                    <td style="padding: 7px 0;">
                        <span style="background:{cor}; color:white; padding:2px 10px; border-radius:4px; font-size:12px; font-weight:bold;">{label}</span>
                    </td>
                </tr>
            </table>

            {bloco_obs}

            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 11px; color: #999; margin: 0; text-align: center;">
                Notificacao automatica - Sistema de Paineis HAC<br>
                Enviado em {enviado_em}
            </p>
        </div>
    </div>
    """.format(
        cor=cor,
        label=label,
        item=t.get('item_descricao', '-'),
        categoria=t.get('categoria_nome', '-'),
        paciente=t.get('nm_paciente', 'Nao informado'),
        atendimento=t.get('nr_atendimento', '--') or '--',
        setor=t.get('setor_nome', '-'),
        leito=t.get('leito', '-'),
        data_ronda=_formatar_data(t.get('data_ronda')),
        dupla=t.get('dupla_nome', '-'),
        bloco_obs=bloco_obs,
        enviado_em=datetime.now().strftime('%d/%m/%Y %H:%M')
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
            url = 'mailtos://{user}:{pwd}@{host}:{port}?from={sender}&to={to}&name=Notificacao+HAC'.format(
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
            return True, 'Email enviado para {} destinatario(s)'.format(len(destinatarios))
        else:
            logger.warning('Falha email para: %s', emails_lista)
            return False, 'Falha no envio para {}'.format(emails_lista)

    except Exception as e:
        logger.error('Erro email: %s', e)
        return False, str(e)


# =========================================================
# REGISTRAR NO LOG
# =========================================================

def _chave_tratativa(tratativa_id):
    """Chave permanente de deduplicacao no log (sem data — uma notificacao por tratativa)."""
    return 'sentir_agir_trat_{}'.format(tratativa_id)


def ja_notificado(conn, tratativa_id):
    """
    Retorna True se essa tratativa ja foi notificada com sucesso em qualquer momento.
    Usa notificacoes_log como fonte da verdade permanente.
    """
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id FROM notificacoes_log
        WHERE chave_evento = %s AND status = 'notificado'
        LIMIT 1
    """, (_chave_tratativa(tratativa_id),))
    existe = cursor.fetchone() is not None
    cursor.close()
    return existe


def registrar_log(conn, tratativa_id, nr_atendimento, categoria, setor, destinatarios, sucesso, resposta):
    """Insere registro no log. Nao verifica duplicata aqui — a checagem e feita em ja_notificado()."""
    cursor = conn.cursor()
    agora = datetime.now()
    chave = _chave_tratativa(tratativa_id)
    emails = ', '.join([d['email'] for d in destinatarios]) if destinatarios else 'nenhum'

    dados_extra = json.dumps({
        'destinatarios_email': emails,
        'categoria': categoria or '',
        'setor': setor or ''
    }, ensure_ascii=False)

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
        'sentir_agir_tratativa', chave, str(nr_atendimento or ''), setor,
        dados_extra,
        '',
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
# CICLO PRINCIPAL: VERIFICAR NOVAS TRATATIVAS
# =========================================================

def verificar_tratativas():
    """
    Verifica tratativas pendentes com avaliacao critico/atencao e envia email
    para as que ainda nao foram notificadas.

    Logica:
    - Busca todas as tratativas pendentes (critico/atencao) no banco
    - Para cada uma, consulta notificacoes_log pela chave permanente
    - So notifica se nunca houve notificacao com sucesso
    - Idempotente: reiniciar o servico nao perde nem duplica notificacoes
    """
    logger.info('=' * 50)
    logger.info('Verificando novas tratativas criticas/atencao...')

    conn = get_connection()
    if not conn:
        return

    try:
        tratativas_atuais = buscar_tratativas_pendentes(conn)

        if not tratativas_atuais:
            logger.info('[sentir_agir] Nenhuma tratativa pendente critico/atencao no momento')
            return

        notificados = 0
        ignorados = 0
        sem_responsavel = 0

        for t in tratativas_atuais:
            tid = t['tratativa_id']

            # Pula se ja foi enviado com sucesso em qualquer execucao anterior
            if ja_notificado(conn, tid):
                ignorados += 1
                continue

            responsaveis = buscar_responsaveis(conn, t['categoria_id'], t['setor_id'])

            avaliacao = t.get('avaliacao_final', 'critico')
            label_av = 'CRITICO' if avaliacao == 'critico' else 'ATENCAO'

            titulo = 'Sentir e Agir - {} - {} - {}'.format(
                label_av,
                t.get('categoria_nome', '-'),
                t.get('setor_nome', '-')
            )

            sucesso_email = False
            resposta_email = 'Sem responsavel com email cadastrado'

            if responsaveis:
                corpo_html = montar_email_html(t)
                sucesso_email, resposta_email = enviar_email(responsaveis, titulo, corpo_html)
            else:
                sem_responsavel += 1
                logger.info(
                    '[sentir_agir] Sem responsavel com email para categoria=%s setor=%s',
                    t.get('categoria_nome'), t.get('setor_nome')
                )

            registrar_log(
                conn, tid,
                t.get('nr_atendimento'),
                t.get('categoria_nome'),
                t.get('setor_nome'),
                responsaveis,
                sucesso_email, resposta_email
            )

            notificados += 1

        # Resumo
        if notificados > 0:
            logger.info(
                '[sentir_agir] %s notificadas | %s sem responsavel | %s ja enviadas anteriormente',
                notificados, sem_responsavel, ignorados
            )
        else:
            logger.info(
                '[sentir_agir] Nenhuma nova (%s em monitoramento, %s ja notificadas)',
                len(tratativas_atuais), ignorados
            )

    except Exception as e:
        logger.error('[sentir_agir] Erro: %s', e)
    finally:
        conn.close()


# =========================================================
# MAIN
# =========================================================

def main():
    """Ponto de entrada do notificador Sentir e Agir."""
    logger.info('=' * 60)
    logger.info('  NOTIFICADOR SENTIR E AGIR - Email')
    logger.info('  Intervalo: %s minutos (padrao 5)', INTERVALO_VERIFICACAO)
    logger.info('  SMTP: %s via %s:%s', SMTP_FROM or '(usar SMTP_USER)', SMTP_HOST or '(nao configurado)', SMTP_PORT)
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

    if not SMTP_FROM:
        logger.info('SMTP_FROM nao definido, usando SMTP_USER: %s', SMTP_USER)

    # Testa conexao com banco
    conn = get_connection()
    if not conn:
        logger.error('Falha na conexao inicial. Encerrando.')
        sys.exit(1)
    conn.close()
    logger.info('Conexao com banco OK')

    # Primeiro ciclo imediato
    verificar_tratativas()

    # Agenda ciclos seguintes
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


if __name__ == '__main__':
    main()
