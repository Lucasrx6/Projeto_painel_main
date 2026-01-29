"""
Rate Limiting para proteção contra ataques
Limita número de requisições por IP/usuário
"""
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address


def setup_rate_limiter(app):
    """
    Configura rate limiting na aplicação

    Args:
        app: Instância do Flask app
    """
    if not app.config.get('RATELIMIT_ENABLED', False):
        app.logger.info('⏭️  Rate limiting desabilitado (modo desenvolvimento)')
        return None

    limiter = Limiter(
        app=app,
        key_func=get_remote_address,
        default_limits=[app.config.get('RATELIMIT_DEFAULT', "100 per hour")],
        storage_uri="memory://",  # Use Redis em produção: "redis://localhost:6379"
        strategy="fixed-window"
    )

    app.logger.info('✅ Rate limiting configurado')

    return limiter