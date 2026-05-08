# -*- coding: utf-8 -*-
"""
============================================================
  WORKER DE VERIFICAÇÃO E AUTO-REPARO DO SISTEMA
  Hospital Anchieta Ceilandia
============================================================

  Roda a cada 6 horas como thread daemon no Flask.
  Verifica todos os pontos críticos da infraestrutura,
  aplica reparos automáticos onde possível e envia
  email com o relatório de saúde do sistema.

  Execução manual: python worker_tests_sistema.py
============================================================
"""

import os
import sys
import time
import json
import logging
import logging.handlers
import threading
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(BASE_DIR, '.env'))

# ─────────────────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────────────────

LOG_DIR = os.path.join(BASE_DIR, 'logs')
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

logger = logging.getLogger('worker_tests_sistema')
logger.setLevel(logging.INFO)

_fh = logging.handlers.RotatingFileHandler(
    os.path.join(LOG_DIR, 'worker_tests_sistema.log'),
    maxBytes=5 * 1024 * 1024, backupCount=3, encoding='utf-8'
)
_fh.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s', '%Y-%m-%d %H:%M:%S'))
logger.addHandler(_fh)

_ch = logging.StreamHandler(sys.stdout)
_ch.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s', '%H:%M:%S'))
logger.addHandler(_ch)

# ─────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────

DB_CONFIG = {
    'host':     os.getenv('DB_HOST', 'localhost'),
    'database': os.getenv('DB_NAME', 'postgres'),
    'user':     os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', ''),
    'port':     os.getenv('DB_PORT', '5432'),
}
REDIS_URL       = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
REDIS_MAXMEMORY = os.getenv('REDIS_MAXMEMORY', '256mb')
SMTP_HOST       = os.getenv('SMTP_HOST', '')
SMTP_PORT       = os.getenv('SMTP_PORT', '587')
SMTP_USER       = os.getenv('SMTP_USER', '')
SMTP_PASS       = os.getenv('SMTP_PASS', '')
SMTP_FROM       = os.getenv('SMTP_FROM', '')
GCHAT_WEBHOOK   = os.getenv('GCHAT_WEBHOOK_PACIENTE_PS', '')

EMAIL_RELATORIO = 'lucas.oliveira@saofranciscodf.med.br'
INTERVALO_HORAS = 6

TABELAS_CRITICAS = [
    ('usuarios',                   'Usuários do sistema'),
    ('permissoes_paineis',         'Permissões de painéis'),
    ('historico_usuarios',         'Histórico de usuários'),
    ('notificacoes_destinatarios', 'Destinatários de notificações'),
    ('notificacoes_tipos_evento',  'Tipos de evento (Painel26)'),
    ('notificacoes_log',           'Log de notificações'),
    ('notificacoes_historico',     'Histórico de envios'),
    ('painel_ps_analise',          'Dados PS'),
    ('medicos_ps',                 'Médicos ativos no PS'),
    ('painel17_atendimentos_ps',   'Atendimentos PS painel17'),
    ('pareceres_pendentes',        'Pareceres pendentes'),
    ('sentir_agir_responsaveis',   'Responsáveis Sentir e Agir'),
    ('notificacoes_snapshot',      'Snapshot dedup notificações'),
]

VIEWS_CRITICAS = [
    ('vw_ps_dashboard_dia',          'PS dashboard dia'),
    ('vw_ps_tempo_por_clinica',      'PS tempo por clínica'),
    ('vw_ps_aguardando_por_clinica', 'PS aguardando por clínica'),
    ('vw_ps_atendimentos_por_hora',  'PS atendimentos por hora'),
    ('vw_ps_desempenho_medico',      'PS desempenho médico'),
    ('vw_ps_desempenho_recepcao',    'PS desempenho recepção'),
    ('vw_notificacoes_resumo',       'Notificações resumo'),
    ('vw_destinatarios_completo',    'Destinatários completo'),
    ('vw_notificacoes_timeline',     'Timeline de envios'),
]

TIPOS_EVENTO = [
    ('parecer_pendente',       'Pareceres Pendentes'),
    ('paciente_ps_sem_medico', 'Paciente PS Sem Médico'),
]


# ─────────────────────────────────────────────────────────
# ESTRUTURA DE RESULTADO
# ─────────────────────────────────────────────────────────

def _r(categoria, item, ok, detalhe='', reparavel=False):
    """Cria um resultado de verificação."""
    return {
        'categoria': categoria,
        'item':      item,
        'ok':        ok,
        'detalhe':   detalhe or ('OK' if ok else 'FALHOU'),
        'reparavel': reparavel and not ok,
    }


# ─────────────────────────────────────────────────────────
# VERIFICAÇÕES
# ─────────────────────────────────────────────────────────

def _verificar_postgres(resultados):
    """Testa conexão, tabelas, views e constraints críticas."""
    import psycopg2
    from psycopg2.extras import RealDictCursor

    try:
        conn = psycopg2.connect(**DB_CONFIG, connect_timeout=5)
        resultados.append(_r('infra', 'PostgreSQL conexão', True,
            '{}@{}:{}/{}'.format(DB_CONFIG['user'], DB_CONFIG['host'], DB_CONFIG['port'], DB_CONFIG['database'])))
    except Exception as e:
        resultados.append(_r('infra', 'PostgreSQL conexão', False, str(e)))
        return None

    cursor = conn.cursor(cursor_factory=RealDictCursor)

    # Tabelas
    for tabela, label in TABELAS_CRITICAS:
        try:
            cursor.execute("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_name = %s AND table_schema = 'public'
                ) AS existe
            """, (tabela,))
            existe = cursor.fetchone()['existe']
            if existe:
                cursor.execute('SELECT COUNT(*) AS total FROM {}'.format(tabela))
                total = cursor.fetchone()['total']
                resultados.append(_r('tabelas', label, True, '{} ({} linhas)'.format(tabela, total)))
            else:
                resultados.append(_r('tabelas', label, False, 'tabela {} NÃO EXISTE'.format(tabela)))
        except Exception as e:
            resultados.append(_r('tabelas', label, False, str(e)))
            conn.rollback()

    # Views
    for view, label in VIEWS_CRITICAS:
        try:
            cursor.execute('SELECT 1 FROM {} LIMIT 1'.format(view))
            cursor.fetchall()
            resultados.append(_r('views', label, True, view))
        except Exception as e:
            resultados.append(_r('views', label, False, str(e)))
            conn.rollback()

    # Constraint: topico_ntfy deve ser nullable
    try:
        cursor.execute("""
            SELECT is_nullable FROM information_schema.columns
            WHERE table_name = 'notificacoes_log' AND column_name = 'topico_ntfy'
              AND table_schema = 'public'
        """)
        row = cursor.fetchone()
        if row:
            nullable = row['is_nullable'] == 'YES'
            resultados.append(_r('constraints', 'notificacoes_log.topico_ntfy nullable', nullable,
                'correto' if nullable else 'NOT NULL — rode migration_notificacoes_log_nullable.sql',
                reparavel=True))
        else:
            resultados.append(_r('constraints', 'notificacoes_log.topico_ntfy existe', False,
                'coluna não encontrada'))
    except Exception as e:
        resultados.append(_r('constraints', 'topico_ntfy constraint', False, str(e)))
        conn.rollback()

    # Colunas criado_em
    for tabela, col in [('historico_usuarios', 'criado_em'), ('permissoes_paineis', 'criado_em')]:
        try:
            cursor.execute("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = %s AND column_name = %s AND table_schema = 'public'
                ) AS existe
            """, (tabela, col))
            existe = cursor.fetchone()['existe']
            resultados.append(_r('constraints', '{}.{} existe'.format(tabela, col), existe,
                'presente' if existe else 'AUSENTE — init_db corrigirá no próximo restart',
                reparavel=True))
        except Exception as e:
            resultados.append(_r('constraints', '{}.{}'.format(tabela, col), False, str(e)))
            conn.rollback()

    # Notificadores
    for codigo, label in TIPOS_EVENTO:
        try:
            cursor.execute("SELECT ativo FROM notificacoes_tipos_evento WHERE codigo = %s", (codigo,))
            tipo = cursor.fetchone()
            if not tipo:
                resultados.append(_r('notificadores', '{} tipo cadastrado'.format(label), False,
                    "código '{}' ausente em notificacoes_tipos_evento".format(codigo), reparavel=True))
            else:
                resultados.append(_r('notificadores', '{} tipo cadastrado'.format(label), True,
                    'ativo={}'.format(tipo['ativo'])))

            cursor.execute("""
                SELECT COUNT(*) AS qt FROM notificacoes_destinatarios
                WHERE tipo_evento = %s AND canal = 'email' AND ativo = true
            """, (codigo,))
            qt = cursor.fetchone()['qt']
            resultados.append(_r('notificadores', '{} destinatários email'.format(label), qt > 0,
                '{} destinatário(s)'.format(qt)))
        except Exception as e:
            resultados.append(_r('notificadores', label, False, str(e)))
            conn.rollback()

    # Sentir e Agir responsáveis
    try:
        cursor.execute("SELECT COUNT(*) AS qt FROM sentir_agir_responsaveis WHERE ativo = true")
        qt = cursor.fetchone()['qt']
        resultados.append(_r('notificadores', 'Sentir e Agir responsáveis', qt > 0,
            '{} responsável(is) ativo(s)'.format(qt)))
    except Exception as e:
        resultados.append(_r('notificadores', 'Sentir e Agir responsáveis', False, str(e)))
        conn.rollback()

    # Dados operacionais
    try:
        cursor.execute("""
            SELECT COUNT(*) AS qt FROM notificacoes_historico
            WHERE dt_envio::date = CURRENT_DATE AND sucesso = false
        """)
        erros_hoje = cursor.fetchone()['qt']
        resultados.append(_r('dados', 'Erros de envio hoje', erros_hoje == 0,
            '{} erro(s)'.format(erros_hoje)))
    except Exception as e:
        resultados.append(_r('dados', 'Erros de envio hoje', False, str(e)))
        conn.rollback()

    try:
        cursor.execute("""
            SELECT COUNT(*) AS qt FROM painel_ps_analise
            WHERE dt_entrada::timestamptz >= NOW() - INTERVAL '24 hours'
        """)
        qt = cursor.fetchone()['qt']
        resultados.append(_r('dados', 'Atendimentos PS 24h', qt >= 0, '{} registro(s)'.format(qt)))
    except Exception as e:
        resultados.append(_r('dados', 'Atendimentos PS 24h', False, str(e)))
        conn.rollback()

    cursor.close()
    return conn


def _verificar_redis(resultados):
    """Testa conexão Redis e configuração de memória."""
    redis_client = None
    try:
        import redis as redis_lib
        redis_client = redis_lib.Redis.from_url(REDIS_URL, socket_connect_timeout=3, decode_responses=True)
        redis_client.ping()
        info_mem = redis_client.info('memory')
        info_srv = redis_client.info('server')
        mem_mb   = round(info_mem.get('used_memory', 0) / 1024 / 1024, 1)
        peak_mb  = round(info_mem.get('used_memory_peak', 0) / 1024 / 1024, 1)
        versao   = info_srv.get('redis_version', '?')
        resultados.append(_r('infra', 'Redis conexão', True,
            'v{} | uso {}MB | pico {}MB'.format(versao, mem_mb, peak_mb)))

        max_cfg = redis_client.config_get('maxmemory')
        max_val = int(max_cfg.get('maxmemory', 0))
        if max_val == 0:
            resultados.append(_r('infra', 'Redis maxmemory', False,
                'SEM LIMITE — risco de consumo ilimitado', reparavel=True))
        else:
            resultados.append(_r('infra', 'Redis maxmemory', True,
                '{:.0f}MB configurado'.format(max_val / 1024 / 1024)))

        policy = redis_client.config_get('maxmemory-policy').get('maxmemory-policy', 'noeviction')
        ok_pol = policy in ('allkeys-lru', 'allkeys-lfu', 'volatile-lru')
        resultados.append(_r('infra', 'Redis eviction policy', ok_pol,
            policy + (' ← OK' if ok_pol else ' ← recomendado: allkeys-lru'), reparavel=not ok_pol))

        n_keys = redis_client.dbsize()
        resultados.append(_r('infra', 'Redis chaves', True, '{} chaves em cache'.format(n_keys)))

    except Exception as e:
        resultados.append(_r('infra', 'Redis conexão', False, str(e)))

    return redis_client


def _verificar_smtp(resultados):
    """Verifica se SMTP está configurado."""
    ok = bool(SMTP_HOST and SMTP_USER and SMTP_PASS)
    resultados.append(_r('infra', 'SMTP configurado', ok,
        '{}:{} ({})'.format(SMTP_HOST, SMTP_PORT, SMTP_USER) if ok else 'SMTP_HOST/USER/PASS ausentes no .env'))
    resultados.append(_r('infra', 'GChat webhook PS', bool(GCHAT_WEBHOOK),
        'configurado' if GCHAT_WEBHOOK else 'não configurado (opcional)'))


def executar_verificacoes():
    """
    Executa todas as verificações críticas do sistema.
    Retorna (resultados, conn_pg, redis_client).
    conn_pg e redis_client podem ser None se a conexão falhou.
    """
    resultados = []
    t0 = time.time()

    _verificar_smtp(resultados)
    redis_client = _verificar_redis(resultados)
    conn = _verificar_postgres(resultados)

    duracao = round(time.time() - t0, 2)
    return resultados, conn, redis_client, duracao


# ─────────────────────────────────────────────────────────
# REPAROS AUTOMÁTICOS
# ─────────────────────────────────────────────────────────

def executar_reparos(resultados, conn, redis_client):
    """
    Tenta reparar automaticamente problemas identificados.
    Retorna lista de (item, sucesso, detalhe).
    """
    reparos = []
    problemas = [r for r in resultados if not r['ok'] and r['reparavel']]

    if not problemas:
        return reparos

    # Coleta nomes dos problemas para decisão de reparo
    nomes = {p['item'] for p in problemas}

    # ── Redis: maxmemory e policy ──────────────────────────────
    if redis_client:
        if 'Redis maxmemory' in nomes:
            try:
                redis_client.config_set('maxmemory', REDIS_MAXMEMORY)
                redis_client.config_set('maxmemory-policy', 'allkeys-lru')
                reparos.append(('Redis maxmemory', True,
                    'Configurado para {} com policy allkeys-lru'.format(REDIS_MAXMEMORY)))
                logger.info('[reparo] Redis maxmemory configurado: %s allkeys-lru', REDIS_MAXMEMORY)
            except Exception as e:
                reparos.append(('Redis maxmemory', False, str(e)))

        if 'Redis eviction policy' in nomes:
            try:
                redis_client.config_set('maxmemory-policy', 'allkeys-lru')
                reparos.append(('Redis eviction policy', True, 'Definida como allkeys-lru'))
                logger.info('[reparo] Redis policy definida: allkeys-lru')
            except Exception as e:
                reparos.append(('Redis eviction policy', False, str(e)))

    # ── Banco de dados ─────────────────────────────────────────
    if conn:
        cursor = conn.cursor()

        # topico_ntfy NOT NULL
        if any('topico_ntfy' in p['item'] for p in problemas):
            try:
                cursor.execute("""
                    ALTER TABLE notificacoes_log
                    ALTER COLUMN topico_ntfy DROP NOT NULL
                """)
                conn.commit()
                reparos.append(('notificacoes_log.topico_ntfy nullable', True,
                    'Constraint NOT NULL removida com sucesso'))
                logger.info('[reparo] topico_ntfy: NOT NULL removido')
            except Exception as e:
                conn.rollback()
                reparos.append(('notificacoes_log.topico_ntfy nullable', False, str(e)))

        # criado_em ausente em historico_usuarios
        for tabela in ('historico_usuarios', 'permissoes_paineis', 'usuarios'):
            chave = '{}.criado_em existe'.format(tabela)
            if chave in nomes:
                try:
                    cursor.execute("""
                        ALTER TABLE {} ADD COLUMN IF NOT EXISTS criado_em
                        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    """.format(tabela))
                    conn.commit()
                    reparos.append((chave, True, 'Coluna criado_em adicionada em {}'.format(tabela)))
                    logger.info('[reparo] criado_em adicionada em %s', tabela)
                except Exception as e:
                    conn.rollback()
                    reparos.append((chave, False, str(e)))

        # tipo_evento paciente_ps_sem_medico ausente
        if 'Paciente PS Sem Médico tipo cadastrado' in nomes:
            try:
                cursor.execute("""
                    INSERT INTO notificacoes_tipos_evento
                        (codigo, nome, descricao, icone, cor, tabela_origem, ativo)
                    SELECT
                        'paciente_ps_sem_medico',
                        'Paciente PS Sem Médico',
                        'Alerta quando há paciente aguardando mais de 10 minutos sem médico no PS',
                        'fa-user-clock', '#dc3545', 'painel_ps_analise', true
                    WHERE NOT EXISTS (
                        SELECT 1 FROM notificacoes_tipos_evento
                        WHERE codigo = 'paciente_ps_sem_medico'
                    )
                """)
                conn.commit()
                reparos.append(('Paciente PS Sem Médico tipo cadastrado', True,
                    'Tipo de evento inserido em notificacoes_tipos_evento'))
                logger.info('[reparo] tipo_evento paciente_ps_sem_medico inserido')
            except Exception as e:
                conn.rollback()
                reparos.append(('Paciente PS Sem Médico tipo cadastrado', False, str(e)))

        # tipo_evento parecer_pendente ausente
        if 'Pareceres Pendentes tipo cadastrado' in nomes:
            try:
                cursor.execute("""
                    INSERT INTO notificacoes_tipos_evento
                        (codigo, nome, descricao, icone, cor, tabela_origem, ativo)
                    SELECT
                        'parecer_pendente', 'Parecer Pendente',
                        'Alerta de parecer médico aguardando resposta',
                        'fa-file-medical', '#0d6efd', 'pareceres_pendentes', true
                    WHERE NOT EXISTS (
                        SELECT 1 FROM notificacoes_tipos_evento WHERE codigo = 'parecer_pendente'
                    )
                """)
                conn.commit()
                reparos.append(('Pareceres Pendentes tipo cadastrado', True, 'Tipo inserido'))
                logger.info('[reparo] tipo_evento parecer_pendente inserido')
            except Exception as e:
                conn.rollback()
                reparos.append(('Pareceres Pendentes tipo cadastrado', False, str(e)))

        cursor.close()

    return reparos


# ─────────────────────────────────────────────────────────
# FORMATAÇÃO DE SAÍDA
# ─────────────────────────────────────────────────────────

def montar_saida_terminal(resultados, reparos, duracao):
    """Gera string de saída no estilo terminal para o frontend."""
    linhas = []
    agora = datetime.now().strftime('%d/%m/%Y %H:%M:%S')

    linhas.append('=' * 65)
    linhas.append('  VERIFICAÇÃO DO SISTEMA — Hospital Anchieta Ceilandia')
    linhas.append('  Executado em: {}'.format(agora))
    linhas.append('=' * 65)

    cat_atual = None
    for r in resultados:
        if r['categoria'] != cat_atual:
            cat_atual = r['categoria']
            titulos = {
                'infra':        '1. Infraestrutura',
                'tabelas':      '2. Tabelas Críticas',
                'views':        '3. Views Críticas',
                'constraints':  '4. Constraints e Colunas',
                'notificadores':'5. Notificadores',
                'dados':        '6. Dados Operacionais',
            }
            linhas.append('')
            linhas.append('─' * 65)
            linhas.append('  ' + titulos.get(cat_atual, cat_atual.upper()))
            linhas.append('─' * 65)

        icone = '[OK]  ' if r['ok'] else '[ERRO]'
        item_fmt = (r['item'] + ' ').ljust(48, '.')
        linhas.append('{} {} {}'.format(icone, item_fmt, r['detalhe']))

    if reparos:
        linhas.append('')
        linhas.append('─' * 65)
        linhas.append('  REPAROS AUTOMÁTICOS APLICADOS')
        linhas.append('─' * 65)
        for item, ok, detalhe in reparos:
            icone = '[REP] ' if ok else '[FAIL]'
            linhas.append('{} {} {}'.format(icone, (item + ' ').ljust(48, '.'), detalhe))

    total  = len(resultados)
    erros  = sum(1 for r in resultados if not r['ok'])
    ok_qt  = total - erros
    rep_ok = sum(1 for _, ok, _ in reparos if ok)

    linhas.append('')
    linhas.append('=' * 65)
    linhas.append('  RESULTADO: {} OK | {} ERRO(S) | {} REPARO(S) | {:.1f}s'.format(
        ok_qt, erros, rep_ok, duracao))
    linhas.append('=' * 65)

    return '\n'.join(linhas)


def montar_email_html(resultados, reparos, duracao):
    """Gera email HTML com o relatório completo."""
    agora    = datetime.now().strftime('%d/%m/%Y %H:%M')
    total    = len(resultados)
    erros    = sum(1 for r in resultados if not r['ok'])
    ok_qt    = total - erros
    rep_ok   = sum(1 for _, ok, _ in reparos if ok)
    cor_hdr  = '#28a745' if erros == 0 else '#dc3545'
    status   = 'SISTEMA OK' if erros == 0 else '{} PROBLEMA(S) DETECTADO(S)'.format(erros)

    linhas_resultados = ''
    for r in resultados:
        cor = '#28a745' if r['ok'] else '#dc3545'
        icone = '✓' if r['ok'] else '✗'
        bg = '#f8fff8' if r['ok'] else '#fff8f8'
        linhas_resultados += '''
        <tr style="background:{bg};">
            <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:11px;color:#666;text-transform:uppercase;">{cat}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:13px;">{item}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #eee;text-align:center;">
                <span style="color:{cor};font-weight:700;font-size:16px;">{icone}</span>
            </td>
            <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:12px;color:#555;">{detalhe}</td>
        </tr>'''.format(
            bg=bg, cat=r['categoria'], item=r['item'],
            cor=cor, icone=icone, detalhe=r['detalhe']
        )

    linhas_reparos = ''
    if reparos:
        for item, ok, detalhe in reparos:
            cor = '#28a745' if ok else '#dc3545'
            icone = '🔧' if ok else '✗'
            linhas_reparos += '''
            <tr>
                <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:13px;">{item}</td>
                <td style="padding:7px 10px;border-bottom:1px solid #eee;text-align:center;color:{cor};font-weight:700;">{icone}</td>
                <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:12px;color:#555;">{detalhe}</td>
            </tr>'''.format(item=item, cor=cor, icone=icone, detalhe=detalhe)

        secao_reparos = '''
        <div style="margin-top:20px;">
            <h3 style="font-size:14px;font-weight:600;color:#856404;margin:0 0 8px;">🔧 Reparos Automáticos Aplicados</h3>
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                    <tr style="background:#fff8e1;">
                        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#856404;text-transform:uppercase;">Item</th>
                        <th style="padding:8px 10px;text-align:center;font-size:11px;color:#856404;text-transform:uppercase;">Status</th>
                        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#856404;text-transform:uppercase;">Detalhe</th>
                    </tr>
                </thead>
                <tbody>{linhas}</tbody>
            </table>
        </div>'''.format(linhas=linhas_reparos)
    else:
        secao_reparos = ''

    proximo = (datetime.now() + timedelta(hours=INTERVALO_HORAS)).strftime('%d/%m/%Y às %H:%M')

    return '''
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:720px;margin:0 auto;padding:20px;">

    <div style="background:{cor_hdr};color:white;padding:16px 20px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:18px;">🏥 Relatório de Saúde do Sistema — HAC</h2>
        <p style="margin:6px 0 0;font-size:13px;opacity:.9;">{status} &mdash; {agora}</p>
    </div>

    <div style="border:1px solid #dee2e6;border-top:none;border-radius:0 0 8px 8px;overflow:hidden;">

        <div style="display:flex;gap:0;border-bottom:1px solid #dee2e6;">
            <div style="flex:1;padding:16px;text-align:center;background:#f8f9fa;">
                <div style="font-size:28px;font-weight:700;color:#198754;">{ok_qt}</div>
                <div style="font-size:11px;color:#6c757d;text-transform:uppercase;letter-spacing:.5px;">OK</div>
            </div>
            <div style="flex:1;padding:16px;text-align:center;background:#f8f9fa;border-left:1px solid #dee2e6;">
                <div style="font-size:28px;font-weight:700;color:{cor_erros};">{erros}</div>
                <div style="font-size:11px;color:#6c757d;text-transform:uppercase;letter-spacing:.5px;">Erros</div>
            </div>
            <div style="flex:1;padding:16px;text-align:center;background:#f8f9fa;border-left:1px solid #dee2e6;">
                <div style="font-size:28px;font-weight:700;color:#0d6efd;">{rep_ok}</div>
                <div style="font-size:11px;color:#6c757d;text-transform:uppercase;letter-spacing:.5px;">Reparados</div>
            </div>
            <div style="flex:1;padding:16px;text-align:center;background:#f8f9fa;border-left:1px solid #dee2e6;">
                <div style="font-size:28px;font-weight:700;color:#6c757d;">{duracao}s</div>
                <div style="font-size:11px;color:#6c757d;text-transform:uppercase;letter-spacing:.5px;">Duração</div>
            </div>
        </div>

        <div style="padding:16px 20px;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                    <tr style="background:#f8f9fa;">
                        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6c757d;text-transform:uppercase;letter-spacing:.5px;width:100px;">Categoria</th>
                        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6c757d;text-transform:uppercase;letter-spacing:.5px;">Verificação</th>
                        <th style="padding:8px 10px;text-align:center;font-size:11px;color:#6c757d;text-transform:uppercase;letter-spacing:.5px;width:50px;">Status</th>
                        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6c757d;text-transform:uppercase;letter-spacing:.5px;">Detalhe</th>
                    </tr>
                </thead>
                <tbody>{linhas_resultados}</tbody>
            </table>
            {secao_reparos}
        </div>

        <div style="padding:12px 20px;background:#f8f9fa;text-align:center;border-top:1px solid #dee2e6;">
            <p style="margin:0;font-size:11px;color:#999;">
                Verificação automática a cada {intervalo}h &mdash; Próxima: {proximo}<br>
                Sistema de Painéis HAC &mdash; <a href="http://172.16.1.75:5000/api/admin/tests/page" style="color:#0d6efd;">Ver painel de testes</a>
            </p>
        </div>
    </div>
</div>'''.format(
        cor_hdr=cor_hdr, status=status, agora=agora,
        ok_qt=ok_qt, erros=erros, cor_erros='#dc3545' if erros > 0 else '#198754',
        rep_ok=rep_ok, duracao=duracao,
        linhas_resultados=linhas_resultados,
        secao_reparos=secao_reparos,
        intervalo=INTERVALO_HORAS, proximo=proximo
    )


# ─────────────────────────────────────────────────────────
# ENVIO DE EMAIL
# ─────────────────────────────────────────────────────────

def enviar_relatorio(resultados, reparos, duracao):
    """Envia relatório por email para EMAIL_RELATORIO."""
    if not SMTP_HOST or not SMTP_USER or not SMTP_PASS:
        logger.warning('[tests_sistema] SMTP não configurado, relatório não enviado')
        return False

    try:
        import apprise
        from urllib.parse import quote as url_encode

        erros   = sum(1 for r in resultados if not r['ok'])
        rep_ok  = sum(1 for _, ok, _ in reparos if ok)
        status  = 'OK' if erros == 0 else '{} PROBLEMA(S)'.format(erros)
        titulo  = '[HAC Sistema] {} — Relatório Automático {}'.format(
            status, datetime.now().strftime('%d/%m/%Y %H:%M'))

        html = montar_email_html(resultados, reparos, duracao)

        ap   = apprise.Apprise()
        from_addr = SMTP_FROM or SMTP_USER
        url = 'mailtos://{user}:{pwd}@{host}:{port}?from={sender}&to={to}&name=Sistema+HAC'.format(
            user=url_encode(SMTP_USER, safe=''),
            pwd=url_encode(SMTP_PASS, safe=''),
            host=SMTP_HOST, port=SMTP_PORT,
            sender=url_encode(from_addr, safe=''),
            to=url_encode(EMAIL_RELATORIO, safe='')
        )
        ap.add(url)

        tipo_notif = apprise.NotifyType.SUCCESS if erros == 0 else apprise.NotifyType.FAILURE
        ok = ap.notify(title=titulo, body=html,
                       body_format=apprise.NotifyFormat.HTML,
                       notify_type=tipo_notif)
        if ok:
            logger.info('[tests_sistema] Relatório enviado para %s', EMAIL_RELATORIO)
        else:
            logger.warning('[tests_sistema] Falha ao enviar relatório email')
        return ok

    except Exception as e:
        logger.error('[tests_sistema] Erro ao enviar email: %s', e)
        return False


# ─────────────────────────────────────────────────────────
# CICLO PRINCIPAL
# ─────────────────────────────────────────────────────────

def executar_tudo(enviar_email=True):
    """
    Executa verificações + reparos e opcionalmente envia email.
    Retorna dict com os dados estruturados para o frontend.
    """
    logger.info('[tests_sistema] Iniciando verificação do sistema...')
    resultados, conn, redis_client, duracao = executar_verificacoes()
    reparos = executar_reparos(resultados, conn, redis_client)

    erros   = sum(1 for r in resultados if not r['ok'])
    rep_ok  = sum(1 for _, ok, _ in reparos if ok)

    logger.info('[tests_sistema] Verificação concluída: %s checks | %s erro(s) | %s reparo(s) | %.1fs',
                len(resultados), erros, rep_ok, duracao)

    if conn:
        try:
            conn.close()
        except Exception:
            pass

    if enviar_email:
        enviar_relatorio(resultados, reparos, duracao)

    saida = montar_saida_terminal(resultados, reparos, duracao)

    return {
        'output':  saida,
        'duracao': duracao,
        'report': {
            'summary': {
                'total':    len(resultados),
                'ok':       len(resultados) - erros,
                'erros':    erros,
                'reparados': rep_ok,
            },
            'duration':   duracao,
            'resultados': resultados,
            'reparos':    [{'item': i, 'ok': o, 'detalhe': d} for i, o, d in reparos],
        }
    }


def ciclo_automatico():
    """Ciclo de 6h: verifica, repara e envia email."""
    try:
        executar_tudo(enviar_email=True)
    except Exception as e:
        logger.error('[tests_sistema] Erro no ciclo automático: %s', e, exc_info=True)


# ─────────────────────────────────────────────────────────
# INTEGRAÇÃO FLASK (thread daemon)
# ─────────────────────────────────────────────────────────

_background_started = False


def start_in_background():
    """Inicia o worker de verificação como thread daemon junto com o Flask."""
    global _background_started
    if _background_started:
        return

    try:
        from werkzeug.serving import is_running_from_reloader
        if is_running_from_reloader() and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
            return
    except ImportError:
        pass

    _background_started = True

    def _run():
        import schedule as _sched
        _scheduler = _sched.Scheduler()

        logger.info('[tests_sistema] Worker iniciado — verificação a cada %sh', INTERVALO_HORAS)

        # Primeira verificação com delay (aguarda Flask subir completamente)
        time.sleep(30)
        ciclo_automatico()

        _scheduler.every(INTERVALO_HORAS).hours.do(ciclo_automatico)

        while True:
            _scheduler.run_pending()
            time.sleep(60)

    t = threading.Thread(target=_run, name='worker_tests_sistema', daemon=True)
    t.start()
    logger.info('[tests_sistema] Thread daemon registrada (ciclo a cada %sh)', INTERVALO_HORAS)


# ─────────────────────────────────────────────────────────
# MAIN (execução manual)
# ─────────────────────────────────────────────────────────

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Verificação do Sistema HAC')
    parser.add_argument('--sem-email', action='store_true', help='Não envia email com o relatório')
    args = parser.parse_args()

    dados = executar_tudo(enviar_email=not args.sem_email)
    print(dados['output'])
    erros = dados['report']['summary']['erros']
    sys.exit(1 if erros > 0 else 0)
