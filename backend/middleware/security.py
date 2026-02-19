"""
Middleware de segurança HTTP
Adiciona headers de segurança às respostas
"""


def add_security_headers(response, app_config):
    """
    Adiciona headers de segurança à resposta HTTP

    Args:
        response: Flask response object
        app_config: Flask app.config dictionary

    Returns:
        response: Modified response with security headers
    """
    # Previne clickjacking
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'

    # Previne MIME-type sniffing
    response.headers['X-Content-Type-Options'] = 'nosniff'

    # XSS Protection (legado, mas ainda útil)
    response.headers['X-XSS-Protection'] = '1; mode=block'

    # Política de referrer
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'

    # Content Security Policy (CSP)
    if not app_config.get('DEBUG', False):
        # Em produção, adiciona CSP mais restritivo
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
            "img-src 'self' data: https:; "
            "font-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
            "connect-src 'self'; "
            "frame-ancestors 'self';"
        )

    # HSTS (HTTPS Strict Transport Security)
    if app_config.get('SESSION_COOKIE_SECURE', False):
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload'

    # Permissions Policy (antes Feature-Policy)
    response.headers['Permissions-Policy'] = (
        "geolocation=(), "
        "microphone=(), "
        "camera=(), "
        "payment=(), "
        "usb=(), "
        "magnetometer=(), "
        "gyroscope=(), "
        "accelerometer=()"
    )

    return response


def setup_security_headers(app):
    """
    Configura o middleware de security headers no Flask app

    Args:
        app: Instância do Flask app
    """
    @app.after_request
    def apply_security_headers(response):
        return add_security_headers(response, app.config)

    app.logger.info('✅ Security headers configurados')