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

# URL base da aplicacao (para links diretos nas notificacoes)
APP_BASE_URL = os.getenv('APP_BASE_URL', '').rstrip('/')


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
    Retorna todas as tratativas com status=pendente (itens criticos/nao).
    Inclui descricao_problema para exibir a observacao especifica do item no email.
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute("""
        SELECT
            t.id AS tratativa_id,
            t.status,
            t.criado_em,
            t.descricao_problema,
            i.descricao AS item_descricao,
            c.nome AS categoria_nome,
            c.id AS categoria_id,
            v.id AS visita_id,
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
    """)

    rows = cursor.fetchall()
    cursor.close()
    return [dict(r) for r in rows]


def buscar_visitas_atencao(conn):
    """
    Retorna visitas com avaliacao_final = 'atencao' para envio de alerta simples.
    Inclui os itens marcados como 'atencao' para listagem no email.
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute("""
        SELECT
            v.id AS visita_id,
            v.nm_paciente,
            v.nr_atendimento,
            v.leito,
            v.observacoes AS visita_observacoes,
            v.criado_em,
            r.data_ronda,
            s.nome AS setor_nome,
            s.sigla AS setor_sigla,
            s.id AS setor_id,
            d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS dupla_nome
        FROM sentir_agir_visitas v
        JOIN sentir_agir_rondas r ON r.id = v.ronda_id
        JOIN sentir_agir_setores s ON s.id = v.setor_id
        JOIN sentir_agir_duplas d ON d.id = r.dupla_id
        WHERE v.avaliacao_final = 'atencao'
    """)
    visitas = [dict(r) for r in cursor.fetchall()]

    for v in visitas:
        cursor.execute("""
            SELECT i.descricao AS item_descricao, c.nome AS categoria_nome, c.id AS categoria_id
            FROM sentir_agir_avaliacoes a
            JOIN sentir_agir_itens i ON i.id = a.item_id
            JOIN sentir_agir_categorias c ON c.id = i.categoria_id
            WHERE a.visita_id = %s AND a.resultado = 'atencao'
            ORDER BY c.ordem, i.ordem
        """, (v['visita_id'],))
        v['itens_atencao'] = [dict(r) for r in cursor.fetchall()]

    cursor.close()
    return visitas


# =========================================================
# BUSCAR RESPONSAVEIS POR CATEGORIA OU SETOR
# =========================================================

def buscar_responsaveis(conn, categoria_id, setor_id):
    """
    Busca responsaveis com email cadastrado via tabelas N:M.

    Para criticos (categoria_id informado):
      - Somente responsaveis vinculados a categoria (via sentir_agir_responsavel_categorias)
      - Se o responsavel NAO tiver nenhum setor vinculado, recebe sempre (responsavel geral da categoria)
      - Se o responsavel TIVER setor(es) vinculado(s), so recebe se um deles bater com o setor do evento

    Para atencao (categoria_id None):
      - Responsaveis vinculados ao setor diretamente (via sentir_agir_responsavel_setores)
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    if categoria_id is not None:
        cursor.execute("""
            SELECT DISTINCT r.nome, r.email
            FROM sentir_agir_responsaveis r
            JOIN sentir_agir_responsavel_categorias rc ON rc.responsavel_id = r.id
            LEFT JOIN sentir_agir_responsavel_setores rs ON rs.responsavel_id = r.id
            WHERE r.ativo = true
              AND r.email IS NOT NULL
              AND r.email <> ''
              AND rc.categoria_id = %s
              AND (
                  NOT EXISTS (SELECT 1 FROM sentir_agir_responsavel_setores rs2 WHERE rs2.responsavel_id = r.id)
                  OR rs.setor_id = %s
              )
            LIMIT 10
        """, (categoria_id, setor_id))
    else:
        cursor.execute("""
            SELECT DISTINCT r.nome, r.email
            FROM sentir_agir_responsaveis r
            JOIN sentir_agir_responsavel_setores rs ON rs.responsavel_id = r.id
            WHERE r.ativo = true
              AND r.email IS NOT NULL
              AND r.email <> ''
              AND rs.setor_id = %s
            LIMIT 10
        """, (setor_id,))

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


def _extrair_obs_item(descricao_problema):
    """
    Extrai a observacao especifica do item da descricao_problema.
    Formato esperado: '... | Observacao do item: TEXTO' ou '... | Observacao da visita: TEXTO'
    Retorna (tipo, texto) onde tipo e 'item', 'visita' ou None.
    """
    if not descricao_problema:
        return None, None
    if ' | Observacao do item: ' in descricao_problema:
        texto = descricao_problema.split(' | Observacao do item: ', 1)[1]
        return 'item', texto.strip()
    if ' | Observacao da visita: ' in descricao_problema:
        texto = descricao_problema.split(' | Observacao da visita: ', 1)[1]
        return 'visita', texto.strip()
    return None, None


def montar_email_html(t):
    """
    Monta email HTML para item CRITICO.
    Exibe de forma destacada a observacao especifica do item (se houver).
    """
    cor = '#dc3545'
    label = 'CRITICO'

    tipo_obs, texto_obs = _extrair_obs_item(t.get('descricao_problema', ''))
    bloco_obs_item = ''
    if texto_obs:
        titulo_obs = 'Observacao sobre este item:' if tipo_obs == 'item' else 'Observacao da visita:'
        bloco_obs_item = (
            '<div style="margin-top:16px;padding:14px 16px;background:#fff0f0;'
            'border-radius:6px;border-left:5px solid #dc3545;">'
            '<p style="margin:0;font-size:12px;color:#dc3545;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;">'
            + titulo_obs + '</p>'
            '<p style="margin:8px 0 0;font-size:14px;color:#333;line-height:1.5;">'
            + texto_obs.replace('\n', '<br>') + '</p>'
            '</div>'
        )

    bloco_link = ''
    if APP_BASE_URL:
        link = '{}/painel/painel30?abrir={}'.format(APP_BASE_URL, t.get('tratativa_id', ''))
        bloco_link = (
            '<div style="text-align:center;margin-top:18px;">'
            '<a href="{link}" style="display:inline-block;padding:10px 24px;background:{cor};'
            'color:white;border-radius:6px;font-weight:bold;text-decoration:none;font-size:14px;">'
            'Abrir Tratativa</a></div>'
        ).format(link=link, cor=cor)

    html = """
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: {cor}; color: white; padding: 15px 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0; font-size: 18px;">Nova Tratativa - {label}</h2>
            <p style="margin: 5px 0 0; font-size: 13px; opacity: 0.9;">Hospital Anchieta Ceilandia - Projeto Sentir e Agir</p>
        </div>

        <div style="border: 1px solid #dee2e6; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">

            <div style="background: #fff0f0; border-left: 4px solid {cor}; padding: 12px 16px; border-radius: 4px; margin-bottom: 16px;">
                <strong style="color: {cor}; font-size: 15px;">{item}</strong><br>
                <small style="color: #555; margin-top: 4px; display:block;">Categoria: {categoria}</small>
            </div>

            {bloco_obs_item}

            <table style="width: 100%%; border-collapse: collapse; font-size: 14px; margin-top: 16px;">
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

            {bloco_link}

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
        bloco_obs_item=bloco_obs_item,
        bloco_link=bloco_link,
        paciente=t.get('nm_paciente', 'Nao informado'),
        atendimento=t.get('nr_atendimento', '--') or '--',
        setor=t.get('setor_nome', '-'),
        leito=t.get('leito', '-'),
        data_ronda=_formatar_data(t.get('data_ronda')),
        dupla=t.get('dupla_nome', '-'),
        enviado_em=datetime.now().strftime('%d/%m/%Y %H:%M')
    )

    return html


def montar_email_html_atencao(v):
    """
    Monta email HTML de ALERTA para visita com avaliacao ATENCAO.
    Lista os itens marcados como atencao para contexto do gestor.
    """
    cor = '#fd7e14'
    itens = v.get('itens_atencao', [])

    linhas_itens = ''
    for item in itens:
        linhas_itens += (
            '<tr>'
            '<td style="padding:6px 8px;border-bottom:1px solid #ffe8d0;font-size:13px;color:#333;">'
            + item.get('item_descricao', '-') +
            '</td>'
            '<td style="padding:6px 8px;border-bottom:1px solid #ffe8d0;font-size:12px;color:#6c757d;">'
            + item.get('categoria_nome', '-') +
            '</td>'
            '</tr>'
        )
    if not linhas_itens:
        linhas_itens = '<tr><td colspan="2" style="padding:8px;color:#aaa;font-size:12px;">Itens nao identificados</td></tr>'

    obs = v.get('visita_observacoes', '') or ''
    bloco_obs = ''
    if obs:
        bloco_obs = (
            '<div style="margin-top:14px;padding:10px 14px;background:#f8f9fa;'
            'border-radius:4px;border-left:4px solid #6c757d;">'
            '<p style="margin:0;font-size:12px;color:#6c757d;font-weight:bold;">Observacoes da visita:</p>'
            '<p style="margin:6px 0 0;font-size:13px;color:#333;">' + obs.replace('\n', '<br>') + '</p>'
            '</div>'
        )

    html = """
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: {cor}; color: white; padding: 15px 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0; font-size: 18px;">Alerta de Atencao - Visita</h2>
            <p style="margin: 5px 0 0; font-size: 13px; opacity: 0.9;">Hospital Anchieta Ceilandia - Projeto Sentir e Agir</p>
        </div>

        <div style="border: 1px solid #dee2e6; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">

            <div style="background: #fff8f0; border-left: 4px solid {cor}; padding: 12px 16px; border-radius: 4px; margin-bottom: 16px;">
                <strong style="color: {cor}; font-size: 14px;">Itens que requerem atencao nesta visita:</strong>
            </div>

            <table style="width:100%%;border-collapse:collapse;font-size:14px;background:#fff8f0;border-radius:6px;overflow:hidden;">
                <thead>
                    <tr style="background:{cor}22;">
                        <th style="padding:8px;text-align:left;font-size:12px;color:{cor};font-weight:bold;">Item</th>
                        <th style="padding:8px;text-align:left;font-size:12px;color:{cor};font-weight:bold;">Categoria</th>
                    </tr>
                </thead>
                <tbody>
                    {linhas_itens}
                </tbody>
            </table>

            <table style="width: 100%%; border-collapse: collapse; font-size: 14px; margin-top: 16px;">
                <tr>
                    <td style="padding: 7px 0; color: #6c757d; width: 130px;">Paciente:</td>
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
                        <span style="background:{cor}; color:white; padding:2px 10px; border-radius:4px; font-size:12px; font-weight:bold;">ATENCAO</span>
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
        linhas_itens=linhas_itens,
        paciente=v.get('nm_paciente', 'Nao informado'),
        atendimento=v.get('nr_atendimento', '--') or '--',
        setor=v.get('setor_nome', '-'),
        leito=v.get('leito', '-'),
        data_ronda=_formatar_data(v.get('data_ronda')),
        dupla=v.get('dupla_nome', '-'),
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
    return 'sentir_agir_trat_{}'.format(tratativa_id)


def _chave_atencao(visita_id):
    return 'sentir_agir_atencao_{}'.format(visita_id)


def ja_notificado_por_chave(conn, chave):
    """Retorna True se essa chave ja foi notificada com sucesso."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id FROM notificacoes_log
        WHERE chave_evento = %s AND status = 'notificado'
        LIMIT 1
    """, (chave,))
    existe = cursor.fetchone() is not None
    cursor.close()
    return existe


def ja_notificado(conn, tratativa_id):
    return ja_notificado_por_chave(conn, _chave_tratativa(tratativa_id))


def registrar_log_chave(conn, tipo_evento, chave, nr_atendimento, categoria, setor, destinatarios, sucesso, resposta):
    """Insere registro no log pela chave fornecida."""
    cursor = conn.cursor()
    agora = datetime.now()
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
        tipo_evento, chave, str(nr_atendimento or ''), setor,
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


def registrar_log(conn, tratativa_id, nr_atendimento, categoria, setor, destinatarios, sucesso, resposta):
    """Mantém compatibilidade — delega para registrar_log_chave."""
    registrar_log_chave(
        conn, 'sentir_agir_tratativa', _chave_tratativa(tratativa_id),
        nr_atendimento, categoria, setor, destinatarios, sucesso, resposta
    )


# =========================================================
# CICLO PRINCIPAL: VERIFICAR NOVAS TRATATIVAS
# =========================================================

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
        # ── BLOCO 1: itens CRITICOS (via tratativas) ──────────────────────
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
            titulo = 'Sentir e Agir - CRITICO - {} - {}'.format(
                t.get('categoria_nome', '-'),
                t.get('setor_nome', '-')
            )

            sucesso_email = False
            resposta_email = 'Sem responsavel com email cadastrado'

            if responsaveis:
                corpo_html = montar_email_html(t)
                sucesso_email, resposta_email = enviar_email(responsaveis, titulo, corpo_html)
            else:
                sem_resp_critico += 1
                logger.info(
                    '[critico] Sem responsavel para categoria=%s setor=%s',
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
            notif_critico += 1

        if tratativas_atuais:
            logger.info(
                '[critico] %s notificadas | %s sem responsavel | %s ja enviadas',
                notif_critico, sem_resp_critico, ignorados_critico
            )
        else:
            logger.info('[critico] Nenhuma tratativa pendente no momento')

        # ── BLOCO 2: visitas de ATENCAO (alerta simples) ──────────────────
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

            # Para atencao, busca responsaveis pelo setor (sem categoria especifica)
            responsaveis = buscar_responsaveis(conn, None, v['setor_id'])
            titulo = 'Sentir e Agir - ATENCAO - {} - {}'.format(
                v.get('setor_nome', '-'),
                _formatar_data(v.get('data_ronda'))
            )

            sucesso_email = False
            resposta_email = 'Sem responsavel com email cadastrado'

            if responsaveis:
                corpo_html = montar_email_html_atencao(v)
                sucesso_email, resposta_email = enviar_email(responsaveis, titulo, corpo_html)
            else:
                sem_resp_atencao += 1
                logger.info(
                    '[atencao] Sem responsavel para setor=%s', v.get('setor_nome')
                )

            registrar_log_chave(
                conn, 'sentir_agir_atencao', chave,
                v.get('nr_atendimento'),
                'atencao',
                v.get('setor_nome'),
                responsaveis,
                sucesso_email, resposta_email
            )
            notif_atencao += 1

        if visitas_atencao:
            logger.info(
                '[atencao] %s notificadas | %s sem responsavel | %s ja enviadas',
                notif_atencao, sem_resp_atencao, ignorados_atencao
            )
        else:
            logger.info('[atencao] Nenhuma visita de atencao no momento')

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
