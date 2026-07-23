# -*- coding: utf-8 -*-
import time
import socket
import threading
from datetime import datetime
from .config import (
    logger, DB_CONFIG, REDIS_URL,
    HOP_SERVER_HOST, HOP_SERVER_PORT, HOP_FRESHNESS_AVISO_H, HOP_FRESHNESS_ERRO_H,
    CPU_AVISO, CPU_ERRO, MEM_AVISO, MEM_ERRO, DISK_AVISO, DISK_ERRO,
    DB_CONN_AVISO_PCT, DB_CONN_ERRO_PCT,
    DB_LATENCIA_AVISO_MS, DB_LATENCIA_ERRO_MS,
    DB_IDLE_TRANS_MIN, DB_QUERY_LENTA_S,
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, GCHAT_WEBHOOK,
    TABELAS_CRITICAS, VIEWS_CRITICAS, TIPOS_EVENTO, _WORKERS_ESPERADOS,
    BASE_DIR,
)


def _r(categoria, item, ok, detalhe='', reparavel=False, nivel=None):
    """Cria um resultado de verificação."""
    if nivel is None:
        nivel = 'ok' if ok else 'erro'
    return {
        'categoria': categoria,
        'item':      item,
        'ok':        ok,
        'nivel':     nivel,
        'detalhe':   detalhe or ('OK' if ok else 'FALHOU'),
        'reparavel': reparavel,
    }


def _aviso(categoria, item, detalhe='', reparavel=False):
    """Aviso: não é erro crítico mas requer atenção. ok=True, nivel='aviso'."""
    return {
        'categoria': categoria,
        'item':      item,
        'ok':        True,
        'nivel':     'aviso',
        'detalhe':   detalhe or 'Verificar',
        'reparavel': reparavel,
    }


def _verificar_servidor(resultados):
    try:
        import psutil
    except ImportError:
        resultados.append(_r('servidor', 'psutil instalado', False,
            'pip install psutil  (necessário para monitorar servidor)'))
        return

    # CPU
    try:
        cpu_pct   = psutil.cpu_percent(interval=1)
        cpu_count = psutil.cpu_count(logical=True)
        detalhe   = '{:.1f}% ({} núcleos lógicos)'.format(cpu_pct, cpu_count)
        if cpu_pct >= CPU_ERRO:
            resultados.append(_r('servidor', 'CPU', False,
                detalhe + ' — CRÍTICO (threshold: {}%)'.format(CPU_ERRO)))
        elif cpu_pct >= CPU_AVISO:
            resultados.append(_aviso('servidor', 'CPU',
                detalhe + ' — ELEVADO (threshold aviso: {}%)'.format(CPU_AVISO)))
        else:
            resultados.append(_r('servidor', 'CPU', True, detalhe))
    except Exception as e:
        resultados.append(_r('servidor', 'CPU', False, str(e)))

    # RAM
    try:
        mem         = psutil.virtual_memory()
        mem_pct     = mem.percent
        mem_livre   = round(mem.available / 1024**3, 1)
        mem_total   = round(mem.total / 1024**3, 1)
        detalhe     = '{:.1f}% usado | {:.1f} GB livres de {:.1f} GB'.format(
            mem_pct, mem_livre, mem_total)
        if mem_pct >= MEM_ERRO:
            resultados.append(_r('servidor', 'Memória RAM', False, detalhe + ' — CRÍTICO'))
        elif mem_pct >= MEM_AVISO:
            resultados.append(_aviso('servidor', 'Memória RAM', detalhe + ' — ELEVADA'))
        else:
            resultados.append(_r('servidor', 'Memória RAM', True, detalhe))
    except Exception as e:
        resultados.append(_r('servidor', 'Memória RAM', False, str(e)))

    # Disco
    try:
        disk       = psutil.disk_usage(BASE_DIR)
        disk_pct   = disk.percent
        disk_livre = round(disk.free / 1024**3, 1)
        disk_total = round(disk.total / 1024**3, 1)
        detalhe    = '{:.1f}% usado | {:.1f} GB livres de {:.1f} GB'.format(
            disk_pct, disk_livre, disk_total)
        if disk_pct >= DISK_ERRO:
            resultados.append(_r('servidor', 'Disco', False,
                detalhe + ' — CRÍTICO', reparavel=True))
        elif disk_pct >= DISK_AVISO:
            resultados.append(_aviso('servidor', 'Disco', detalhe + ' — ATENÇÃO', reparavel=True))
        else:
            resultados.append(_r('servidor', 'Disco', True, detalhe))
    except Exception as e:
        resultados.append(_r('servidor', 'Disco', False, str(e)))

    # Uptime
    try:
        boot   = datetime.fromtimestamp(psutil.boot_time())
        uptime = datetime.now() - boot
        resultados.append(_r('servidor', 'Uptime', True,
            '{} dias e {} h (ligado desde {})'.format(
                uptime.days, uptime.seconds // 3600,
                boot.strftime('%d/%m/%Y %H:%M'))))
    except Exception as e:
        resultados.append(_r('servidor', 'Uptime', False, str(e)))

    # Processos
    try:
        n_proc = sum(1 for _ in psutil.process_iter())
        resultados.append(_r('servidor', 'Processos ativos', True,
            '{} processos em execução'.format(n_proc)))
    except Exception as e:
        resultados.append(_r('servidor', 'Processos ativos', False, str(e)))


def _verificar_redis(resultados):
    """Testa conexão Redis e configuração de memória. Retorna o cliente ou None."""
    redis_client = None
    try:
        import redis as redis_lib
        redis_client = redis_lib.Redis.from_url(
            REDIS_URL, socket_connect_timeout=3, decode_responses=True)
        redis_client.ping()

        info_mem = redis_client.info('memory')
        info_srv = redis_client.info('server')
        mem_mb   = round(info_mem.get('used_memory', 0) / 1024**2, 1)
        peak_mb  = round(info_mem.get('used_memory_peak', 0) / 1024**2, 1)
        versao   = info_srv.get('redis_version', '?')
        resultados.append(_r('infra', 'Redis conexão', True,
            'v{} | uso {}MB | pico {}MB'.format(versao, mem_mb, peak_mb)))

        max_cfg = redis_client.config_get('maxmemory')
        max_val = int(max_cfg.get('maxmemory', 0))
        if max_val == 0:
            resultados.append(_r('infra', 'Redis maxmemory', False,
                'SEM LIMITE — risco de consumo ilimitado de RAM', reparavel=True))
        else:
            resultados.append(_r('infra', 'Redis maxmemory', True,
                '{:.0f} MB configurado'.format(max_val / 1024**2)))

        policy = redis_client.config_get('maxmemory-policy').get('maxmemory-policy', 'noeviction')
        ok_pol = policy in ('allkeys-lru', 'allkeys-lfu', 'volatile-lru')
        resultados.append(_r('infra', 'Redis eviction policy', ok_pol,
            policy + (' ← OK' if ok_pol else ' ← recomendado: allkeys-lru'),
            reparavel=not ok_pol))

        n_keys = redis_client.dbsize()
        resultados.append(_r('infra', 'Redis chaves', True,
            '{} chaves em cache'.format(n_keys)))

    except Exception as e:
        resultados.append(_r('infra', 'Redis conexão', False, str(e)))

    return redis_client


def _verificar_smtp(resultados):
    ok = bool(SMTP_HOST and SMTP_USER and SMTP_PASS)
    resultados.append(_r('infra', 'SMTP configurado', ok,
        '{}:{} ({})'.format(SMTP_HOST, SMTP_PORT, SMTP_USER)
        if ok else 'SMTP_HOST/USER/PASS ausentes no .env'))
    resultados.append(_r('infra', 'GChat webhook PS', bool(GCHAT_WEBHOOK),
        'configurado' if GCHAT_WEBHOOK else 'não configurado (opcional)'))


def _verificar_hop(resultados, conn):
    # Porta
    try:
        sock     = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        porta_ok = sock.connect_ex((HOP_SERVER_HOST, HOP_SERVER_PORT)) == 0
        sock.close()
        resultados.append(_r('hop', 'HOP Server porta {}:{}'.format(
                HOP_SERVER_HOST, HOP_SERVER_PORT), porta_ok,
            'respondendo' if porta_ok else
            'PORTA FECHADA — HOP Server pode estar desativado'))
    except Exception as e:
        resultados.append(_r('hop', 'HOP Server porta', False, str(e)))

    # Processo
    try:
        import psutil
        hop_proc = None
        for p in psutil.process_iter(['pid', 'name', 'cmdline', 'status']):
            try:
                nome = (p.info.get('name') or '').lower()
                cmd  = ' '.join(p.info.get('cmdline') or []).lower()
                if ('hop' in nome or
                        'hoprun' in cmd or 'hop-run' in cmd or 'hop-server' in cmd or
                        'apache-hop' in cmd or
                        ('hop' in cmd and ('java' in nome or 'java.exe' in nome))):
                    hop_proc = p
                    break
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        if hop_proc:
            resultados.append(_r('hop', 'Processo HOP', True,
                'PID {} | {} | {}'.format(hop_proc.pid, hop_proc.name(), hop_proc.status())))
        else:
            resultados.append(_r('hop', 'Processo HOP', False,
                'Nenhum processo HOP detectado (java+hop ou hop-run)'))
    except ImportError:
        resultados.append(_aviso('hop', 'Processo HOP',
            'psutil não instalado — verificação de processo ignorada'))
    except Exception as e:
        resultados.append(_r('hop', 'Processo HOP', False, str(e)))

    if conn is None:
        return

    cursor = conn.cursor()

    # Freshness: painel17_atendimentos_ps
    try:
        cursor.execute("""
            SELECT MAX(dt_entrada) AS ultima,
                   COUNT(*) FILTER (WHERE dt_entrada >= NOW() - INTERVAL '24 hours') AS hoje
            FROM painel17_atendimentos_ps
        """)
        row   = cursor.fetchone()
        ultima, hoje = row[0], row[1] or 0

        if ultima is None:
            resultados.append(_r('hop', 'ETL painel17 (PS atendimentos)', False,
                'Sem registros — tabela vazia'))
        else:
            ultima_dt = ultima.replace(tzinfo=None) if hasattr(ultima, 'tzinfo') else ultima
            diff_h    = (datetime.now() - ultima_dt).total_seconds() / 3600
            det       = 'último: {} ({:.1f}h atrás) | {} registros 24h'.format(
                ultima_dt.strftime('%d/%m %H:%M'), diff_h, hoje)
            if diff_h >= HOP_FRESHNESS_ERRO_H:
                resultados.append(_r('hop', 'ETL painel17 (PS atendimentos)', False,
                    det + ' — DADOS DESATUALIZADOS (ETL parado?)'))
            elif diff_h >= HOP_FRESHNESS_AVISO_H:
                resultados.append(_aviso('hop', 'ETL painel17 (PS atendimentos)',
                    det + ' — verificar agendamento HOP'))
            else:
                resultados.append(_r('hop', 'ETL painel17 (PS atendimentos)', True, det))
    except Exception as e:
        resultados.append(_r('hop', 'ETL painel17 (PS atendimentos)', False, str(e)))
        conn.rollback()

    # Freshness: painel_ps_analise (dt_entrada é varchar → cast)
    try:
        cursor.execute("""
            SELECT MAX(dt_entrada::timestamptz) AS ultima,
                   COUNT(*) FILTER (
                       WHERE dt_entrada::timestamptz >= NOW() - INTERVAL '24 hours'
                   ) AS hoje
            FROM painel_ps_analise
        """)
        row   = cursor.fetchone()
        ultima, hoje = row[0], row[1] or 0

        if ultima is None:
            resultados.append(_r('hop', 'ETL painel_ps_analise', False,
                'Sem registros — tabela vazia'))
        else:
            ultima_dt = ultima.replace(tzinfo=None) if hasattr(ultima, 'tzinfo') else ultima
            diff_h    = (datetime.now() - ultima_dt).total_seconds() / 3600
            det       = 'último: {} ({:.1f}h atrás) | {} registros 24h'.format(
                ultima_dt.strftime('%d/%m %H:%M'), diff_h, hoje)
            if diff_h >= HOP_FRESHNESS_ERRO_H:
                resultados.append(_r('hop', 'ETL painel_ps_analise', False,
                    det + ' — DADOS DESATUALIZADOS'))
            elif diff_h >= HOP_FRESHNESS_AVISO_H:
                resultados.append(_aviso('hop', 'ETL painel_ps_analise',
                    det + ' — verificar agendamento HOP'))
            else:
                resultados.append(_r('hop', 'ETL painel_ps_analise', True, det))
    except Exception as e:
        resultados.append(_r('hop', 'ETL painel_ps_analise', False, str(e)))
        conn.rollback()

    # medicos_ps populada
    try:
        cursor.execute("SELECT COUNT(*) AS qt FROM medicos_ps")
        qt = cursor.fetchone()[0]
        resultados.append(_r('hop', 'medicos_ps populada', qt > 0,
            '{} médico(s) registrado(s)'.format(qt)))
    except Exception as e:
        resultados.append(_r('hop', 'medicos_ps populada', False, str(e)))
        conn.rollback()

    cursor.close()


def _verificar_postgres(resultados):
    """Testa conexão, tabelas, views, constraints e dados críticos. Retorna conn ou None."""
    import psycopg2
    from psycopg2.extras import RealDictCursor

    try:
        conn = psycopg2.connect(**DB_CONFIG, connect_timeout=5)
        resultados.append(_r('infra', 'PostgreSQL conexão', True,
            '{}@{}:{}/{}'.format(
                DB_CONFIG['user'], DB_CONFIG['host'],
                DB_CONFIG['port'], DB_CONFIG['database'])))
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
                resultados.append(_r('tabelas', label, True,
                    '{} ({} linhas)'.format(tabela, total)))
            else:
                resultados.append(_r('tabelas', label, False,
                    'tabela {} NÃO EXISTE'.format(tabela)))
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
                'OK' if nullable else 'NOT NULL — rode migration_notificacoes_log_nullable.sql',
                reparavel=not nullable))
        else:
            resultados.append(_r('constraints', 'notificacoes_log.topico_ntfy', False,
                'Coluna não encontrada'))
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
            resultados.append(_r('constraints', '{}.{} presente'.format(tabela, col), existe,
                'presente' if existe else 'AUSENTE — init_db corrigirá no próximo restart',
                reparavel=not existe))
        except Exception as e:
            resultados.append(_r('constraints', '{}.{}'.format(tabela, col), False, str(e)))
            conn.rollback()

    # Notificadores: tipos_evento e destinatários
    for codigo, label in TIPOS_EVENTO:
        try:
            cursor.execute(
                "SELECT ativo FROM notificacoes_tipos_evento WHERE codigo = %s", (codigo,))
            tipo = cursor.fetchone()
            if not tipo:
                resultados.append(_r('notificadores', '{} tipo cadastrado'.format(label), False,
                    "código '{}' ausente".format(codigo), reparavel=True))
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
        resultados.append(_r('dados', 'Atendimentos PS 24h', qt >= 0,
            '{} registro(s)'.format(qt)))
    except Exception as e:
        resultados.append(_r('dados', 'Atendimentos PS 24h', False, str(e)))
        conn.rollback()

    cursor.close()
    return conn


def _verificar_postgres_saude(resultados, conn):
    if conn is None:
        return

    from psycopg2.extras import RealDictCursor
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    # Latência
    try:
        t0 = time.time()
        cursor.execute("SELECT 1 AS x")
        cursor.fetchone()
        lat_ms = round((time.time() - t0) * 1000, 1)
        if lat_ms >= DB_LATENCIA_ERRO_MS:
            resultados.append(_r('pg_saude', 'PostgreSQL latência', False,
                '{:.1f}ms — BANCO MUITO LENTO (limite: {}ms)'.format(lat_ms, DB_LATENCIA_ERRO_MS)))
        elif lat_ms >= DB_LATENCIA_AVISO_MS:
            resultados.append(_aviso('pg_saude', 'PostgreSQL latência',
                '{:.1f}ms — lento (aviso: {}ms)'.format(lat_ms, DB_LATENCIA_AVISO_MS)))
        else:
            resultados.append(_r('pg_saude', 'PostgreSQL latência', True, '{:.1f}ms'.format(lat_ms)))
    except Exception as e:
        resultados.append(_r('pg_saude', 'PostgreSQL latência', False, str(e)))
        conn.rollback()

    # Conexões
    try:
        cursor.execute("""
            SELECT
                COUNT(*) FILTER (WHERE state IS NOT NULL) AS ativas,
                COUNT(*) FILTER (WHERE state = 'active') AS executando,
                COUNT(*) FILTER (WHERE state = 'idle in transaction') AS idle_trans,
                COUNT(*) FILTER (WHERE state = 'idle') AS idle,
                (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn
            FROM pg_stat_activity
            WHERE datname = current_database()
        """)
        row        = cursor.fetchone()
        ativas     = row['ativas']    or 0
        executando = row['executando'] or 0
        idle_trans = row['idle_trans'] or 0
        max_conn   = row['max_conn']  or 100
        pct        = round(ativas / max_conn * 100, 1)
        det = '{}/{} conexões ({:.1f}%) | {} executando | {} idle | {} idle-in-trans'.format(
            ativas, max_conn, pct, executando, row['idle'] or 0, idle_trans)
        if pct >= DB_CONN_ERRO_PCT:
            resultados.append(_r('pg_saude', 'PostgreSQL conexões', False, det + ' — CRÍTICO'))
        elif pct >= DB_CONN_AVISO_PCT:
            resultados.append(_aviso('pg_saude', 'PostgreSQL conexões', det))
        else:
            resultados.append(_r('pg_saude', 'PostgreSQL conexões', True, det))
    except Exception as e:
        resultados.append(_r('pg_saude', 'PostgreSQL conexões', False, str(e)))
        conn.rollback()

    # Idle in transaction por muito tempo
    try:
        cursor.execute("""
            SELECT pid, usename,
                   ROUND(EXTRACT(EPOCH FROM (NOW() - xact_start)) / 60) AS minutos,
                   LEFT(query, 100) AS query_trunc
            FROM pg_stat_activity
            WHERE state = 'idle in transaction'
              AND xact_start IS NOT NULL
              AND EXTRACT(EPOCH FROM (NOW() - xact_start)) / 60 > %s
            ORDER BY minutos DESC LIMIT 5
        """, (DB_IDLE_TRANS_MIN,))
        idle_probs = cursor.fetchall()
        if idle_probs:
            info = '; '.join('PID {} ({}min)'.format(r['pid'], r['minutos'])
                             for r in idle_probs)
            resultados.append(_r('pg_saude', 'Idle in transaction', False,
                '{} sessão(ões) travada(s) > {}min: {}'.format(
                    len(idle_probs), DB_IDLE_TRANS_MIN, info),
                reparavel=True))
        else:
            resultados.append(_r('pg_saude', 'Idle in transaction', True,
                'Nenhuma sessão travada > {}min'.format(DB_IDLE_TRANS_MIN)))
    except Exception as e:
        resultados.append(_r('pg_saude', 'Idle in transaction', False, str(e)))
        conn.rollback()

    # Queries lentas em execução agora
    try:
        cursor.execute("""
            SELECT pid, usename,
                   ROUND(EXTRACT(EPOCH FROM (NOW() - query_start))) AS segundos,
                   LEFT(query, 100) AS query_trunc
            FROM pg_stat_activity
            WHERE state = 'active'
              AND query_start IS NOT NULL
              AND query NOT LIKE '%%pg_stat_activity%%'
              AND EXTRACT(EPOCH FROM (NOW() - query_start)) > %s
            ORDER BY segundos DESC LIMIT 5
        """, (DB_QUERY_LENTA_S,))
        lentas = cursor.fetchall()
        if lentas:
            info = '; '.join('PID {} ({}s)'.format(r['pid'], r['segundos']) for r in lentas)
            resultados.append(_r('pg_saude', 'Queries lentas', False,
                '{} query(ies) > {}s: {}'.format(len(lentas), DB_QUERY_LENTA_S, info)))
        else:
            resultados.append(_r('pg_saude', 'Queries lentas', True,
                'Nenhuma query > {}s em execução'.format(DB_QUERY_LENTA_S)))
    except Exception as e:
        resultados.append(_r('pg_saude', 'Queries lentas', False, str(e)))
        conn.rollback()

    # Deadlocks
    try:
        cursor.execute("""
            SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()
        """)
        row       = cursor.fetchone()
        deadlocks = row['deadlocks'] if row else 0
        if deadlocks > 0:
            resultados.append(_aviso('pg_saude', 'Deadlocks acumulados',
                '{} deadlock(s) desde o último reset de estatísticas'.format(deadlocks)))
        else:
            resultados.append(_r('pg_saude', 'Deadlocks acumulados', True, 'Nenhum deadlock'))
    except Exception as e:
        resultados.append(_r('pg_saude', 'Deadlocks acumulados', False, str(e)))
        conn.rollback()

    # Bloqueios ativos
    try:
        cursor.execute("""
            SELECT COUNT(*) AS n_bloqueios
            FROM pg_locks l
            JOIN pg_stat_activity a ON l.pid = a.pid
            WHERE NOT l.granted AND a.wait_event_type = 'Lock'
        """)
        row     = cursor.fetchone()
        n_locks = row['n_bloqueios'] if row else 0
        if n_locks > 0:
            resultados.append(_r('pg_saude', 'Bloqueios (locks) ativos', False,
                '{} processo(s) aguardando liberação de lock'.format(n_locks)))
        else:
            resultados.append(_r('pg_saude', 'Bloqueios (locks) ativos', True,
                'Nenhum bloqueio ativo'))
    except Exception as e:
        resultados.append(_r('pg_saude', 'Bloqueios (locks)', False, str(e)))
        conn.rollback()

    # Tamanho do banco
    try:
        cursor.execute("""
            SELECT pg_size_pretty(pg_database_size(current_database())) AS tam,
                   pg_database_size(current_database()) AS bytes
        """)
        row    = cursor.fetchone()
        tam_gb = round(row['bytes'] / 1024**3, 2)
        resultados.append(_r('pg_saude', 'Tamanho do banco', True,
            '{} ({:.2f} GB)'.format(row['tam'], tam_gb)))
    except Exception as e:
        resultados.append(_r('pg_saude', 'Tamanho do banco', False, str(e)))
        conn.rollback()

    cursor.close()


def _verificar_workers_flask(resultados):
    threads_ativas = {t.name: t for t in threading.enumerate()}
    for nome, label in _WORKERS_ESPERADOS:
        encontradas = [n for n in threads_ativas if nome in n]
        resultados.append(_r('workers', label, bool(encontradas),
            'thread ativa: {}'.format(encontradas[0]) if encontradas
            else 'thread NÃO encontrada — worker pode ter falhado'))


def executar_verificacoes():
    """
    Executa todas as verificações críticas.
    Retorna (resultados, conn_pg, redis_client, duracao_s).
    """
    resultados = []
    t0 = time.time()

    _verificar_servidor(resultados)
    _verificar_smtp(resultados)
    redis_client = _verificar_redis(resultados)
    conn = _verificar_postgres(resultados)
    _verificar_postgres_saude(resultados, conn)
    _verificar_hop(resultados, conn)
    _verificar_workers_flask(resultados)

    duracao = round(time.time() - t0, 2)
    return resultados, conn, redis_client, duracao
