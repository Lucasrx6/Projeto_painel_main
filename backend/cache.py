"""
Camada de Cache Redis
Sistema de Paineis Hospitalares

Funcionalidades:
- Conexao Redis com fallback gracioso (app nunca quebra sem Redis)
- Decorator @cache_route para endpoints Flask
- cache_get / cache_set / cache_delete / cache_delete_pattern
- cache_health para endpoint de health check

Principio fundamental: se o Redis estiver indisponivel,
o sistema funciona normalmente — busca direto no banco.
"""

import redis
import json
import logging
import functools
import time

from flask import jsonify

logger = logging.getLogger(__name__)

# Cliente Redis global — None enquanto nao inicializado ou indisponivel
_redis_client = None


# =========================================================
# INICIALIZACAO
# =========================================================

def init_redis(app):
    """
    Inicializa a conexao Redis a partir da configuracao do Flask.
    Chamado pela app factory / app.py no startup.

    Falha graciosamente: se o Redis nao estiver disponivel,
    o _redis_client permanece None e o cache fica desabilitado
    sem impactar o funcionamento do sistema.
    """
    global _redis_client

    if not app.config.get('CACHE_ENABLED', True):
        app.logger.info('Cache Redis desabilitado por configuracao (CACHE_ENABLED=false)')
        return

    redis_url = app.config.get('REDIS_URL', 'redis://localhost:6379/0')

    try:
        client = redis.Redis.from_url(
            redis_url,
            socket_connect_timeout=2,
            socket_timeout=2,
            decode_responses=True
        )
        client.ping()
        _redis_client = client
        app.logger.info(f'Redis conectado com sucesso: {redis_url}')

        # Aplica limite de memória para evitar crescimento ilimitado.
        # Padrão: 256mb com política LRU (descarta chaves menos usadas ao atingir o limite).
        # Sobrescreva com REDIS_MAXMEMORY no .env (ex: 512mb, 1gb).
        maxmemory = app.config.get('REDIS_MAXMEMORY', '256mb')
        try:
            client.config_set('maxmemory', maxmemory)
            client.config_set('maxmemory-policy', 'allkeys-lru')
            app.logger.info(f'Redis maxmemory={maxmemory} policy=allkeys-lru')
        except Exception as e_mem:
            app.logger.warning(f'Nao foi possivel configurar maxmemory Redis: {e_mem}')

    except Exception as e:
        app.logger.warning(
            f'Redis indisponivel ({type(e).__name__}: {e}) — '
            'cache desabilitado, sistema funciona normalmente sem cache'
        )
        _redis_client = None


def get_redis():
    """Retorna o cliente Redis ativo ou None se indisponivel."""
    return _redis_client


# =========================================================
# OPERACOES BASICAS
# =========================================================

def cache_get(key: str):
    """
    Busca um valor no cache.
    Retorna None se a chave nao existir, expirou ou o Redis estiver offline.
    """
    if _redis_client is None:
        return None
    try:
        value = _redis_client.get(key)
        return json.loads(value) if value is not None else None
    except Exception as e:
        logger.warning(f'Erro ao ler cache [{key}]: {e}')
        return None


def cache_set(key: str, value, ttl: int = 120) -> bool:
    """
    Salva um valor no cache com TTL em segundos.
    Serializa automaticamente para JSON (incluindo datetime via default=str).
    Retorna True se salvou, False se Redis offline ou erro.
    """
    if _redis_client is None:
        return False
    try:
        _redis_client.setex(key, ttl, json.dumps(value, default=str))
        return True
    except Exception as e:
        logger.warning(f'Erro ao salvar cache [{key}]: {e}')
        return False


def cache_delete(key: str):
    """Remove uma chave especifica do cache."""
    if _redis_client is None:
        return
    try:
        _redis_client.delete(key)
    except Exception as e:
        logger.warning(f'Erro ao deletar cache [{key}]: {e}')


def cache_delete_pattern(pattern: str) -> int:
    """
    Remove todas as chaves que casam com o pattern usando KEYS.
    Ex: cache_delete_pattern('painel4:*') remove todo o cache do painel4.

    ATENCAO: KEYS escaneia todo o keyspace — usar apenas em manutencao
    ou quando o volume de chaves for pequeno (sistema hospitalar local).
    """
    if _redis_client is None:
        return 0
    try:
        keys = _redis_client.keys(pattern)
        if keys:
            return _redis_client.delete(*keys)
        return 0
    except Exception as e:
        logger.warning(f'Erro ao deletar cache por pattern [{pattern}]: {e}')
        return 0


# =========================================================
# DECORATOR
# =========================================================

def cache_route(ttl: int = 120, key_prefix: str = None,
                vary_by_user: bool = True, vary_by_query: bool = False):
    """
    Decorator que aplica cache Redis em endpoints Flask.

    Logica de seguranca:
    - vary_by_user=True (padrao): cache separado por usuario_id.
      Garante que verificacoes de permissao internas ao handler
      nao sejam bypassadas por respostas em cache de outro usuario.
    - Apenas respostas 2xx sao cacheadas. Respostas 403/500 sempre
      executam o handler completo (com checagem de permissao).

    Args:
        ttl:            Segundos ate o cache expirar.
        key_prefix:     Prefixo da chave Redis. Default: nome da funcao.
        vary_by_user:   Se True, inclui usuario_id na chave.
        vary_by_query:  Se True, inclui hash dos query params na chave.
                        Usar em endpoints com filtros (?setor=X&status=Y).

    Header de resposta:
        X-Cache: HIT  — servido do cache
        X-Cache: MISS — buscado no banco e cacheado
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            # Se Redis estiver offline, executa normalmente sem cache
            if _redis_client is None:
                return func(*args, **kwargs)

            import hashlib
            from flask import session, request as flask_request

            # Monta a chave de cache com os segmentos ativos
            prefix = key_prefix or func.__name__
            parts = [prefix]

            if vary_by_user:
                uid = session.get('usuario_id', 'anon')
                parts.append(f'u{uid}')

            if vary_by_query:
                qs = flask_request.query_string.decode('utf-8')
                if qs:
                    qs_hash = hashlib.md5(qs.encode()).hexdigest()[:10]
                    parts.append(qs_hash)

            cache_key = ':'.join(parts)

            # Tenta servir do cache
            cached = cache_get(cache_key)
            if cached is not None:
                response = jsonify(cached)
                response.headers['X-Cache'] = 'HIT'
                return response

            # Cache MISS — executa o handler original
            response = func(*args, **kwargs)

            # Cacheia apenas respostas de sucesso (2xx)
            status = getattr(response, 'status_code', 200)
            if 200 <= status < 300:
                try:
                    data = response.get_json()
                    if data is not None:
                        cache_set(cache_key, data, ttl=ttl)
                        response.headers['X-Cache'] = 'MISS'
                except Exception:
                    pass

            return response

        return wrapper
    return decorator


# =========================================================
# HEALTH CHECK
# =========================================================

def cache_health() -> dict:
    """
    Retorna o status do Redis para o endpoint /api/health/redis.
    Nunca lanca excecao — retorna dict com status descritivo.
    """
    if _redis_client is None:
        return {
            'status': 'disabled',
            'message': 'Redis nao conectado ou desabilitado por configuracao'
        }

    try:
        start = time.time()
        _redis_client.ping()
        latency_ms = round((time.time() - start) * 1000, 2)

        info_server = _redis_client.info('server')
        info_memory = _redis_client.info('memory')
        info_stats = _redis_client.info('stats')

        return {
            'status': 'healthy',
            'latency_ms': latency_ms,
            'version': info_server.get('redis_version', 'unknown'),
            'uptime_days': info_server.get('uptime_in_days', 0),
            'memory_used_mb': round(
                info_memory.get('used_memory', 0) / 1024 / 1024, 2
            ),
            'memory_peak_mb': round(
                info_memory.get('used_memory_peak', 0) / 1024 / 1024, 2
            ),
            'total_commands_processed': info_stats.get('total_commands_processed', 0),
            'keyspace_hits': info_stats.get('keyspace_hits', 0),
            'keyspace_misses': info_stats.get('keyspace_misses', 0),
        }

    except Exception as e:
        return {
            'status': 'unhealthy',
            'error': str(e)
        }
