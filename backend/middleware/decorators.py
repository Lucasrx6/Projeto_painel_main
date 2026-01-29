"""
Decoradores customizados para autenticação e autorização
"""
from functools import wraps
from flask import session, jsonify, request, current_app
from backend.user_management import verificar_permissao_painel


def login_required(f):
    """
    Decorator que exige que o usuário esteja autenticado
    Redireciona para login se não estiver autenticado
    """

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'usuario_id' not in session:
            current_app.logger.warning(f'Acesso não autorizado: {request.url}')
            return jsonify({
                'success': False,
                'error': 'Não autenticado',
                'redirect': '/login.html'
            }), 401
        return f(*args, **kwargs)

    return decorated_function


def admin_required(f):
    """
    Decorator que exige que o usuário seja administrador
    Verifica se está autenticado E se tem privilégios admin
    """

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'usuario_id' not in session:
            current_app.logger.warning(f'Acesso não autorizado (admin): {request.url}')
            return jsonify({
                'success': False,
                'error': 'Não autenticado',
                'redirect': '/login.html'
            }), 401

        if not session.get('is_admin', False):
            current_app.logger.warning(f'Acesso negado (não admin): {session.get("usuario")}')
            return jsonify({
                'success': False,
                'error': 'Sem permissão de administrador'
            }), 403

        return f(*args, **kwargs)

    return decorated_function


def panel_permission_required(panel_name):
    """
    Decorator que verifica se o usuário tem permissão para acessar um painel específico
    Admins têm acesso automático a todos os painéis

    Args:
        panel_name: Nome do painel (ex: 'painel2', 'painel3')

    Usage:
        @panel_permission_required('painel2')
        def minha_rota():
            ...
    """

    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'usuario_id' not in session:
                current_app.logger.warning(f'Acesso não autorizado ao {panel_name}: {request.url}')
                return jsonify({
                    'success': False,
                    'error': 'Não autenticado',
                    'redirect': '/login.html'
                }), 401

            usuario_id = session.get('usuario_id')
            is_admin = session.get('is_admin', False)

            # Admin tem acesso a tudo
            if is_admin:
                return f(*args, **kwargs)

            # Verifica permissão específica do painel
            if not verificar_permissao_painel(usuario_id, panel_name):
                current_app.logger.warning(
                    f'Acesso negado ao {panel_name}: {session.get("usuario")}'
                )
                return jsonify({
                    'success': False,
                    'error': f'Sem permissão para acessar {panel_name}'
                }), 403

            return f(*args, **kwargs)

        return decorated_function

    return decorator