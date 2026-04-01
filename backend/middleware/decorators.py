"""
Decoradores customizados para autenticação e autorização
"""
from functools import wraps
from urllib.parse import quote
from flask import session, jsonify, request, redirect, current_app
from backend.user_management import verificar_permissao_painel
from backend.constants import SESSION_USUARIO_ID, SESSION_IS_ADMIN, SESSION_USUARIO


def _e_requisicao_de_pagina():
    """
    Retorna True quando o browser está navegando para uma página HTML
    (não é uma chamada de API via fetch/XHR).

    Critérios:
      - URL não começa com /api/
      - Accept header inclui text/html (navegação normal do browser)
    """
    if request.path.startswith('/api/'):
        return False
    accept = request.headers.get('Accept', '')
    return 'text/html' in accept


def _redirecionar_para_login():
    """
    Faz redirect HTTP 302 para /login?next=<url_atual>.
    Usado quando o browser tenta acessar uma página sem sessão ativa.
    """
    next_url = quote(request.url, safe='')
    return redirect(f'/login?next={next_url}', 302)


def login_required(f):
    """
    Decorator que exige que o usuário esteja autenticado.

    - Requisições de página HTML (browser): redirect 302 → /login?next=<url>
    - Requisições de API (fetch/XHR):       JSON 401 com campo 'redirect'
    """

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if SESSION_USUARIO_ID not in session:
            current_app.logger.warning(f'Acesso não autorizado: {request.url}')
            if _e_requisicao_de_pagina():
                return _redirecionar_para_login()
            return jsonify({
                'success': False,
                'error': 'Não autenticado',
                'redirect': '/login.html'
            }), 401
        return f(*args, **kwargs)

    return decorated_function


def admin_required(f):
    """
    Decorator que exige que o usuário seja administrador.
    Verifica se está autenticado E se tem privilégios admin.

    - Requisições de página HTML (browser): redirect 302 → /login?next=<url>
    - Requisições de API (fetch/XHR):       JSON 401/403
    """

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if SESSION_USUARIO_ID not in session:
            current_app.logger.warning(f'Acesso não autorizado (admin): {request.url}')
            if _e_requisicao_de_pagina():
                return _redirecionar_para_login()
            return jsonify({
                'success': False,
                'error': 'Não autenticado',
                'redirect': '/login.html'
            }), 401

        if not session.get(SESSION_IS_ADMIN, False):
            current_app.logger.warning(f'Acesso negado (não admin): {session.get(SESSION_USUARIO)}')
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
            if SESSION_USUARIO_ID not in session:
                current_app.logger.warning(f'Acesso não autorizado ao {panel_name}: {request.url}')
                if _e_requisicao_de_pagina():
                    return _redirecionar_para_login()
                return jsonify({
                    'success': False,
                    'error': 'Não autenticado',
                    'redirect': '/login.html'
                }), 401

            usuario_id = session.get(SESSION_USUARIO_ID)
            is_admin = session.get(SESSION_IS_ADMIN, False)

            # Admin tem acesso a tudo
            if is_admin:
                return f(*args, **kwargs)

            # Verifica permissão específica do painel
            if not verificar_permissao_painel(usuario_id, panel_name):
                current_app.logger.warning(
                    f'Acesso negado ao {panel_name}: {session.get(SESSION_USUARIO)}'
                )
                return jsonify({
                    'success': False,
                    'error': f'Sem permissão para acessar {panel_name}'
                }), 403

            return f(*args, **kwargs)

        return decorated_function

    return decorator