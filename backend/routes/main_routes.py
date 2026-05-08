"""
Rotas principais da aplicação
Endpoints: página inicial, frontend, static files, painéis genéricos
"""
from flask import Blueprint, send_from_directory, session, jsonify, current_app
import os
from backend.middleware.decorators import login_required, admin_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint (sem prefixo, pois são rotas raiz)
main_bp = Blueprint('main', __name__)


@main_bp.route('/')
def index():
    """Página inicial - redireciona para dashboard ou login"""
    if 'usuario_id' in session:
        return send_from_directory('frontend', 'dashboard.html')
    return send_from_directory('frontend', 'login.html')


@main_bp.route('/dashboard-v2')
@login_required
def dashboard_v2():
    """Nova versão do dashboard"""
    return send_from_directory('frontend', 'dashboard_v2.html')


@main_bp.route('/login')
@main_bp.route('/login.html')
def login_page():
    """Página de login — acessível via /login ou /login.html"""
    try:
        filepath = os.path.join('frontend', 'login.html')
        if not os.path.exists(filepath):
            current_app.logger.error(f'Arquivo não encontrado: {filepath}')
            return jsonify({
                'success': False,
                'error': f'Arquivo login.html não encontrado em {filepath}'
            }), 404
        return send_from_directory('frontend', 'login.html')
    except Exception as e:
        current_app.logger.error(f'Erro ao servir login.html: {e}')
        return jsonify({'success': False, 'error': 'Erro interno do servidor'}), 500


@main_bp.route('/frontend/<path:path>')
def serve_frontend(path):
    """Serve arquivos estáticos do frontend"""
    try:
        return send_from_directory('frontend', path)
    except Exception as e:
        current_app.logger.error(f'Erro ao servir frontend/{path}: {e}')
        return jsonify({'success': False, 'error': 'Arquivo não encontrado'}), 404


@main_bp.route('/static/<path:path>')
def serve_static(path):
    """Serve arquivos estáticos gerais"""
    try:
        return send_from_directory('static', path)
    except Exception as e:
        current_app.logger.error(f'Erro ao servir static/{path}: {e}')
        return jsonify({'success': False, 'error': 'Arquivo não encontrado'}), 404


@main_bp.route('/admin/usuarios')
@admin_required
def admin_usuarios_page():
    """Página de administração de usuários"""
    try:
        return send_from_directory('frontend', 'admin-usuarios.html')
    except Exception as e:
        current_app.logger.error(f'Erro ao servir admin-usuarios.html: {e}')
        return jsonify({'success': False, 'error': 'Arquivo não encontrado'}), 404


@main_bp.route('/acesso-negado')
def acesso_negado_page():
    """Página de acesso negado"""
    try:
        return send_from_directory('frontend', 'acesso-negado.html')
    except Exception as e:
        current_app.logger.error(f'Erro ao servir acesso-negado.html: {e}')
        return jsonify({'success': False, 'error': 'Arquivo não encontrado'}), 404


@main_bp.route('/painel/<painel_nome>')
@login_required
def painel(painel_nome):
    """
    Rota genérica para servir painéis
    Verifica permissões antes de servir o arquivo
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        tem_acesso = verificar_permissao_painel(usuario_id, painel_nome)
        # Hub de Serviços: permite acesso se usuário tem qualquer sub-painel do hub.
        # Usa cache de sessão — não requer permissão explícita a painel28.
        if not tem_acesso and painel_nome == 'painel28':
            _HUB_PAINEIS = frozenset(['painel34', 'painel35', 'painel36'])
            permissoes_session = set(session.get('permissoes') or [])
            tem_acesso = bool(permissoes_session & _HUB_PAINEIS)
        if not tem_acesso:
            current_app.logger.warning(f'Acesso negado ao painel {painel_nome}: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    painel_path = f'paineis/{painel_nome}/index.html'

    if os.path.exists(painel_path):
        return send_from_directory(f'paineis/{painel_nome}', 'index.html')

    current_app.logger.warning(f'Painel não encontrado: {painel_nome}')
    return jsonify({'success': False, 'error': 'Painel não encontrado'}), 404


@main_bp.route('/paineis/<painel_nome>/<path:path>')
@login_required
def serve_painel_files(painel_nome, path):
    """Serve arquivos estáticos dos painéis"""
    try:
        return send_from_directory(f'paineis/{painel_nome}', path)
    except Exception as e:
        current_app.logger.error(f'Erro ao servir paineis/{painel_nome}/{path}: {e}')
        return jsonify({'success': False, 'error': 'Arquivo não encontrado'}), 404