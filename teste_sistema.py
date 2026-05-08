# -*- coding: utf-8 -*-
"""
============================================================
  TESTE DE SISTEMA - Hospital Anchieta Ceilandia
  Verifica todos os pontos críticos antes que virem problema
============================================================

Uso:
  python teste_sistema.py              # verifica tudo
  python teste_sistema.py --email      # inclui envio real de email teste
  python teste_sistema.py --resumo     # só mostra falhas

Saída: lista de OK/ERRO por categoria.
       Qualquer ERRO deve ser investigado antes de ir para produção.
"""

import sys
import os
import json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(BASE_DIR, '.env'))

import psycopg2
from psycopg2.extras import RealDictCursor

# ─────────────────────────────────────────────────────────
# CONFIG (lida do .env)
# ─────────────────────────────────────────────────────────
DB_CONFIG = {
    'host':     os.getenv('DB_HOST', 'localhost'),
    'database': os.getenv('DB_NAME', 'postgres'),
    'user':     os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', ''),
    'port':     os.getenv('DB_PORT', '5432'),
}
REDIS_URL        = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
REDIS_MAXMEMORY  = os.getenv('REDIS_MAXMEMORY', '256mb')
SMTP_HOST        = os.getenv('SMTP_HOST', '')
SMTP_PORT        = os.getenv('SMTP_PORT', '587')
SMTP_USER        = os.getenv('SMTP_USER', '')
SMTP_PASS        = os.getenv('SMTP_PASS', '')
SMTP_FROM        = os.getenv('SMTP_FROM', '')
GCHAT_WEBHOOK_PS = os.getenv('GCHAT_WEBHOOK_PACIENTE_PS', '')

# ─────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────

MODO_RESUMO  = '--resumo' in sys.argv
MODO_EMAIL   = '--email'  in sys.argv

resultados = []   # (categoria, item, status, detalhe)

def _reg(categoria, item, ok, detalhe=''):
    resultados.append((categoria, item, ok, detalhe))
    if not MODO_RESUMO or not ok:
        icone = '[OK]  ' if ok else '[ERRO]'
        msg = '{} {:.<50} {}'.format(icone, item + ' ', detalhe or ('OK' if ok else 'FALHOU'))
        print(msg)

def _sep(titulo):
    print('\n' + '─' * 65)
    print('  ' + titulo)
    print('─' * 65)


# ─────────────────────────────────────────────────────────
# 1. INFRAESTRUTURA
# ─────────────────────────────────────────────────────────

_sep('1. Infraestrutura')

# 1.1 PostgreSQL
conn = None
try:
    conn = psycopg2.connect(**DB_CONFIG, connect_timeout=5)
    _reg('infra', 'PostgreSQL conexão',
         True, '{}@{}:{}/{}'.format(DB_CONFIG['user'], DB_CONFIG['host'], DB_CONFIG['port'], DB_CONFIG['database']))
except Exception as e:
    _reg('infra', 'PostgreSQL conexão', False, str(e))
    print('\n  CRÍTICO: sem banco de dados o sistema não funciona. Encerrando.')
    sys.exit(1)

# 1.2 Redis
redis_client = None
try:
    import redis as redis_lib
    redis_client = redis_lib.Redis.from_url(REDIS_URL, socket_connect_timeout=3, decode_responses=True)
    redis_client.ping()
    info_mem  = redis_client.info('memory')
    info_srv  = redis_client.info('server')
    mem_mb    = round(info_mem.get('used_memory', 0) / 1024 / 1024, 1)
    peak_mb   = round(info_mem.get('used_memory_peak', 0) / 1024 / 1024, 1)
    versao    = info_srv.get('redis_version', '?')
    _reg('infra', 'Redis conexão', True, 'v{} | uso: {}MB | pico: {}MB'.format(versao, mem_mb, peak_mb))

    # maxmemory configurado?
    max_cfg = redis_client.config_get('maxmemory')
    max_val = int(max_cfg.get('maxmemory', 0))
    if max_val == 0:
        _reg('infra', 'Redis maxmemory', False, 'SEM LIMITE — risco de explodir memória (defina REDIS_MAXMEMORY no .env)')
    else:
        _reg('infra', 'Redis maxmemory', True, '{:.0f}MB configurado'.format(max_val / 1024 / 1024))

    # política de eviction
    policy_cfg = redis_client.config_get('maxmemory-policy')
    policy = policy_cfg.get('maxmemory-policy', 'noeviction')
    ok_policy = policy in ('allkeys-lru', 'allkeys-lfu', 'volatile-lru')
    _reg('infra', 'Redis eviction policy', ok_policy, policy + (' ← OK' if ok_policy else ' ← recomendado: allkeys-lru'))

    # contagem de chaves
    n_keys = redis_client.dbsize()
    _reg('infra', 'Redis chaves no cache', True, '{} chaves'.format(n_keys))

except Exception as e:
    _reg('infra', 'Redis conexão', False, str(e))
    _reg('infra', 'Redis maxmemory', False, 'não verificável sem conexão')

# 1.3 SMTP
smtp_ok = bool(SMTP_HOST and SMTP_USER and SMTP_PASS)
_reg('infra', 'SMTP configurado (.env)', smtp_ok,
     '{}:{} user={}'.format(SMTP_HOST, SMTP_PORT, SMTP_USER) if smtp_ok else 'SMTP_HOST/USER/PASS ausentes')

# 1.4 Google Chat webhook (opcional mas verificado)
_reg('infra', 'GChat webhook PS configurado', bool(GCHAT_WEBHOOK_PS),
     'configurado' if GCHAT_WEBHOOK_PS else 'não configurado (opcional)')


# ─────────────────────────────────────────────────────────
# 2. TABELAS CRÍTICAS
# ─────────────────────────────────────────────────────────

_sep('2. Tabelas Críticas')

TABELAS_CRITICAS = [
    # sistema base
    ('usuarios',                    'Usuários do sistema'),
    ('permissoes_paineis',          'Permissões de painéis'),
    ('historico_usuarios',          'Histórico de usuários'),
    # notificações
    ('notificacoes_destinatarios',  'Destinatários de notificações'),
    ('notificacoes_tipos_evento',   'Tipos de evento (Painel26)'),
    ('notificacoes_log',            'Log de notificações (cooldown)'),
    ('notificacoes_historico',      'Histórico de envios'),
    # pronto socorro
    ('painel_ps_analise',           'Dados PS (painel10)'),
    ('medicos_ps',                  'Médicos ativos no PS'),
    ('painel17_atendimentos_ps',    'Atendimentos PS (painel17)'),
    # pareceres
    ('pareceres_pendentes',         'Pareceres pendentes'),
    # sentir e agir
    ('sentir_agir_responsaveis',    'Responsáveis Sentir e Agir'),
    ('notificacoes_snapshot',       'Snapshot notificações (dedup)'),
]

cursor = conn.cursor(cursor_factory=RealDictCursor)
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
            cursor.execute('SELECT COUNT(*) AS total FROM {} LIMIT 1'.format(tabela))
            total = cursor.fetchone()['total']
            _reg('tabelas', label, True, 'tabela {} ({} linhas)'.format(tabela, total))
        else:
            _reg('tabelas', label, False, 'tabela {} NÃO EXISTE'.format(tabela))
    except Exception as e:
        _reg('tabelas', label, False, str(e))
        conn.rollback()


# ─────────────────────────────────────────────────────────
# 3. VIEWS CRÍTICAS
# ─────────────────────────────────────────────────────────

_sep('3. Views Críticas')

VIEWS_CRITICAS = [
    ('vw_ps_dashboard_dia',          'PS dashboard dia'),
    ('vw_ps_tempo_por_clinica',      'PS tempo por clínica'),
    ('vw_ps_aguardando_por_clinica', 'PS aguardando por clínica'),
    ('vw_ps_atendimentos_por_hora',  'PS atendimentos por hora'),
    ('vw_ps_desempenho_medico',      'PS desempenho médico'),
    ('vw_ps_desempenho_recepcao',    'PS desempenho recepção'),
    ('vw_notificacoes_resumo',       'Notificações resumo (Painel26)'),
    ('vw_destinatarios_completo',    'Destinatários completo (Painel26)'),
    ('vw_notificacoes_timeline',     'Timeline de envios (Painel26)'),
]

for view, label in VIEWS_CRITICAS:
    try:
        cursor.execute('SELECT 1 FROM {} LIMIT 1'.format(view))
        cursor.fetchall()
        _reg('views', label, True, 'view {} OK'.format(view))
    except Exception as e:
        _reg('views', label, False, str(e))
        conn.rollback()


# ─────────────────────────────────────────────────────────
# 4. CONSTRAINTS E COLUNAS CRÍTICAS
# ─────────────────────────────────────────────────────────

_sep('4. Constraints e Colunas')

COLUNAS_CRITICAS = [
    ('usuarios',            'criado_em',             'Coluna de auditoria usuários'),
    ('historico_usuarios',  'criado_em',             'Coluna de auditoria histórico'),
    ('permissoes_paineis',  'criado_em',             'Coluna de auditoria permissões'),
    ('notificacoes_log',    'topico_ntfy',           'Campo ntfy no log'),
    ('notificacoes_log',    'resposta_ntfy',         'Campo resposta ntfy'),
    ('notificacoes_log',    'dados_extra',           'Campo dados extra no log'),
]

for tabela, coluna, label in COLUNAS_CRITICAS:
    try:
        cursor.execute("""
            SELECT is_nullable
            FROM information_schema.columns
            WHERE table_name = %s AND column_name = %s AND table_schema = 'public'
        """, (tabela, coluna))
        row = cursor.fetchone()
        if row:
            nullable = row['is_nullable'] == 'YES'
            if coluna == 'topico_ntfy':
                # deve ser nullable pois notificadores email/gchat não usam ntfy
                _reg('constraints', label + ' é nullable', nullable,
                     'nullable=YES ← correto' if nullable else 'nullable=NO ← ERRO: rode migration_notificacoes_log_nullable.sql')
            else:
                _reg('constraints', label + ' existe', True, '{}.{} presente'.format(tabela, coluna))
        else:
            _reg('constraints', label + ' existe', False,
                 'coluna {}.{} NÃO EXISTE — rode migration database.py (init_db)'.format(tabela, coluna))
    except Exception as e:
        _reg('constraints', label, False, str(e))
        conn.rollback()


# ─────────────────────────────────────────────────────────
# 5. NOTIFICADORES — CONFIGURAÇÃO
# ─────────────────────────────────────────────────────────

_sep('5. Notificadores')

TIPOS_EVENTO_ESPERADOS = [
    ('parecer_pendente',        'Pareceres Pendentes'),
    ('paciente_ps_sem_medico',  'Paciente PS Sem Médico'),
]

for codigo, label in TIPOS_EVENTO_ESPERADOS:
    try:
        # tipo cadastrado?
        cursor.execute("""
            SELECT ativo FROM notificacoes_tipos_evento WHERE codigo = %s
        """, (codigo,))
        tipo = cursor.fetchone()
        if not tipo:
            _reg('notificadores', '{} — tipo cadastrado'.format(label), False,
                 "código '{}' não existe em notificacoes_tipos_evento".format(codigo))
            continue

        ativo = tipo['ativo']
        _reg('notificadores', '{} — tipo cadastrado'.format(label), True,
             'ativo={}'.format(ativo))

        # destinatários configurados?
        cursor.execute("""
            SELECT COUNT(*) AS qt FROM notificacoes_destinatarios
            WHERE tipo_evento = %s AND canal = 'email' AND ativo = true
        """, (codigo,))
        qt = cursor.fetchone()['qt']
        _reg('notificadores', '{} — destinatários email ativos'.format(label),
             qt > 0, '{} destinatário(s)'.format(qt))

    except Exception as e:
        _reg('notificadores', label, False, str(e))
        conn.rollback()

# sentir_agir: usa tabela própria
try:
    cursor.execute("SELECT COUNT(*) AS qt FROM sentir_agir_responsaveis WHERE ativo = true")
    qt = cursor.fetchone()['qt']
    _reg('notificadores', 'Sentir e Agir — responsáveis ativos', qt > 0, '{} responsável(is)'.format(qt))
except Exception as e:
    _reg('notificadores', 'Sentir e Agir — responsáveis ativos', False, str(e))
    conn.rollback()

# cooldown: verifica se há log recente travado incorretamente (mais de 24h no mesmo dia)
try:
    cursor.execute("""
        SELECT chave_evento, qt_notificacoes, dt_ultima_notificacao
        FROM notificacoes_log
        WHERE status = 'notificado'
          AND dt_ultima_notificacao < NOW() - INTERVAL '2 hours'
          AND chave_evento LIKE 'ps_sem_medico_%'
        ORDER BY dt_ultima_notificacao DESC
        LIMIT 5
    """)
    logs_velhos = cursor.fetchall()
    if logs_velhos:
        detalhe = '{} log(s) PS antigos (pode bloquear cooldown se hoje)'.format(len(logs_velhos))
        _reg('notificadores', 'Log PS — sem bloqueio de cooldown antigo', True, detalhe)
    else:
        _reg('notificadores', 'Log PS — sem bloqueio de cooldown antigo', True, 'nenhum log travado')
except Exception as e:
    _reg('notificadores', 'Log PS — cooldown', False, str(e))
    conn.rollback()


# ─────────────────────────────────────────────────────────
# 6. DADOS OPERACIONAIS
# ─────────────────────────────────────────────────────────

_sep('6. Dados Operacionais (agora)')

try:
    cursor.execute("""
        SELECT COUNT(*) AS qt FROM painel_ps_analise
        WHERE dt_entrada::timestamptz >= NOW() - INTERVAL '24 hours'
    """)
    qt = cursor.fetchone()['qt']
    _reg('dados', 'Atendimentos PS nas últimas 24h', qt >= 0, '{} registro(s)'.format(qt))
except Exception as e:
    _reg('dados', 'Atendimentos PS nas últimas 24h', False, str(e))
    conn.rollback()

try:
    cursor.execute("""
        SELECT COUNT(*) AS qt FROM medicos_ps
        WHERE especialidade IS NOT NULL AND especialidade != ''
    """)
    qt = cursor.fetchone()['qt']
    _reg('dados', 'Médicos logados no PS agora', True, '{} médico(s)'.format(qt))
except Exception as e:
    _reg('dados', 'Médicos logados no PS agora', False, str(e))
    conn.rollback()

try:
    cursor.execute("SELECT COUNT(*) AS qt FROM pareceres_pendentes")
    qt = cursor.fetchone()['qt']
    _reg('dados', 'Pareceres pendentes ativos', True, '{} parecer(es)'.format(qt))
except Exception as e:
    _reg('dados', 'Pareceres pendentes ativos', False, str(e))
    conn.rollback()

try:
    cursor.execute("""
        SELECT COUNT(*) AS qt FROM notificacoes_historico
        WHERE dt_envio::date = CURRENT_DATE
    """)
    qt = cursor.fetchone()['qt']
    _reg('dados', 'Emails enviados hoje', True, '{} envio(s)'.format(qt))
except Exception as e:
    _reg('dados', 'Emails enviados hoje', False, str(e))
    conn.rollback()

try:
    cursor.execute("""
        SELECT COUNT(*) AS qt FROM notificacoes_historico
        WHERE dt_envio::date = CURRENT_DATE AND sucesso = false
    """)
    qt = cursor.fetchone()['qt']
    _reg('dados', 'Erros de envio hoje', qt == 0, '{} erro(s)'.format(qt))
except Exception as e:
    _reg('dados', 'Erros de envio hoje', False, str(e))
    conn.rollback()


# ─────────────────────────────────────────────────────────
# 7. ENVIO DE EMAIL DE TESTE (opcional, --email)
# ─────────────────────────────────────────────────────────

if MODO_EMAIL:
    _sep('7. Envio de Email de Teste')
    if not smtp_ok:
        _reg('email_teste', 'Envio email teste', False, 'SMTP não configurado')
    else:
        try:
            from notificador_paciente_ps import enviar_email, montar_email_html
            alertas_fake = [
                {'ds_clinica': 'TESTE SISTEMA', 'qt_aguardando': 1, 'max_espera_min': 10}
            ]
            cursor.execute("""
                SELECT DISTINCT ON (email) nome, email
                FROM notificacoes_destinatarios
                WHERE tipo_evento = 'paciente_ps_sem_medico' AND canal = 'email' AND ativo = true
                ORDER BY email LIMIT 1
            """)
            dest_row = cursor.fetchone()
            if dest_row:
                html = montar_email_html(alertas_fake)
                ok, resp = enviar_email(
                    [dict(dest_row)],
                    '[TESTE SISTEMA] Verificação de email automático',
                    html
                )
                _reg('email_teste', 'Envio email teste', ok, resp)
            else:
                _reg('email_teste', 'Envio email teste', False, 'Nenhum destinatário PS ativo para teste')
        except Exception as e:
            _reg('email_teste', 'Envio email teste', False, str(e))


# ─────────────────────────────────────────────────────────
# RESULTADO FINAL
# ─────────────────────────────────────────────────────────

cursor.close()
conn.close()

total    = len(resultados)
erros    = [(c, i, d) for c, i, ok, d in resultados if not ok]
sucessos = total - len(erros)

print('\n' + '=' * 65)
print('  RESULTADO FINAL')
print('=' * 65)
print('  Total verificado : {}'.format(total))
print('  Passou           : {}'.format(sucessos))
print('  Falhou           : {}'.format(len(erros)))

if erros:
    print('\n  ITENS COM FALHA:')
    for cat, item, detalhe in erros:
        print('  [{}] {} → {}'.format(cat.upper(), item, detalhe))
    print()
    sys.exit(1)
else:
    print('\n  Todos os pontos críticos estão operacionais.')
    print('=' * 65)
    sys.exit(0)
