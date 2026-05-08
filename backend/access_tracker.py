# -*- coding: utf-8 -*-
"""
Rastreamento de acessos — Hospital Anchieta Ceilandia.

Responsabilidades:
  1. Sessões em memória  — quem está conectado agora (última atividade < 10 min)
  2. Log no banco        — histórico auditável de 6 meses (throttled, não sobrecarrega)
  3. Middleware Flask    — before_request (mede tempo) + after_request (registra)
  4. Resolução lazy de hostname — DNS com cache 24h e timeout de 1,5s por IP

Princípio: não atrasar NENHUMA requisição. Escritas no banco são
assíncronas (thread daemon). Resolução DNS só ocorre na consulta admin.
"""

import re
import time
import socket
import threading
import logging
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, wait as futures_wait

from flask import request as flask_request, session as flask_session, g

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────
# MAPEAMENTO PAINÉIS → NOME LEGÍVEL
# ─────────────────────────────────────────────────────────

PAINEIS_NOMES = {
    'painel2':  'Evolução de Turno',
    'painel3':  'Médicos PS',
    'painel4':  'Ocupação Hospitalar',
    'painel5':  'Cirurgias do Dia',
    'painel6':  'Priorização Clínica',
    'painel7':  'Análise de Risco Sepse',
    'painel8':  'Situação dos Pacientes / Enfermaria',
    'painel9':  'Laboratório Pendente',
    'painel10': 'Análise PS — Pronto-Socorro',
    'painel11': 'Internação PS',
    'painel12': 'Painel Gerencial',
    'painel13': 'Mapa de Nutrição',
    'painel14': 'Central de Chamados TI',
    'painel15': 'Gatilho de Chamados TI',
    'painel16': 'Desempenho da Recepção',
    'painel17': 'Tempo de Espera PS',
    'painel18': 'Desempenho Médico PS',
    'painel19': 'Pendências de Radiologia',
    'painel20': 'Radiologia no PS',
    'painel21': 'Status de Contas',
    'painel22': 'Exames Pendentes PS',
    'painel23': 'Informações do Ambulatório',
    'painel24': 'Estoque do Dia',
    'painel25': 'Exames por Médico PS',
    'painel26': 'Central de Notificações',
    'painel27': 'Deteriorização de Pacientes',
    'painel28': 'Hub de Serviços',
    'painel29': 'Gestão Sentir e Agir',
    'painel30': 'Central de Tratativas',
    'painel31': 'Hub de Machine Learning',
    'painel32': 'Análise Diária Sentir e Agir',
    'painel33': 'Autorizações de Convênio',
    'painel34': 'Solicitação de Padioleiro',
    'painel35': 'Tela do Padioleiro',
    'painel36': 'Gestão e Relatórios Padioleiro',
    'painel37': 'Plano Terapêutico',
    'painel38': 'Score Farmacêutico',
    'painel39': 'Interações Medicamentosas',
    'painel40': 'Requisições Urgentes',
}

# Descrição humanizada de sub-endpoints
_SUB_DESCRICOES = {
    'dashboard':              'visualizou o dashboard',
    'lista':                  'consultou a lista de registros',
    'dados':                  'carregou dados em tempo real',
    'medicos':                'consultou lista de médicos',
    'enfermaria':             'visualizou situação da enfermaria',
    'evolucoes':              'consultou evoluções de turno',
    'clinicas-consolidado':   'carregou dados consolidados por clínica',
    'desempenho-medico':      'consultou desempenho médico',
    'desempenho-recepcao':    'consultou desempenho da recepção',
    'atendimentos-hora':      'carregou atendimentos por hora',
    'pacientes-clinica':      'visualizou pacientes por clínica',
    'stats':                  'carregou estatísticas',
    'nutricao':               'consultou mapa de nutrição',
    'lab':                    'consultou exames de laboratório',
    'index':                  'acessou o hub de serviços',
    'graficos':               'visualizou gráficos',
    'tipos':                  'consultou tipos de evento',
    'destinatarios':          'consultou destinatários de notificação',
    'historico':              'consultou histórico de envios',
    'especialidades':         'consultou especialidades',
    'responsaveis':           'consultou responsáveis',
    'analise':                'executou análise de dados',
}


# ─────────────────────────────────────────────────────────
# ESTADO EM MEMÓRIA (thread-safe)
# ─────────────────────────────────────────────────────────

_sessions: dict        = {}   # {ip: session_dict}
_sessions_lock         = threading.Lock()

_throttle: dict        = {}   # {(ip, chave): last_write_timestamp}
_throttle_lock         = threading.Lock()

_hostname_cache: dict  = {}   # {ip: (hostname, cached_at)}
_hostname_cache_lock   = threading.Lock()

THROTTLE_SEGUNDOS    = 600    # só regrava mesma IP+painel a cada 10 min
ATIVO_SEGUNDOS       = 120    # < 2 min = ativo (verde)
RECENTE_SEGUNDOS     = 600    # < 10 min = recente (amarelo)
HOSTNAME_CACHE_TTL   = 86400  # 24h

# Pool de threads para escritas assíncronas no banco
# (substitui criação de thread por requisição — limita a 2 threads concorrentes)
_write_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix='access_w')

# Paths completamente ignorados
_IGNORAR = (
    '/static/', '/manifest.json', '/sw.js', '/favicon',
    '/apple-touch-icon', '/api/health', '/api/admin/acessos',
    '.css', '.js', '.png', '.ico', '.woff', '.woff2',
)

_PAINEL_RE = re.compile(r'/(painel\d+)(?:/|$|\?)')


# ─────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────

def _extrair_painel(path: str):
    m = _PAINEL_RE.search(path)
    return m.group(1) if m else None


def _descrever(path: str, painel_codigo, status_code) -> str:
    """Gera descrição em linguagem simples para auditoria."""
    if status_code and status_code >= 500:
        return 'Erro interno no servidor — verifique os logs do sistema'
    if status_code == 403:
        return 'Acesso negado — usuário sem permissão para esta tela'
    if status_code == 401:
        return 'Tentativa de acesso sem autenticação'
    if status_code == 404:
        return 'Tela ou recurso solicitado não foi encontrado'

    if 'login' in path:
        return 'Realizou login no sistema'
    if 'logout' in path:
        return 'Realizou logout do sistema'
    if '/admin/tests' in path:
        return 'Consultou painel de testes e diagnóstico do sistema'
    if '/admin/acessos' in path:
        return 'Consultou o painel de monitoramento de acessos'
    if '/admin/usuarios' in path:
        return 'Gerenciou usuários do sistema'
    if '/admin' in path:
        return 'Acessou a área administrativa'
    if '/api/health' in path:
        return 'Verificação automática de saúde do sistema'

    if painel_codigo:
        nome = PAINEIS_NOMES.get(painel_codigo,
                                  painel_codigo.replace('painel', 'Painel '))
        # Identifica a sub-ação pela última parte da URL
        sub = path.rstrip('/').split('/')[-1].split('?')[0]
        acao = _SUB_DESCRICOES.get(sub, 'visualizou o painel')
        return '{} — {}'.format(nome, acao.capitalize())

    return 'Acessou o sistema'


def _tipo_acesso(path: str, status_code) -> str:
    if status_code and status_code >= 400:
        return 'erro'
    if 'login' in path:
        return 'login'
    if 'logout' in path:
        return 'logout'
    if '/admin' in path:
        return 'admin'
    if '/api/paineis/' in path or '/painel/' in path:
        return 'painel'
    return 'sistema'


def _check_throttle(key: tuple) -> bool:
    """Retorna True se pode escrever (passou THROTTLE_SEGUNDOS desde a última escrita)."""
    now = time.time()
    with _throttle_lock:
        if now - _throttle.get(key, 0) >= THROTTLE_SEGUNDOS:
            _throttle[key] = now
            return True
    return False


def _deve_logar(ip: str, painel_codigo, status_code: int, path: str) -> bool:
    if status_code and status_code >= 400:
        return True
    if 'login' in path or 'logout' in path:
        return True
    if '/admin' in path and '/admin/acessos' not in path:
        return _check_throttle((ip, '__admin__'))
    if painel_codigo:
        return _check_throttle((ip, painel_codigo))
    return False


# ─────────────────────────────────────────────────────────
# ATUALIZAÇÃO DA SESSÃO EM MEMÓRIA
# ─────────────────────────────────────────────────────────

def _atualizar_sessao(ip: str, painel_codigo, usuario_id, usuario_nome: str) -> None:
    agora = datetime.now()
    with _sessions_lock:
        if ip not in _sessions:
            _sessions[ip] = {
                'ip':              ip,
                'hostname':        None,
                'paineis_ativos':  {},
                'usuario_id':      None,
                'usuario_nome':    'Não identificado',
                'primeiro_acesso': agora,
                'ultimo_acesso':   agora,
                'total_requests':  0,
            }
        s = _sessions[ip]
        s['ultimo_acesso']  = agora
        s['total_requests'] += 1
        if usuario_nome and usuario_nome != 'Não identificado':
            s['usuario_nome'] = usuario_nome
            s['usuario_id']   = usuario_id

        if painel_codigo:
            nome = PAINEIS_NOMES.get(painel_codigo, painel_codigo)
            if painel_codigo not in s['paineis_ativos']:
                s['paineis_ativos'][painel_codigo] = {
                    'nome':           nome,
                    'primeiro_acesso': agora,
                    'ultimo_acesso':  agora,
                    'requests':       0,
                }
            p = s['paineis_ativos'][painel_codigo]
            p['ultimo_acesso'] = agora
            p['requests']     += 1


# ─────────────────────────────────────────────────────────
# ESCRITA ASSÍNCRONA NO BANCO
# ─────────────────────────────────────────────────────────

def _write_log_async(ip, painel_codigo, painel_nome, endpoint,
                     descricao, metodo, status_code, duracao_ms,
                     usuario_id, usuario_nome, tipo_acesso) -> None:
    """Grava no access_log via pool de threads — não bloqueia a resposta HTTP."""
    def _write():
        conn = None
        try:
            from backend.database import get_db_connection, release_connection
            conn = get_db_connection()
            if not conn:
                return
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO access_log
                    (ip, painel_codigo, painel_nome, endpoint, descricao,
                     metodo, status_code, duracao_ms, usuario_id, usuario_nome, tipo_acesso)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (ip, painel_codigo, painel_nome,
                  (endpoint or '')[:300],
                  descricao, metodo, status_code, duracao_ms,
                  usuario_id, usuario_nome, tipo_acesso))
            conn.commit()
            cur.close()
        except Exception as e:
            logger.debug('[access_tracker] write failed: %s', e)
        finally:
            if conn:
                try:
                    release_connection(conn)
                except Exception:
                    pass

    try:
        _write_pool.submit(_write)
    except RuntimeError:
        # Pool shutdown — ignorar silenciosamente
        pass


# ─────────────────────────────────────────────────────────
# RESOLUÇÃO DE HOSTNAME
# ─────────────────────────────────────────────────────────

def _resolve_hostname_single(ip: str) -> str:
    """Resolve um IP para hostname com timeout de 1,5s. Usa cache 24h."""
    if ip in ('127.0.0.1', '::1', 'localhost'):
        return 'Servidor Local'

    now = time.time()
    with _hostname_cache_lock:
        if ip in _hostname_cache:
            hostname, ts = _hostname_cache[ip]
            if now - ts < HOSTNAME_CACHE_TTL:
                return hostname

    try:
        from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
        with ThreadPoolExecutor(max_workers=1) as ex:
            future = ex.submit(socket.gethostbyaddr, ip)
            try:
                result = future.result(timeout=1.5)
                hostname = result[0]
            except (FutureTimeout, Exception):
                hostname = ip
    except Exception:
        hostname = ip

    with _hostname_cache_lock:
        _hostname_cache[ip] = (hostname, time.time())
    return hostname


def _resolve_hostnames_batch(ips: list) -> dict:
    """Resolve vários IPs em paralelo com timeout global de 4s."""
    resultado = {}
    with ThreadPoolExecutor(max_workers=8, thread_name_prefix='dns') as ex:
        futures = {ex.submit(_resolve_hostname_single, ip): ip for ip in ips[:20]}
        done, _ = futures_wait(futures.keys(), timeout=4.0)
        for f in done:
            ip = futures[f]
            try:
                resultado[ip] = f.result()
            except Exception:
                resultado[ip] = ip
    # IPs que não resolveram a tempo
    for ip in ips:
        resultado.setdefault(ip, ip)
    return resultado


# ─────────────────────────────────────────────────────────
# MIDDLEWARE FLASK
# ─────────────────────────────────────────────────────────

def init_access_tracker(app) -> None:
    """Registra os hooks before/after_request na app Flask."""

    @app.before_request
    def _before():
        g._access_t0 = time.time()

    @app.after_request
    def _after(response):
        try:
            path = flask_request.path

            # Ignora assets, health e self-referência
            if any(x in path for x in _IGNORAR):
                return response

            ip = (flask_request.headers.get('X-Forwarded-For', '')
                  .split(',')[0].strip()
                  or flask_request.remote_addr
                  or '0.0.0.0')

            metodo  = flask_request.method
            status  = response.status_code
            duracao = max(0, int((time.time() - getattr(g, '_access_t0', time.time())) * 1000))

            painel_codigo = _extrair_painel(path)

            try:
                uid   = flask_session.get('usuario_id')
                uname = (flask_session.get('usuario_nome')
                         or flask_session.get('usuario')
                         or 'Não identificado')
            except Exception:
                uid, uname = None, 'Não identificado'

            # Sempre atualiza memória (operação pura, sem I/O)
            _atualizar_sessao(ip, painel_codigo, uid, uname)

            # Banco: só quando relevante e throttled
            if _deve_logar(ip, painel_codigo, status, path):
                painel_nome = PAINEIS_NOMES.get(painel_codigo) if painel_codigo else None
                _write_log_async(
                    ip, painel_codigo, painel_nome, path,
                    _descrever(path, painel_codigo, status),
                    metodo, status, duracao, uid, uname,
                    _tipo_acesso(path, status),
                )
        except Exception as e:
            logger.debug('[access_tracker] after_request error: %s', e)

        return response

    app.logger.info('[access_tracker] Middleware registrado')


# ─────────────────────────────────────────────────────────
# API PÚBLICA
# ─────────────────────────────────────────────────────────

def get_connected_users() -> list:
    """Retorna sessões ativas (< RECENTE_SEGUNDOS) com hostnames resolvidos."""
    agora = datetime.now()
    resultado = []

    with _sessions_lock:
        snapshot = {ip: dict(s) for ip, s in _sessions.items()}

    for ip, s in snapshot.items():
        diff = (agora - s['ultimo_acesso']).total_seconds()
        if diff > RECENTE_SEGUNDOS:
            continue

        paineis_vivos = [
            {'codigo': k, 'nome': v['nome'], 'requests': v['requests']}
            for k, v in s['paineis_ativos'].items()
            if (agora - v['ultimo_acesso']).total_seconds() <= ATIVO_SEGUNDOS
        ]

        resultado.append({
            'ip':                   ip,
            'hostname':             s.get('hostname'),
            'usuario_nome':         s['usuario_nome'],
            'status':               'ativo' if diff <= ATIVO_SEGUNDOS else 'recente',
            'ultimo_acesso_ts':     s['ultimo_acesso'].isoformat(),
            'ultimo_acesso':        s['ultimo_acesso'].strftime('%H:%M:%S'),
            'tempo_conectado_min':  int((agora - s['primeiro_acesso']).total_seconds() / 60),
            'paineis_ativos':       paineis_vivos,
            'total_requests':       s['total_requests'],
        })

    # Resolve hostnames em lote para IPs sem hostname
    ips_sem_host = [e['ip'] for e in resultado if not e.get('hostname')]
    if ips_sem_host:
        hostnames = _resolve_hostnames_batch(ips_sem_host)
        for entry in resultado:
            ip = entry['ip']
            if ip in hostnames and hostnames[ip] != ip:
                entry['hostname'] = hostnames[ip]
                with _sessions_lock:
                    if ip in _sessions:
                        _sessions[ip]['hostname'] = hostnames[ip]

    resultado.sort(key=lambda x: (x['status'] != 'ativo', x['ultimo_acesso_ts']), reverse=False)
    return resultado


def cleanup_old_sessions() -> int:
    """Remove sessões inativas há mais de 1h da memória."""
    agora = datetime.now()
    with _sessions_lock:
        to_remove = [
            ip for ip, s in _sessions.items()
            if (agora - s['ultimo_acesso']).total_seconds() > 3600
        ]
        for ip in to_remove:
            del _sessions[ip]
    return len(to_remove)


def _cleanup_throttle() -> int:
    """Remove entradas expiradas do dict _throttle (> 2× THROTTLE_SEGUNDOS)."""
    now = time.time()
    cutoff = THROTTLE_SEGUNDOS * 2
    with _throttle_lock:
        expired = [k for k, ts in _throttle.items() if now - ts > cutoff]
        for k in expired:
            del _throttle[k]
    return len(expired)


def _cleanup_hostname_cache() -> int:
    """Remove entradas expiradas do cache de hostnames."""
    now = time.time()
    with _hostname_cache_lock:
        expired = [ip for ip, (_, ts) in _hostname_cache.items()
                   if now - ts > HOSTNAME_CACHE_TTL]
        for ip in expired:
            del _hostname_cache[ip]
    return len(expired)


def _cleanup_access_log() -> int:
    """Remove registros do access_log com mais de 6 meses."""
    try:
        from backend.database import get_db_connection, release_connection
        conn = get_db_connection()
        if not conn:
            return 0
        try:
            cur = conn.cursor()
            cur.execute("""
                DELETE FROM access_log
                WHERE dt_acesso < NOW() - INTERVAL '6 months'
            """)
            deleted = cur.rowcount
            conn.commit()
            cur.close()
            return deleted
        except Exception:
            conn.rollback()
            return 0
        finally:
            release_connection(conn)
    except Exception:
        return 0


def _periodic_cleanup():
    """
    Thread daemon que limpa dicts em memória a cada 30 minutos.
    Previne crescimento indefinido de _sessions, _throttle e _hostname_cache.
    Também limpa registros antigos da tabela access_log (retenção de 6 meses).
    """
    while True:
        try:
            time.sleep(1800)  # 30 min
            s = cleanup_old_sessions()
            t = _cleanup_throttle()
            h = _cleanup_hostname_cache()
            a = _cleanup_access_log()
            if s + t + h + a > 0:
                logger.debug(
                    '[access_tracker] cleanup: %d sessions, %d throttle, '
                    '%d hostnames, %d access_log removidos',
                    s, t, h, a
                )
        except Exception as e:
            logger.debug('[access_tracker] cleanup error: %s', e)


# Inicia thread de limpeza periódica (daemon — morre com o processo)
_cleanup_thread = threading.Thread(
    target=_periodic_cleanup,
    name='access_tracker_cleanup',
    daemon=True
)
_cleanup_thread.start()
