"""
Painel 14 - Central de Chamados TI
Endpoints para gestao de chamados pelo tecnico/analista de TI
"""
from flask import Blueprint, jsonify, request, send_from_directory, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel14_bp = Blueprint('painel14', __name__)


# =========================================================
# ROTAS DE PAGINA HTML
# =========================================================

@painel14_bp.route('/painel/painel14')
@login_required
def painel14():
    """Pagina principal do Painel 14 - Central de Chamados TI"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel14'):
            current_app.logger.warning(f'Acesso negado ao painel14: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel14', 'index.html')


# =========================================================
# API - DASHBOARD (ESTATISTICAS GERAIS)
# =========================================================

@painel14_bp.route('/api/paineis/painel14/dashboard', methods=['GET'])
@login_required
def api_painel14_dashboard():
    """
    Estatisticas gerais dos chamados
    GET /api/paineis/painel14/dashboard
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel14'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao com o banco'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM vw_chamados_dashboard")
        resultado = cursor.fetchone()
        cursor.close()
        conn.close()

        dados = dict(resultado) if resultado else {
            'total_abertos': 0,
            'total_em_atendimento': 0,
            'fechados_hoje': 0,
            'nao_visualizados': 0,
            'abertos_hoje': 0,
            'tempo_medio_atendimento_min': 0,
            'total_mes': 0,
            'fechados_mes': 0
        }

        return jsonify({
            'success': True,
            'data': dados,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro dashboard painel14: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# API - LISTAR CHAMADOS ATIVOS
# =========================================================

@painel14_bp.route('/api/paineis/painel14/chamados', methods=['GET'])
@login_required
def api_painel14_chamados():
    """
    Lista chamados ativos (abertos e em atendimento)
    GET /api/paineis/painel14/chamados
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel14'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM vw_chamados_ativos")
        chamados = [dict(row) for row in cursor.fetchall()]

        # Serializar datas para JSON
        for chamado in chamados:
            for campo in ['data_abertura', 'data_visualizacao', 'data_inicio_atendimento', 'data_atualizacao']:
                if chamado.get(campo) and isinstance(chamado[campo], datetime):
                    chamado[campo] = chamado[campo].isoformat()
            # Converter Decimal para float
            if chamado.get('minutos_aberto'):
                chamado['minutos_aberto'] = float(chamado['minutos_aberto'])

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': chamados,
            'total': len(chamados),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro listar chamados painel14: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar chamados'}), 500


# =========================================================
# API - HISTORICO DE CHAMADOS (FECHADOS/INATIVOS)
# =========================================================

@painel14_bp.route('/api/paineis/painel14/historico', methods=['GET'])
@login_required
def api_painel14_historico():
    """
    Lista chamados fechados e inativos (ultimos 7 dias)
    GET /api/paineis/painel14/historico?dias=7
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel14'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dias = request.args.get('dias', 7, type=int)
    if dias > 90:
        dias = 90

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT
                id, numero_kora, nome_solicitante, local_problema,
                observacao_abertura, data_abertura, tecnico_atendimento,
                observacao_fechamento, data_fechamento, status, prioridade,
                EXTRACT(EPOCH FROM (COALESCE(data_fechamento, NOW()) - data_abertura)) / 60 AS minutos_total
            FROM chamados
            WHERE status IN ('fechado', 'inativo')
              AND data_abertura >= NOW() - INTERVAL '%s days'
            ORDER BY data_fechamento DESC NULLS LAST
        """ % dias)  # Seguro pois dias ja e int validado

        chamados = [dict(row) for row in cursor.fetchall()]

        for chamado in chamados:
            for campo in ['data_abertura', 'data_fechamento']:
                if chamado.get(campo) and isinstance(chamado[campo], datetime):
                    chamado[campo] = chamado[campo].isoformat()
            if chamado.get('minutos_total'):
                chamado['minutos_total'] = float(chamado['minutos_total'])

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': chamados,
            'total': len(chamados),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro historico painel14: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar historico'}), 500


# =========================================================
# API - MARCAR COMO VISUALIZADO
# =========================================================

@painel14_bp.route('/api/paineis/painel14/chamados/<int:chamado_id>/visualizar', methods=['PUT'])
@login_required
def api_painel14_visualizar(chamado_id):
    """
    Marca chamado como visualizado pelo tecnico
    PUT /api/paineis/painel14/chamados/<id>/visualizar
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    usuario_nome = session.get('usuario', 'sistema')

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel14'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Verifica se existe e nao foi visualizado
        cursor.execute("SELECT id, visualizado FROM chamados WHERE id = %s", (chamado_id,))
        chamado = cursor.fetchone()

        if not chamado:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Chamado nao encontrado'}), 404

        if chamado['visualizado']:
            cursor.close()
            conn.close()
            return jsonify({'success': True, 'message': 'Chamado ja visualizado'})

        cursor.execute("""
            UPDATE chamados
            SET visualizado = TRUE,
                data_visualizacao = NOW(),
                atualizado_por = %s
            WHERE id = %s
        """, (usuario_nome, chamado_id))

        conn.commit()
        cursor.close()
        conn.close()

        current_app.logger.info(f'Chamado {chamado_id} visualizado por {usuario_nome}')

        return jsonify({
            'success': True,
            'message': 'Chamado marcado como visualizado'
        })

    except Exception as e:
        current_app.logger.error(f'Erro visualizar chamado {chamado_id}: {e}', exc_info=True)
        if conn:
            conn.rollback()
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao atualizar chamado'}), 500


# =========================================================
# API - INICIAR ATENDIMENTO
# =========================================================

@painel14_bp.route('/api/paineis/painel14/chamados/<int:chamado_id>/atender', methods=['PUT'])
@login_required
def api_painel14_atender(chamado_id):
    """
    Inicia atendimento de um chamado
    PUT /api/paineis/painel14/chamados/<id>/atender
    Body: { "tecnico": "Nome do Tecnico" }
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    usuario_nome = session.get('usuario', 'sistema')

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel14'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados = request.get_json()
    if not dados:
        return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400

    tecnico = (dados.get('tecnico') or '').strip()
    if not tecnico:
        return jsonify({'success': False, 'error': 'Nome do tecnico e obrigatorio'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Verifica status atual
        cursor.execute("SELECT id, status FROM chamados WHERE id = %s", (chamado_id,))
        chamado = cursor.fetchone()

        if not chamado:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Chamado nao encontrado'}), 404

        if chamado['status'] not in ('aberto', 'em_atendimento'):
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Chamado nao pode ser atendido no status atual'}), 400

        cursor.execute("""
            UPDATE chamados
            SET status = 'em_atendimento',
                tecnico_atendimento = %s,
                data_inicio_atendimento = COALESCE(data_inicio_atendimento, NOW()),
                visualizado = TRUE,
                data_visualizacao = COALESCE(data_visualizacao, NOW()),
                atualizado_por = %s
            WHERE id = %s
        """, (tecnico, usuario_nome, chamado_id))

        conn.commit()
        cursor.close()
        conn.close()

        current_app.logger.info(f'Chamado {chamado_id} em atendimento por {tecnico}')

        return jsonify({
            'success': True,
            'message': f'Atendimento iniciado por {tecnico}'
        })

    except Exception as e:
        current_app.logger.error(f'Erro atender chamado {chamado_id}: {e}', exc_info=True)
        if conn:
            conn.rollback()
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao iniciar atendimento'}), 500


# =========================================================
# API - FECHAR CHAMADO
# =========================================================

@painel14_bp.route('/api/paineis/painel14/chamados/<int:chamado_id>/fechar', methods=['PUT'])
@login_required
def api_painel14_fechar(chamado_id):
    """
    Fecha um chamado (obrigatorio tecnico + observacao)
    PUT /api/paineis/painel14/chamados/<id>/fechar
    Body: { "tecnico": "Nome", "observacao": "Descricao do atendimento" }
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    usuario_nome = session.get('usuario', 'sistema')

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel14'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados = request.get_json()
    if not dados:
        return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400

    tecnico = (dados.get('tecnico') or '').strip()
    observacao = (dados.get('observacao') or '').strip()

    # Validacoes obrigatorias
    if not tecnico:
        return jsonify({'success': False, 'error': 'Nome do tecnico e obrigatorio para fechar o chamado'}), 400

    if not observacao:
        return jsonify({'success': False, 'error': 'Observacao e obrigatoria para fechar o chamado'}), 400

    if len(observacao) < 10:
        return jsonify({'success': False, 'error': 'Observacao deve ter pelo menos 10 caracteres'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Verifica status atual
        cursor.execute("SELECT id, status FROM chamados WHERE id = %s", (chamado_id,))
        chamado = cursor.fetchone()

        if not chamado:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Chamado nao encontrado'}), 404

        if chamado['status'] in ('fechado', 'inativo'):
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Chamado ja esta fechado ou inativo'}), 400

        cursor.execute("""
            UPDATE chamados
            SET status = 'fechado',
                tecnico_atendimento = %s,
                observacao_fechamento = %s,
                data_fechamento = NOW(),
                data_inicio_atendimento = COALESCE(data_inicio_atendimento, NOW()),
                visualizado = TRUE,
                data_visualizacao = COALESCE(data_visualizacao, NOW()),
                atualizado_por = %s
            WHERE id = %s
        """, (tecnico, observacao, usuario_nome, chamado_id))

        conn.commit()
        cursor.close()
        conn.close()

        current_app.logger.info(f'Chamado {chamado_id} fechado por {tecnico}')

        return jsonify({
            'success': True,
            'message': 'Chamado fechado com sucesso'
        })

    except Exception as e:
        current_app.logger.error(f'Erro fechar chamado {chamado_id}: {e}', exc_info=True)
        if conn:
            conn.rollback()
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao fechar chamado'}), 500


# =========================================================
# API - INATIVAR CHAMADO
# =========================================================

@painel14_bp.route('/api/paineis/painel14/chamados/<int:chamado_id>/inativar', methods=['PUT'])
@login_required
def api_painel14_inativar(chamado_id):
    """
    Inativa um chamado (nao exclui, apenas muda status)
    PUT /api/paineis/painel14/chamados/<id>/inativar
    Body: { "motivo": "Motivo da inativacao" }
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    usuario_nome = session.get('usuario', 'sistema')

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel14'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados = request.get_json()
    motivo = (dados.get('motivo') or '').strip() if dados else ''

    if not motivo:
        return jsonify({'success': False, 'error': 'Motivo da inativacao e obrigatorio'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("SELECT id, status FROM chamados WHERE id = %s", (chamado_id,))
        chamado = cursor.fetchone()

        if not chamado:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Chamado nao encontrado'}), 404

        if chamado['status'] == 'inativo':
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Chamado ja esta inativo'}), 400

        cursor.execute("""
            UPDATE chamados
            SET status = 'inativo',
                observacao_fechamento = COALESCE(observacao_fechamento, '') || ' | INATIVADO: ' || %s,
                data_fechamento = NOW(),
                atualizado_por = %s
            WHERE id = %s
        """, (motivo, usuario_nome, chamado_id))

        conn.commit()
        cursor.close()
        conn.close()

        current_app.logger.info(f'Chamado {chamado_id} inativado por {usuario_nome}: {motivo}')

        return jsonify({
            'success': True,
            'message': 'Chamado inativado com sucesso'
        })

    except Exception as e:
        current_app.logger.error(f'Erro inativar chamado {chamado_id}: {e}', exc_info=True)
        if conn:
            conn.rollback()
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao inativar chamado'}), 500


# =========================================================
# API - ADICIONAR OBSERVACAO
# =========================================================

@painel14_bp.route('/api/paineis/painel14/chamados/<int:chamado_id>/observacao', methods=['PUT'])
@login_required
def api_painel14_observacao(chamado_id):
    """
    Adiciona observacao a um chamado ativo
    PUT /api/paineis/painel14/chamados/<id>/observacao
    Body: { "observacao": "Texto da observacao" }
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    usuario_nome = session.get('usuario', 'sistema')

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel14'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados = request.get_json()
    observacao = (dados.get('observacao') or '').strip() if dados else ''

    if not observacao:
        return jsonify({'success': False, 'error': 'Observacao e obrigatoria'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("SELECT id, status FROM chamados WHERE id = %s", (chamado_id,))
        chamado = cursor.fetchone()

        if not chamado:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Chamado nao encontrado'}), 404

        if chamado['status'] in ('fechado', 'inativo'):
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Nao e possivel adicionar observacao a chamados fechados'}), 400

        # Registra no historico
        cursor.execute("""
            INSERT INTO chamados_historico (chamado_id, acao, descricao, usuario)
            VALUES (%s, 'observacao', %s, %s)
        """, (chamado_id, observacao, usuario_nome))

        # Atualiza timestamp
        cursor.execute("""
            UPDATE chamados SET atualizado_por = %s WHERE id = %s
        """, (usuario_nome, chamado_id))

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'message': 'Observacao registrada com sucesso'
        })

    except Exception as e:
        current_app.logger.error(f'Erro observacao chamado {chamado_id}: {e}', exc_info=True)
        if conn:
            conn.rollback()
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao registrar observacao'}), 500


# =========================================================
# API - HISTORICO DE UM CHAMADO ESPECIFICO
# =========================================================

@painel14_bp.route('/api/paineis/painel14/chamados/<int:chamado_id>/historico', methods=['GET'])
@login_required
def api_painel14_chamado_historico(chamado_id):
    """
    Retorna historico de acoes de um chamado especifico
    GET /api/paineis/painel14/chamados/<id>/historico
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel14'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, acao, status_anterior, status_novo, descricao, usuario, data_registro
            FROM chamados_historico
            WHERE chamado_id = %s
            ORDER BY data_registro ASC
        """, (chamado_id,))

        historico = [dict(row) for row in cursor.fetchall()]

        for item in historico:
            if item.get('data_registro') and isinstance(item['data_registro'], datetime):
                item['data_registro'] = item['data_registro'].isoformat()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': historico,
            'total': len(historico)
        })

    except Exception as e:
        current_app.logger.error(f'Erro historico chamado {chamado_id}: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar historico'}), 500


# =========================================================
# API - CONFIGURACOES DE ALERTA
# =========================================================

@painel14_bp.route('/api/paineis/painel14/config', methods=['GET'])
@login_required
def api_painel14_config():
    """
    Retorna configuracoes do painel de chamados
    GET /api/paineis/painel14/config
    """
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT chave, valor, descricao FROM chamados_config")
        configs = {row['chave']: row['valor'] for row in cursor.fetchall()}
        cursor.close()
        conn.close()

        return jsonify({'success': True, 'data': configs})

    except Exception as e:
        current_app.logger.error(f'Erro config painel14: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar configuracoes'}), 500


@painel14_bp.route('/api/paineis/painel14/config', methods=['PUT'])
@login_required
def api_painel14_config_update():
    """
    Atualiza configuracao do painel
    PUT /api/paineis/painel14/config
    Body: { "chave": "som_alerta_ativo", "valor": "false" }
    """
    dados = request.get_json()
    if not dados or not dados.get('chave') or dados.get('valor') is None:
        return jsonify({'success': False, 'error': 'Chave e valor sao obrigatorios'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE chamados_config
            SET valor = %s, data_atualizacao = NOW()
            WHERE chave = %s
        """, (str(dados['valor']), dados['chave']))

        if cursor.rowcount == 0:
            conn.rollback()
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Configuracao nao encontrada'}), 404

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({'success': True, 'message': 'Configuracao atualizada'})

    except Exception as e:
        current_app.logger.error(f'Erro atualizar config painel14: {e}', exc_info=True)
        if conn:
            conn.rollback()
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao atualizar configuracao'}), 500


# =========================================================
# API - CONTAGEM RAPIDA (PARA POLLING LEVE)
# =========================================================

@painel14_bp.route('/api/paineis/painel14/contagem', methods=['GET'])
@login_required
def api_painel14_contagem():
    """
    Retorna apenas contagem de chamados nao visualizados (polling leve)
    GET /api/paineis/painel14/contagem
    """
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT
                COUNT(*) FILTER (WHERE status = 'aberto' AND visualizado = FALSE) AS novos,
                COUNT(*) FILTER (WHERE status IN ('aberto', 'em_atendimento')) AS ativos
            FROM chamados
        """)
        resultado = cursor.fetchone()
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'novos': resultado['novos'] if resultado else 0,
            'ativos': resultado['ativos'] if resultado else 0,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro contagem painel14: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro'}), 500


# =========================================================
# GERENCIAMENTO DE LOCAIS PADRONIZADOS
# Adicionar ao final do painel14_routes.py
# =========================================================

@painel14_bp.route('/api/paineis/painel14/locais', methods=['GET'])
@login_required
def api_painel14_locais():
    """Lista todos os locais cadastrados (ativos e inativos)"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel14'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, setor, local, hostname, ip, ativo,
                   data_criacao, data_atualizacao
            FROM chamados_locais
            ORDER BY setor, local
        """)
        locais = [dict(row) for row in cursor.fetchall()]
        for loc in locais:
            for campo in ['data_criacao', 'data_atualizacao']:
                if loc.get(campo) and isinstance(loc[campo], datetime):
                    loc[campo] = loc[campo].isoformat()

        cursor.close()
        conn.close()
        return jsonify({'success': True, 'data': locais, 'total': len(locais)})

    except Exception as e:
        current_app.logger.error(f'Erro listar locais: {e}', exc_info=True)
        if conn: conn.close()
        return jsonify({'success': False, 'error': 'Erro ao listar locais'}), 500


@painel14_bp.route('/api/paineis/painel14/locais', methods=['POST'])
@login_required
def api_painel14_locais_criar():
    """Cria um novo local padronizado"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel14'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados = request.get_json()
    if not dados:
        return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400

    setor = (dados.get('setor') or '').strip()
    local = (dados.get('local') or '').strip()
    hostname = (dados.get('hostname') or '').strip() or None
    ip = (dados.get('ip') or '').strip() or None

    if not setor:
        return jsonify({'success': False, 'error': 'Setor e obrigatorio'}), 400
    if not local:
        return jsonify({'success': False, 'error': 'Local e obrigatorio'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Verificar duplicata ativa
        cursor.execute("""
            SELECT id FROM chamados_locais
            WHERE LOWER(setor) = LOWER(%s) AND LOWER(local) = LOWER(%s) AND ativo = TRUE
        """, (setor, local))
        if cursor.fetchone():
            cursor.close(); conn.close()
            return jsonify({'success': False, 'error': 'Ja existe um local ativo com este Setor e Local'}), 409

        cursor.execute("""
            INSERT INTO chamados_locais (setor, local, hostname, ip)
            VALUES (%s, %s, %s, %s)
            RETURNING id, setor, local, hostname, ip, ativo
        """, (setor, local, hostname, ip))
        novo = dict(cursor.fetchone())
        conn.commit()
        cursor.close(); conn.close()

        current_app.logger.info(f'Local criado: {setor} / {local} ({hostname})')
        return jsonify({'success': True, 'message': 'Local cadastrado com sucesso', 'data': novo}), 201

    except Exception as e:
        current_app.logger.error(f'Erro criar local: {e}', exc_info=True)
        if conn: conn.rollback(); conn.close()
        return jsonify({'success': False, 'error': 'Erro ao cadastrar local'}), 500


@painel14_bp.route('/api/paineis/painel14/locais/<int:local_id>', methods=['PUT'])
@login_required
def api_painel14_locais_editar(local_id):
    """Edita um local existente"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel14'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados = request.get_json()
    if not dados:
        return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400

    setor = (dados.get('setor') or '').strip()
    local = (dados.get('local') or '').strip()
    hostname = (dados.get('hostname') or '').strip() or None
    ip = (dados.get('ip') or '').strip() or None

    if not setor or not local:
        return jsonify({'success': False, 'error': 'Setor e Local sao obrigatorios'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Verificar duplicata (excluindo o proprio registro)
        cursor.execute("""
            SELECT id FROM chamados_locais
            WHERE LOWER(setor) = LOWER(%s) AND LOWER(local) = LOWER(%s) AND ativo = TRUE AND id != %s
        """, (setor, local, local_id))
        if cursor.fetchone():
            cursor.close(); conn.close()
            return jsonify({'success': False, 'error': 'Ja existe outro local ativo com este Setor e Local'}), 409

        cursor.execute("""
            UPDATE chamados_locais
            SET setor = %s, local = %s, hostname = %s, ip = %s
            WHERE id = %s
            RETURNING id, setor, local, hostname, ip, ativo
        """, (setor, local, hostname, ip, local_id))
        atualizado = cursor.fetchone()

        if not atualizado:
            cursor.close(); conn.close()
            return jsonify({'success': False, 'error': 'Local nao encontrado'}), 404

        conn.commit()
        cursor.close(); conn.close()
        return jsonify({'success': True, 'message': 'Local atualizado', 'data': dict(atualizado)})

    except Exception as e:
        current_app.logger.error(f'Erro editar local {local_id}: {e}', exc_info=True)
        if conn: conn.rollback(); conn.close()
        return jsonify({'success': False, 'error': 'Erro ao editar local'}), 500


@painel14_bp.route('/api/paineis/painel14/locais/<int:local_id>', methods=['DELETE'])
@login_required
def api_painel14_locais_remover(local_id):
    """Ativa/desativa um local (soft delete)"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel14'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT id, ativo FROM chamados_locais WHERE id = %s", (local_id,))
        registro = cursor.fetchone()

        if not registro:
            cursor.close(); conn.close()
            return jsonify({'success': False, 'error': 'Local nao encontrado'}), 404

        novo_ativo = not registro['ativo']
        cursor.execute("UPDATE chamados_locais SET ativo = %s WHERE id = %s", (novo_ativo, local_id))
        conn.commit()
        cursor.close(); conn.close()

        msg = 'Local reativado' if novo_ativo else 'Local desativado'
        return jsonify({'success': True, 'message': msg, 'ativo': novo_ativo})

    except Exception as e:
        current_app.logger.error(f'Erro remover local {local_id}: {e}', exc_info=True)
        if conn: conn.rollback(); conn.close()
        return jsonify({'success': False, 'error': 'Erro ao alterar local'}), 500


# =========================================================
# GERENCIAMENTO DE TIPOS DE PROBLEMA
# =========================================================

@painel14_bp.route('/api/paineis/painel14/problemas', methods=['GET'])
@login_required
def api_painel14_problemas():
    """Lista todos os tipos de problema"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel14'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, descricao, ativo, data_criacao, data_atualizacao
            FROM chamados_problemas
            ORDER BY descricao
        """)
        problemas = [dict(row) for row in cursor.fetchall()]
        for p in problemas:
            for campo in ['data_criacao', 'data_atualizacao']:
                if p.get(campo) and isinstance(p[campo], datetime):
                    p[campo] = p[campo].isoformat()
        cursor.close(); conn.close()
        return jsonify({'success': True, 'data': problemas, 'total': len(problemas)})

    except Exception as e:
        current_app.logger.error(f'Erro listar problemas: {e}', exc_info=True)
        if conn: conn.close()
        return jsonify({'success': False, 'error': 'Erro ao listar problemas'}), 500


@painel14_bp.route('/api/paineis/painel14/problemas', methods=['POST'])
@login_required
def api_painel14_problemas_criar():
    """Cria novo tipo de problema"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel14'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados = request.get_json()
    descricao = (dados.get('descricao') or '').strip() if dados else ''
    if not descricao:
        return jsonify({'success': False, 'error': 'Descricao e obrigatoria'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id FROM chamados_problemas
            WHERE LOWER(descricao) = LOWER(%s) AND ativo = TRUE
        """, (descricao,))
        if cursor.fetchone():
            cursor.close(); conn.close()
            return jsonify({'success': False, 'error': 'Tipo de problema ja existe'}), 409

        cursor.execute("""
            INSERT INTO chamados_problemas (descricao)
            VALUES (%s)
            RETURNING id, descricao, ativo
        """, (descricao,))
        novo = dict(cursor.fetchone())
        conn.commit()
        cursor.close(); conn.close()
        return jsonify({'success': True, 'message': 'Problema cadastrado', 'data': novo}), 201

    except Exception as e:
        current_app.logger.error(f'Erro criar problema: {e}', exc_info=True)
        if conn: conn.rollback(); conn.close()
        return jsonify({'success': False, 'error': 'Erro ao cadastrar problema'}), 500


@painel14_bp.route('/api/paineis/painel14/problemas/<int:problema_id>', methods=['PUT'])
@login_required
def api_painel14_problemas_editar(problema_id):
    """Edita tipo de problema"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel14'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados = request.get_json()
    descricao = (dados.get('descricao') or '').strip() if dados else ''
    if not descricao:
        return jsonify({'success': False, 'error': 'Descricao e obrigatoria'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id FROM chamados_problemas
            WHERE LOWER(descricao) = LOWER(%s) AND ativo = TRUE AND id != %s
        """, (descricao, problema_id))
        if cursor.fetchone():
            cursor.close(); conn.close()
            return jsonify({'success': False, 'error': 'Ja existe outro problema com esta descricao'}), 409

        cursor.execute("""
            UPDATE chamados_problemas SET descricao = %s WHERE id = %s
            RETURNING id, descricao, ativo
        """, (descricao, problema_id))
        atualizado = cursor.fetchone()
        if not atualizado:
            cursor.close(); conn.close()
            return jsonify({'success': False, 'error': 'Problema nao encontrado'}), 404

        conn.commit()
        cursor.close(); conn.close()
        return jsonify({'success': True, 'message': 'Problema atualizado', 'data': dict(atualizado)})

    except Exception as e:
        current_app.logger.error(f'Erro editar problema {problema_id}: {e}', exc_info=True)
        if conn: conn.rollback(); conn.close()
        return jsonify({'success': False, 'error': 'Erro ao editar problema'}), 500


@painel14_bp.route('/api/paineis/painel14/problemas/<int:problema_id>', methods=['DELETE'])
@login_required
def api_painel14_problemas_remover(problema_id):
    """Ativa/desativa tipo de problema"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel14'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT id, ativo FROM chamados_problemas WHERE id = %s", (problema_id,))
        registro = cursor.fetchone()
        if not registro:
            cursor.close(); conn.close()
            return jsonify({'success': False, 'error': 'Problema nao encontrado'}), 404

        novo_ativo = not registro['ativo']
        cursor.execute("UPDATE chamados_problemas SET ativo = %s WHERE id = %s", (novo_ativo, problema_id))
        conn.commit()
        cursor.close(); conn.close()
        return jsonify({'success': True, 'message': 'Reativado' if novo_ativo else 'Desativado', 'ativo': novo_ativo})

    except Exception as e:
        current_app.logger.error(f'Erro remover problema {problema_id}: {e}', exc_info=True)
        if conn: conn.rollback(); conn.close()
        return jsonify({'success': False, 'error': 'Erro'}), 500