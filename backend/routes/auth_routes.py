"""
Rotas de autenticação e gerenciamento de sessão
Endpoints: login, logout, cadastro, verificação de sessão
"""
from flask import Blueprint, jsonify, request, session, current_app
from backend.auth import verificar_usuario, criar_usuario
from backend.middleware.decorators import admin_required

# Cria o Blueprint
auth_bp = Blueprint('auth', __name__, url_prefix='/api')


@auth_bp.route('/login', methods=['POST'])
def login():
    """
    Endpoint de autenticação de usuários
    POST /api/login
    Body: {"usuario": "...", "senha": "..."}
    """
    try:
        dados = request.get_json()

        if not dados:
            return jsonify({'success': False, 'error': 'Dados não fornecidos'}), 400

        usuario = dados.get('usuario')
        senha = dados.get('senha')

        if not usuario or not senha:
            return jsonify({'success': False, 'error': 'Usuário e senha são obrigatórios'}), 400

        current_app.logger.info(f'Tentativa de login: {usuario}')

        resultado = verificar_usuario(usuario, senha)

        if resultado['success']:
            session.permanent = True
            session['usuario_id'] = resultado['usuario_id']
            session['usuario'] = resultado['usuario']
            session['is_admin'] = resultado['is_admin']

            current_app.logger.info(f'✅ Login bem-sucedido: {usuario}')

            return jsonify({
                'success': True,
                'usuario': resultado['usuario'],
                'is_admin': resultado['is_admin']
            })
        else:
            current_app.logger.warning(f'❌ Login falhou: {usuario}')
            return jsonify({'success': False, 'error': 'Usuário ou senha inválidos'}), 401

    except Exception as e:
        current_app.logger.error(f'Erro no login: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno do servidor'}), 500


@auth_bp.route('/logout', methods=['POST'])
def logout():
    """
    Endpoint de logout
    POST /api/logout
    """
    usuario = session.get('usuario', 'desconhecido')
    session.clear()
    current_app.logger.info(f'👋 Logout: {usuario}')
    return jsonify({'success': True})


@auth_bp.route('/cadastro', methods=['POST'])
@admin_required
def cadastro():
    """
    Endpoint de cadastro de novos usuários (apenas admins)
    POST /api/cadastro
    Body: {"usuario": "...", "senha": "...", "email": "...", "is_admin": false}
    """
    try:
        dados = request.get_json()

        if not dados:
            return jsonify({'success': False, 'error': 'Dados não fornecidos'}), 400

        usuario = dados.get('usuario')
        senha = dados.get('senha')
        email = dados.get('email')
        is_admin = dados.get('is_admin', False)

        if not usuario or not senha or not email:
            return jsonify({'success': False, 'error': 'Todos os campos são obrigatórios'}), 400

        resultado = criar_usuario(usuario, senha, email, is_admin)

        if resultado['success']:
            current_app.logger.info(f'✅ Usuário criado: {usuario} (admin={is_admin})')
            return jsonify({'success': True, 'message': 'Usuário criado com sucesso'})
        else:
            return jsonify({'success': False, 'error': resultado['error']}), 400

    except Exception as e:
        current_app.logger.error(f'Erro no cadastro: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno do servidor'}), 500


@auth_bp.route('/verificar-sessao', methods=['GET'])
def verificar_sessao():
    """
    Verifica se há sessão ativa
    GET /api/verificar-sessao
    """
    if 'usuario_id' in session:
        return jsonify({
            'success': True,
            'autenticado': True,
            'usuario': session.get('usuario'),
            'is_admin': session.get('is_admin', False)
        })
    return jsonify({'success': True, 'autenticado': False})