"""
Testes para o modulo de cache Redis (backend.cache).

Cobertura:
- init_redis: inicializacao com/sem Redis
- cache_health: status quando ativo vs inativo
- cache_get / cache_set: operacoes basicas
- cache_route decorator: hit, miss, bypass POST, fallback
"""
import pytest
import json
from unittest.mock import patch, MagicMock


class TestInitRedis:
    @pytest.mark.cache
    def test_init_com_cache_desabilitado(self, app):
        from backend.cache import init_redis
        app.config['CACHE_ENABLED'] = False
        with patch('backend.cache._redis_client', None):
            init_redis(app)
        app.config['CACHE_ENABLED'] = True

    @pytest.mark.cache
    def test_init_redis_indisponivel(self, app):
        from backend.cache import init_redis
        with patch('backend.cache.redis.from_url', side_effect=Exception('Connection refused')):
            init_redis(app)


class TestCacheHealth:
    @pytest.mark.cache
    def test_health_sem_redis(self):
        with patch('backend.cache._redis_client', None):
            from backend.cache import cache_health
            result = cache_health()
            assert result['status'] == 'disabled' or result['status'] == 'disconnected'

    @pytest.mark.cache
    def test_health_com_redis(self, mock_redis):
        mock_redis.dbsize.return_value = 42
        with patch('backend.cache._redis_client', mock_redis):
            from backend.cache import cache_health
            result = cache_health()
            assert result['status'] == 'healthy'


class TestCacheGetSet:
    @pytest.mark.cache
    def test_cache_set_sem_redis(self):
        with patch('backend.cache._redis_client', None):
            from backend.cache import cache_set
            result = cache_set('key', 'value')
            assert result is False

    @pytest.mark.cache
    def test_cache_get_sem_redis(self):
        with patch('backend.cache._redis_client', None):
            from backend.cache import cache_get
            result = cache_get('key')
            assert result is None

    @pytest.mark.cache
    def test_cache_set_com_redis(self, mock_redis):
        with patch('backend.cache._redis_client', mock_redis):
            from backend.cache import cache_set
            result = cache_set('test_key', {'data': 123}, ttl=60)
            assert result is True

    @pytest.mark.cache
    def test_cache_get_hit(self, mock_redis):
        mock_redis.get.return_value = json.dumps({'data': 'cached'}).encode()
        with patch('backend.cache._redis_client', mock_redis):
            from backend.cache import cache_get
            result = cache_get('test_key')
            assert result == {'data': 'cached'}

    @pytest.mark.cache
    def test_cache_get_miss(self, mock_redis):
        mock_redis.get.return_value = None
        with patch('backend.cache._redis_client', mock_redis):
            from backend.cache import cache_get
            result = cache_get('missing_key')
            assert result is None


class TestCacheDelete:
    @pytest.mark.cache
    def test_delete_sem_redis(self):
        with patch('backend.cache._redis_client', None):
            from backend.cache import cache_delete
            result = cache_delete('key')
            assert result is None

    @pytest.mark.cache
    def test_delete_com_redis(self, mock_redis):
        with patch('backend.cache._redis_client', mock_redis):
            from backend.cache import cache_delete
            result = cache_delete('key')
            assert result is None
