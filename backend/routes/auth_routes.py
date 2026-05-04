"""
Rotas de autenticação e gerenciamento de sessão
Endpoints: login, logout, cadastro, verificação de sessão, reset de senha
"""
from flask import Blueprint, jsonify, request, session, current_app
from backend.auth import (
    verificar_usuario,
    criar_usuario,
    solicitar_pin_reset,
    verificar_pin_reset,
    resetar_senha_com_pin,
    resetar_senha_force_reset
)
from backend.middleware.decorators import admin_required, login_required
from backend.user_management import buscar_permissoes_usuario

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

            # Cache de permissoes na sessao para evitar consultas ao banco por requisicao
            if not resultado['is_admin']:
                permissoes = buscar_permissoes_usuario(resultado['usuario_id'])
                session['permissoes'] = list(permissoes)
            else:
                session['permissoes'] = []  # Admin acessa tudo, lista vazia e suficiente

            # Verifica se precisa forçar reset de senha
            force_reset = resultado.get('force_reset', False)
            if force_reset:
                session['force_reset'] = True

            current_app.logger.info(f'✅ Login bem-sucedido: {usuario}')

            return jsonify({
                'success': True,
                'usuario': resultado['usuario'],
                'is_admin': resultado['is_admin'],
                'force_reset': force_reset
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
    Body: {"usuario": "...", "senha": "...", "email": "...", "is_admin": false, "force_reset_senha": false}
    """
    try:
        dados = request.get_json()

        if not dados:
            return jsonify({'success': False, 'error': 'Dados não fornecidos'}), 400

        usuario = dados.get('usuario')
        senha = dados.get('senha')
        email = dados.get('email')
        is_admin = dados.get('is_admin', False)
        force_reset = dados.get('force_reset_senha', False)

        if not usuario or not senha or not email:
            return jsonify({'success': False, 'error': 'Todos os campos são obrigatórios'}), 400

        resultado = criar_usuario(usuario, senha, email, is_admin)

        if resultado['success']:
            # Atualiza force_reset_senha se marcado
            if force_reset:
                try:
                    from backend.database import get_db_connection
                    conn = get_db_connection()
                    if conn:
                        cur = conn.cursor()
                        cur.execute(
                            "UPDATE usuarios SET force_reset_senha = TRUE WHERE id = %s",
                            (resultado['usuario_id'],)
                        )
                        conn.commit()
                        cur.close()
                        conn.close()
                except Exception as e:
                    current_app.logger.error(f'Erro ao definir force_reset: {e}')

            current_app.logger.info(f'Usuário criado: {usuario} (admin={is_admin}, force_reset={force_reset})')
            return jsonify({
                'success': True,
                'message': 'Usuário criado com sucesso',
                'usuario_id': resultado.get('usuario_id')
            })
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
            'is_admin': session.get('is_admin', False),
            'force_reset': session.get('force_reset', False)
        })
    return jsonify({'success': True, 'autenticado': False})


# ==============================================================================
# RESET DE SENHA VIA PIN
# ==============================================================================

@auth_bp.route('/reset-senha/solicitar', methods=['POST'])
def api_solicitar_reset():
    """
    Solicita envio de PIN de reset por email
    POST /api/reset-senha/solicitar
    Body: {"usuario": "..."}
    """
    try:
        dados = request.get_json()

        if not dados:
            return jsonify({'success': False, 'error': 'Dados não fornecidos'}), 400

        usuario = dados.get('usuario')

        if not usuario:
            return jsonify({'success': False, 'error': 'Usuário é obrigatório'}), 400

        resultado = solicitar_pin_reset(usuario)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            status = 429 if 'cooldown' in resultado else 400
            return jsonify(resultado), status

    except Exception as e:
        current_app.logger.error(f'Erro ao solicitar reset: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno do servidor'}), 500


@auth_bp.route('/reset-senha/verificar', methods=['POST'])
def api_verificar_pin():
    """
    Verifica se o PIN informado é válido
    POST /api/reset-senha/verificar
    Body: {"usuario": "...", "pin": "1234"}
    """
    try:
        dados = request.get_json()

        if not dados:
            return jsonify({'success': False, 'error': 'Dados não fornecidos'}), 400

        usuario = dados.get('usuario')
        pin = dados.get('pin')

        if not usuario or not pin:
            return jsonify({'success': False, 'error': 'Usuário e código são obrigatórios'}), 400

        resultado = verificar_pin_reset(usuario, pin)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 400

    except Exception as e:
        current_app.logger.error(f'Erro ao verificar PIN: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno do servidor'}), 500


@auth_bp.route('/reset-senha/confirmar', methods=['POST'])
def api_confirmar_reset():
    """
    Confirma o reset de senha com PIN + nova senha
    POST /api/reset-senha/confirmar
    Body: {"usuario": "...", "pin": "1234", "nova_senha": "..."}
    """
    try:
        dados = request.get_json()

        if not dados:
            return jsonify({'success': False, 'error': 'Dados não fornecidos'}), 400

        usuario = dados.get('usuario')
        pin = dados.get('pin')
        nova_senha = dados.get('nova_senha')

        if not usuario or not pin or not nova_senha:
            return jsonify({'success': False, 'error': 'Todos os campos são obrigatórios'}), 400

        resultado = resetar_senha_com_pin(usuario, pin, nova_senha)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 400

    except Exception as e:
        current_app.logger.error(f'Erro ao confirmar reset: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno do servidor'}), 500


@auth_bp.route('/minhas-permissoes', methods=['GET'])
@login_required
def minhas_permissoes():
    """
    Retorna as permissoes do usuario logado (a partir do cache de sessao).
    GET /api/minhas-permissoes
    """
    is_admin = session.get('is_admin', False)
    permissoes = list(session.get('permissoes', []))

    # Hub de Serviços (painel28) é especial: aparece automaticamente se o usuário
    # tem qualquer sub-painel do hub liberado, sem precisar de permissão explícita.
    if not is_admin and 'painel28' not in permissoes:
        _HUB_PAINEIS = frozenset(['painel34', 'painel35', 'painel36'])
        if set(permissoes) & _HUB_PAINEIS:
            permissoes = permissoes + ['painel28']

    return jsonify({
        'success': True,
        'is_admin': is_admin,
        'permissoes': permissoes
    })


@auth_bp.route('/reset-senha/force', methods=['POST'])
@login_required
def api_force_reset():
    """
    Reseta senha quando force_reset_senha está ativo (primeiro acesso)
    POST /api/reset-senha/force
    Body: {"nova_senha": "..."}
    """
    try:
        dados = request.get_json()

        if not dados:
            return jsonify({'success': False, 'error': 'Dados não fornecidos'}), 400

        nova_senha = dados.get('nova_senha')

        if not nova_senha:
            return jsonify({'success': False, 'error': 'Nova senha é obrigatória'}), 400

        usuario_id = session.get('usuario_id')

        resultado = resetar_senha_force_reset(usuario_id, nova_senha)

        if resultado['success']:
            # Limpa flag de force_reset da sessao
            session.pop('force_reset', None)
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 400

    except Exception as e:
        current_app.logger.error(f'Erro ao force-reset: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno do servidor'}), 500