"""
Rotas de administração de usuários
Endpoints para gerenciamento de usuários, permissões e estatísticas
Requer privilégios de administrador
"""
from flask import Blueprint, jsonify, request, session, current_app
from backend.middleware.decorators import admin_required, login_required
from backend.user_management import (
    listar_usuarios,
    obter_usuario,
    editar_usuario,
    alterar_status_usuario,
    resetar_senha,
    obter_permissoes,
    adicionar_permissao,
    remover_permissao,
    obter_historico,
    obter_estatisticas
)

# Cria o Blueprint
admin_bp = Blueprint('admin', __name__, url_prefix='/api')


@admin_bp.route('/minhas-permissoes', methods=['GET'])
@login_required
def api_minhas_permissoes():
    """
    Retorna as permissões do usuário atual
    GET /api/minhas-permissoes
    """
    try:
        usuario_id = session.get('usuario_id')
        is_admin = session.get('is_admin', False)

        if is_admin:
            return jsonify({
                'success': True,
                'permissoes': [
                    'painel2', 'painel3', 'painel4', 'painel5',
                    'painel6', 'painel7', 'painel8', 'painel9',
                    'painel10', 'painel11', 'painel12', 'painel13',
                    'painel14', 'painel15'
                ],
                'is_admin': True
            })

        resultado = obter_permissoes(usuario_id)

        if resultado['success']:
            paineis = [p['painel'] for p in resultado['permissoes']]
            return jsonify({
                'success': True,
                'permissoes': paineis,
                'is_admin': False
            })
        else:
            return jsonify(resultado), 500

    except Exception as e:
        current_app.logger.error(f'Erro ao obter permissões: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@admin_bp.route('/admin/usuarios', methods=['GET'])
@admin_required
def api_listar_usuarios():
    """
    Lista todos os usuários do sistema
    GET /api/admin/usuarios?incluir_inativos=true
    """
    try:
        incluir_inativos = request.args.get('incluir_inativos', 'true').lower() == 'true'
        resultado = listar_usuarios(incluir_inativos=incluir_inativos)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 500

    except Exception as e:
        current_app.logger.error(f'Erro ao listar usuários: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@admin_bp.route('/admin/usuarios/<int:usuario_id>', methods=['GET'])
@admin_required
def api_obter_usuario(usuario_id):
    """
    Obtém dados de um usuário específico
    GET /api/admin/usuarios/<id>
    """
    try:
        resultado = obter_usuario(usuario_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 404

    except Exception as e:
        current_app.logger.error(f'Erro ao obter usuário: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@admin_bp.route('/admin/estatisticas', methods=['GET'])
@admin_required
def api_estatisticas():
    """
    Retorna estatísticas gerais do sistema
    GET /api/admin/estatisticas
    """
    try:
        resultado = obter_estatisticas()

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 500

    except Exception as e:
        current_app.logger.error(f'Erro ao obter estatísticas: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@admin_bp.route('/admin/usuarios/<int:usuario_id>', methods=['PUT'])
@admin_required
def api_editar_usuario(usuario_id):
    """
    Edita dados de um usuário
    PUT /api/admin/usuarios/<id>
    Body: {"usuario": "...", "email": "...", "is_admin": false}
    """
    try:
        dados = request.get_json()
        admin_id = session.get('usuario_id')

        if not dados:
            return jsonify({'success': False, 'error': 'Nenhum dado fornecido'}), 400

        resultado = editar_usuario(usuario_id, dados, admin_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 400

    except Exception as e:
        current_app.logger.error(f'Erro ao editar usuário: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@admin_bp.route('/admin/usuarios/<int:usuario_id>/status', methods=['PUT'])
@admin_required
def api_alterar_status(usuario_id):
    """
    Ativa ou desativa um usuário
    PUT /api/admin/usuarios/<id>/status
    Body: {"ativo": true}
    """
    try:
        dados = request.get_json()
        admin_id = session.get('usuario_id')

        if 'ativo' not in dados:
            return jsonify({'success': False, 'error': 'Campo "ativo" é obrigatório'}), 400

        ativo = dados['ativo']

        if usuario_id == admin_id and not ativo:
            return jsonify({
                'success': False,
                'error': 'Você não pode desativar sua própria conta'
            }), 400

        resultado = alterar_status_usuario(usuario_id, ativo, admin_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 400

    except Exception as e:
        current_app.logger.error(f'Erro ao alterar status: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@admin_bp.route('/admin/usuarios/<int:usuario_id>/senha', methods=['PUT'])
@admin_required
def api_resetar_senha(usuario_id):
    """
    Reseta a senha de um usuário
    PUT /api/admin/usuarios/<id>/senha
    Body: {"nova_senha": "..."}
    """
    try:
        dados = request.get_json()
        admin_id = session.get('usuario_id')

        if 'nova_senha' not in dados:
            return jsonify({'success': False, 'error': 'Campo "nova_senha" é obrigatório'}), 400

        nova_senha = dados['nova_senha']

        resultado = resetar_senha(usuario_id, nova_senha, admin_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 400

    except Exception as e:
        current_app.logger.error(f'Erro ao resetar senha: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@admin_bp.route('/admin/usuarios/<int:usuario_id>/permissoes', methods=['GET'])
@admin_required
def api_obter_permissoes(usuario_id):
    """
    Lista permissões de um usuário
    GET /api/admin/usuarios/<id>/permissoes
    """
    try:
        resultado = obter_permissoes(usuario_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 500

    except Exception as e:
        current_app.logger.error(f'Erro ao obter permissões: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@admin_bp.route('/admin/usuarios/<int:usuario_id>/permissoes', methods=['POST'])
@admin_required
def api_adicionar_permissao(usuario_id):
    """
    Adiciona permissão a um painel para o usuário
    POST /api/admin/usuarios/<id>/permissoes
    Body: {"painel_nome": "painel2"}
    """
    try:
        dados = request.get_json()
        admin_id = session.get('usuario_id')

        if 'painel_nome' not in dados:
            return jsonify({'success': False, 'error': 'Campo "painel_nome" é obrigatório'}), 400

        painel_nome = dados['painel_nome']

        resultado = adicionar_permissao(usuario_id, painel_nome, admin_id)

        if resultado['success']:
            return jsonify(resultado), 201
        else:
            return jsonify(resultado), 400

    except Exception as e:
        current_app.logger.error(f'Erro ao adicionar permissão: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@admin_bp.route('/admin/usuarios/<int:usuario_id>/permissoes/<painel_nome>', methods=['DELETE'])
@admin_required
def api_remover_permissao(usuario_id, painel_nome):
    """
    Remove permissão de um painel do usuário
    DELETE /api/admin/usuarios/<id>/permissoes/<painel_nome>
    """
    try:
        admin_id = session.get('usuario_id')

        resultado = remover_permissao(usuario_id, painel_nome, admin_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 400

    except Exception as e:
        current_app.logger.error(f'Erro ao remover permissão: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@admin_bp.route('/admin/usuarios/<int:usuario_id>/historico', methods=['GET'])
@admin_required
def api_obter_historico(usuario_id):
    """
    Obtém histórico de alterações de um usuário
    GET /api/admin/usuarios/<id>/historico?limite=50
    """
    try:
        limite = request.args.get('limite', 50, type=int)
        resultado = obter_historico(usuario_id, limite)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 500

    except Exception as e:
        current_app.logger.error(f'Erro ao obter histórico: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@admin_bp.route('/admin/paineis', methods=['GET'])
@admin_required
def api_listar_paineis():
    """
    Lista todos os painéis disponíveis no sistema
    GET /api/admin/paineis
    """
    try:
        paineis = [
            {'nome': 'painel2', 'titulo': 'Evolução de Turno',
             'descricao': 'Acompanhamento de evoluções médicas', 'ativo': True},
            {'nome': 'painel3', 'titulo': 'Médicos PS',
             'descricao': 'Monitoramento de médicos logados', 'ativo': True},
            {'nome': 'painel4', 'titulo': 'Ocupação Hospitalar',
             'descricao': 'Monitoramento de ocupação de leitos', 'ativo': True},
            {'nome': 'painel5', 'titulo': 'Cirurgias do Dia',
             'descricao': 'Acompanhamento de cirurgias agendadas', 'ativo': True},
            {'nome': 'painel6', 'titulo': 'Priorização Clínica IA',
             'descricao': 'Análise de risco com inteligência artificial', 'ativo': True},
            {'nome': 'painel7', 'titulo': 'Análise Risco Sepse',
             'descricao': 'Detecção de risco de sepse', 'ativo': True},
            {'nome': 'painel8', 'titulo': 'Situação Pacientes',
             'descricao': 'Acompanhamento de situação dos pacientes internados', 'ativo': True},
            {'nome': 'painel9', 'titulo': 'Lab Pendentes',
             'descricao': 'Exames de Lab pendentes', 'ativo': True},
            {'nome': 'painel10', 'titulo': 'Painel PS',
             'descricao': 'Acompanhamento desempenho PS', 'ativo': True},
            {'nome': 'painel11', 'titulo': 'Painel Internação',
             'descricao': 'Acompanhamento de pedidos de internação', 'ativo': True},
            {'nome': 'painel12', 'titulo': 'Painel Ocupação e Produção',
             'descricao': 'Acompanhamento informações gerenciais', 'ativo': True},
            {'nome': 'painel13', 'titulo': 'Mapa de Nutrição',
             'descricao': 'Acompanhamento informações de nutrição', 'ativo': True},
            {'nome': 'painel14', 'titulo': 'Chamados T.I',
             'descricao': 'Paineis de gerencia de chamados emergenciais', 'ativo': True},
            {'nome': 'painel15', 'titulo': 'Abrir Chamados',
             'descricao': 'Painel para abrir chamados emergenciais', 'ativo': True},
        ]

        return jsonify({'success': True, 'paineis': paineis}), 200

    except Exception as e:
        current_app.logger.error(f'Erro ao listar painéis: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500