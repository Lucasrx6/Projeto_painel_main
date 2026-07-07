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
                    'painel14', 'painel15', 'painel16', 'painel17',
                    'painel18', 'painel19', 'painel20', 'painel21',
                    'painel22', 'painel23', 'painel24', 'painel25',
                    'painel26', 'painel27', 'painel28', 'painel29',
                    'painel30', 'painel31', 'painel32', 'painel33',
                    'painel34', 'painel35', 'painel36', 'painel37', 'painel38', 'painel39',
                    'painel40',
                    'painel41', 'painel42', 'painel43', 'painel44',
                    'painel45', 'painel46', 'painel47'
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
    Body: {"nova_senha": "...", "force_reset_senha": false}
    """
    try:
        dados = request.get_json()
        admin_id = session.get('usuario_id')

        if 'nova_senha' not in dados:
            return jsonify({'success': False, 'error': 'Campo "nova_senha" é obrigatório'}), 400

        nova_senha = dados['nova_senha']
        force_reset = dados.get('force_reset_senha', False)

        resultado = resetar_senha(usuario_id, nova_senha, admin_id)

        if resultado['success'] and force_reset:
            try:
                from backend.database import get_db_cursor
                with get_db_cursor(commit=True) as cur:
                    cur.execute(
                        "UPDATE usuarios SET force_reset_senha = TRUE WHERE id = %s",
                        (usuario_id,)
                    )
            except Exception as e:
                current_app.logger.error(f'Erro ao definir force_reset: {e}')

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 400

    except Exception as e:
        current_app.logger.error(f'Erro ao resetar senha: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@admin_bp.route('/admin/usuarios/<int:usuario_id>/force-reset', methods=['PUT'])
@admin_required
def api_force_reset_toggle(usuario_id):
    """
    Ativa/desativa force_reset_senha para um usuário
    PUT /api/admin/usuarios/<id>/force-reset
    Body: {"force_reset_senha": true}
    """
    try:
        dados = request.get_json()
        if 'force_reset_senha' not in dados:
            return jsonify({'success': False, 'error': 'Campo obrigatório'}), 400

        force_reset = bool(dados['force_reset_senha'])

        from backend.database import get_db_cursor
        with get_db_cursor(commit=True) as cur:
            cur.execute(
                "UPDATE usuarios SET force_reset_senha = %s WHERE id = %s",
                (force_reset, usuario_id)
            )
            if cur.rowcount == 0:
                return jsonify({'success': False, 'error': 'Usuário não encontrado'}), 404

        status = 'ativado' if force_reset else 'desativado'
        return jsonify({
            'success': True,
            'message': f'Force reset {status} com sucesso'
        }), 200

    except Exception as e:
        current_app.logger.error(f'Erro ao toggle force_reset: {e}', exc_info=True)
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
            # --- Clínico / PS ---
            {'nome': 'painel2',  'titulo': 'Evolução de Turno',        'descricao': 'Acompanhamento de evoluções médicas e de enfermagem',   'ativo': True, 'categoria': 'clinico'},
            {'nome': 'painel3',  'titulo': 'Médicos PS',               'descricao': 'Monitoramento de médicos logados no PS',                 'ativo': True, 'categoria': 'clinico'},
            {'nome': 'painel7',  'titulo': 'Análise Risco Sepse',      'descricao': 'Detecção automática de risco de sepse por critérios',    'ativo': True, 'categoria': 'clinico'},
            {'nome': 'painel8',  'titulo': 'Situação Pacientes',       'descricao': 'Acompanhamento de situação dos pacientes internados',     'ativo': True, 'categoria': 'clinico'},
            {'nome': 'painel9',  'titulo': 'Lab Pendentes',            'descricao': 'Exames laboratoriais pendentes por setor',               'ativo': True, 'categoria': 'clinico'},
            {'nome': 'painel10', 'titulo': 'Painel PS',                'descricao': 'Análise operacional e desempenho do PS',                 'ativo': True, 'categoria': 'clinico'},
            {'nome': 'painel11', 'titulo': 'Painel Internação',        'descricao': 'Pedidos de internação aguardando vaga',                  'ativo': True, 'categoria': 'clinico'},
            {'nome': 'painel17', 'titulo': 'Tempo Atendimento PS',     'descricao': 'Demonstrativo de tempo de espera no PS',                 'ativo': True, 'categoria': 'clinico'},
            {'nome': 'painel18', 'titulo': 'Desempenho Médico PS',     'descricao': 'Demonstrativo de produção médica no PS',                 'ativo': True, 'categoria': 'clinico'},
            {'nome': 'painel22', 'titulo': 'Exames Pendentes PS',      'descricao': 'Jornada e status de exames do paciente no PS',           'ativo': True, 'categoria': 'clinico'},
            {'nome': 'painel25', 'titulo': 'Exames Médico PS',         'descricao': 'Resultados de exames — visão médica do PS',              'ativo': True, 'categoria': 'clinico'},
            # --- Gestão / Ocupação ---
            {'nome': 'painel4',  'titulo': 'Ocupação Hospitalar',      'descricao': 'Monitoramento de ocupação de leitos por setor',          'ativo': True, 'categoria': 'gestao'},
            {'nome': 'painel5',  'titulo': 'Cirurgias do Dia',         'descricao': 'Acompanhamento de cirurgias agendadas e em andamento',   'ativo': True, 'categoria': 'gestao'},
            {'nome': 'painel12', 'titulo': 'Ocupação e Produção',      'descricao': 'Métricas globais de ocupação e produção hospitalar',     'ativo': True, 'categoria': 'gestao'},
            {'nome': 'painel16', 'titulo': 'Desempenho Recepção',      'descricao': 'Filas e performance da recepção hospitalar',             'ativo': True, 'categoria': 'gestao'},
            {'nome': 'painel23', 'titulo': 'Atendimentos Ambulatório', 'descricao': 'Informações de atendimentos ambulatoriais',              'ativo': True, 'categoria': 'gestao'},
            # --- IA / Analytics ---
            {'nome': 'painel6',  'titulo': 'Priorização Clínica IA',  'descricao': 'Análise de risco com IA Groq / Llama 3.3 70B',           'ativo': True, 'categoria': 'ia'},
            {'nome': 'painel27', 'titulo': 'Evolução Clínica',         'descricao': 'Séries temporais de sinais vitais e exames (Chart.js)',  'ativo': True, 'categoria': 'ia'},
            {'nome': 'painel31', 'titulo': 'Central de Machine Learning', 'descricao': 'Hub de modelos ML — previsões, métricas e monitoramento', 'ativo': True, 'categoria': 'ia'},
            {'nome': 'painel32', 'titulo': 'Análise Diária Sentir e Agir', 'descricao': 'Análise de visitas do Projeto Sentir e Agir com IA por setor', 'ativo': True, 'categoria': 'ia'},
            # --- Radiologia ---
            {'nome': 'painel19', 'titulo': 'Radiologia Internados',    'descricao': 'Pendências de imagens de pacientes internados',          'ativo': True, 'categoria': 'radiologia'},
            {'nome': 'painel20', 'titulo': 'Radiologia PS',            'descricao': 'Pendências de imagens no Pronto-Socorro',                'ativo': True, 'categoria': 'radiologia'},
            {'nome': 'painel45', 'titulo': 'Radiologia — Enfermagem',  'descricao': '[Aux] Visualização e ciência de exames pelo setor solicitante', 'ativo': True, 'categoria': 'radiologia'},
            {'nome': 'painel46', 'titulo': 'Radiologia — Operacional', 'descricao': '[Aux] Fila do dia e agenda de horários para a equipe de radiologia', 'ativo': True, 'categoria': 'radiologia'},
            {'nome': 'painel47', 'titulo': 'Radiologia — Gestão',      'descricao': '[Aux] Dashboard, histórico, analytics e exportação',    'ativo': True, 'categoria': 'radiologia'},
            # --- Farmácia / Nutrição ---
            {'nome': 'painel13', 'titulo': 'Mapa de Nutrição',         'descricao': 'Prescrições e pendências nutricionais',                  'ativo': True, 'categoria': 'farmacia'},
            {'nome': 'painel24', 'titulo': 'Estoque Dia',              'descricao': 'Acompanhamento de estoque de medicamentos do dia',       'ativo': True, 'categoria': 'farmacia'},
            {'nome': 'painel38', 'titulo': 'Score Farmacêutico Clínico', 'descricao': 'Priorização de visitas e análise de risco farmacêutico', 'ativo': True, 'categoria': 'farmacia'},
            {'nome': 'painel39', 'titulo': 'Interações Medicamentosas', 'descricao': 'Interações fármaco × dieta ativas no hospital em tempo real', 'ativo': True, 'categoria': 'farmacia'},
            {'nome': 'painel40', 'titulo': 'Requisições Urgentes',     'descricao': 'Requisições urgentes de materiais para Central de Abastecimento', 'ativo': True, 'categoria': 'farmacia'},
            {'nome': 'painel41', 'titulo': 'Nutrição — Solicitar Dieta', 'descricao': '[Aux] Solicitação de dietas e refeições para pacientes internados', 'ativo': True, 'categoria': 'farmacia'},
            {'nome': 'painel42', 'titulo': 'Nutrição — Operacional',   'descricao': '[Aux] Tela da equipe de nutrição para gerenciar fila de dietas', 'ativo': True, 'categoria': 'farmacia'},
            {'nome': 'painel43', 'titulo': 'Nutrição — Gestão',        'descricao': '[Aux] Gestão, relatórios e configurações do sistema de nutrição', 'ativo': True, 'categoria': 'farmacia'},
            # --- Sentir e Agir / Qualidade ---
            {'nome': 'painel28', 'titulo': 'Sentir e Agir — Formulário', 'descricao': 'Formulário de visita e avaliação de qualidade assistencial', 'ativo': True, 'categoria': 'qualidade'},
            {'nome': 'painel29', 'titulo': 'Gestão de Formulários',    'descricao': 'Gestão e acompanhamento de formulários Sentir e Agir',   'ativo': True, 'categoria': 'qualidade'},
            {'nome': 'painel30', 'titulo': 'Gestão de Críticos',       'descricao': 'Tratativas de casos críticos identificados nas visitas',  'ativo': True, 'categoria': 'qualidade'},
            # --- Administrativo ---
            {'nome': 'painel21', 'titulo': 'Status Contas',            'descricao': 'Acompanhamento do ciclo de contas e faturamento HAC',    'ativo': True, 'categoria': 'administrativo'},
            {'nome': 'painel33', 'titulo': 'Autorizações de Convênio', 'descricao': 'Controle de autorizações de planos de saúde com SLA',   'ativo': True, 'categoria': 'administrativo'},
            {'nome': 'painel37', 'titulo': 'Plano Terapêutico Enf.',   'descricao': 'Monitoramento de avaliações 1633 por paciente internado', 'ativo': True, 'categoria': 'administrativo'},
            # --- Sistemas Auxiliares ---
            {'nome': 'painel14', 'titulo': 'Chamados T.I',             'descricao': 'Gerência de chamados emergenciais de TI',                'ativo': True, 'categoria': 'auxiliar'},
            {'nome': 'painel15', 'titulo': 'Abrir Chamados',           'descricao': 'Abertura de chamados de suporte para TI',                'ativo': True, 'categoria': 'auxiliar'},
            {'nome': 'painel26', 'titulo': 'Central de Notificações',  'descricao': 'CRUD de destinatários e regras de notificações push/email', 'ativo': True, 'categoria': 'auxiliar'},
            {'nome': 'painel34', 'titulo': 'Padioleiro — Solicitação', 'descricao': '[Aux] Solicitação de transporte de pacientes',           'ativo': True, 'categoria': 'auxiliar'},
            {'nome': 'painel35', 'titulo': 'Padioleiro — Operacional', 'descricao': '[Aux] Tela do maqueiro — fila e execução de transportes', 'ativo': True, 'categoria': 'auxiliar'},
            {'nome': 'painel36', 'titulo': 'Padioleiro — Gestão',      'descricao': '[Aux] Gestão, relatórios e configurações do padioleiro', 'ativo': True, 'categoria': 'auxiliar'},
            {'nome': 'painel44', 'titulo': 'Hub de Serviços',          'descricao': 'Central de navegação para todos os subsistemas do HAC',  'ativo': True, 'categoria': 'auxiliar'},
        ]

        return jsonify({'success': True, 'paineis': paineis}), 200

    except Exception as e:
        current_app.logger.error(f'Erro ao listar painéis: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500