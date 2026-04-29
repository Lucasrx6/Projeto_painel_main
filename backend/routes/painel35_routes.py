"""
Painel 35 - Tela do Padioleiro
Endpoints para o padioleiro gerenciar a fila e executar transportes
"""
from flask import Blueprint, jsonify, request, send_from_directory, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

painel35_bp = Blueprint('painel35', __name__)


@painel35_bp.route('/painel/painel35')
@login_required
def painel35():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel35'):
            current_app.logger.warning(f'Acesso negado ao painel35: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')
    return send_from_directory('paineis/painel35', 'index.html')


# =========================================================
# API - LISTAR PADIOLEIROS ATIVOS
# =========================================================

@painel35_bp.route('/api/paineis/painel35/padioleiros', methods=['GET'])
@login_required
def api_painel35_padioleiros():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel35'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, nome, matricula, turno
            FROM padioleiro_cadastros
            WHERE ativo = TRUE
            ORDER BY nome
        """)
        padioleiros = [dict(r) for r in cursor.fetchall()]
        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'padioleiros': padioleiros})
    except Exception as e:
        current_app.logger.error(f'Erro padioleiros painel35: {e}', exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar padioleiros'}), 500


# =========================================================
# API - FILA DE CHAMADOS
# =========================================================

@painel35_bp.route('/api/paineis/painel35/fila', methods=['GET'])
@login_required
def api_painel35_fila():
    """Retorna: fila aguardando + chamado ativo do padioleiro (se informado)"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel35'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    padioleiro_id = request.args.get('padioleiro_id')
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT
                id, tipo_movimento_nome, nm_paciente, nr_atendimento,
                leito_origem, setor_origem_nome, destino_nome, destino_complemento,
                prioridade, status, solicitante_nome, observacao,
                criado_em, dt_aceite,
                ROUND(EXTRACT(EPOCH FROM (NOW() - criado_em)) / 60, 1) AS minutos_espera
            FROM padioleiro_chamados
            WHERE status = 'aguardando'
            ORDER BY
                CASE prioridade WHEN 'urgente' THEN 0 ELSE 1 END,
                criado_em ASC
        """)
        aguardando = []
        for row in cursor.fetchall():
            c = dict(row)
            for campo in ['criado_em', 'dt_aceite']:
                if c.get(campo) and isinstance(c[campo], datetime):
                    c[campo] = c[campo].isoformat()
            if c.get('minutos_espera') is not None:
                c['minutos_espera'] = float(c['minutos_espera'])
            aguardando.append(c)

        chamado_ativo = None
        if padioleiro_id:
            cursor.execute("""
                SELECT
                    id, tipo_movimento_nome, nm_paciente, nr_atendimento,
                    leito_origem, setor_origem_nome, destino_nome, destino_complemento,
                    prioridade, status, solicitante_nome, observacao,
                    criado_em, dt_aceite, dt_inicio_transporte,
                    ROUND(EXTRACT(EPOCH FROM (NOW() - criado_em)) / 60, 1) AS minutos_espera
                FROM padioleiro_chamados
                WHERE padioleiro_id = %s AND status IN ('aceito', 'em_transporte')
                ORDER BY dt_aceite DESC
                LIMIT 1
            """, (padioleiro_id,))
            row = cursor.fetchone()
            if row:
                c = dict(row)
                for campo in ['criado_em', 'dt_aceite', 'dt_inicio_transporte']:
                    if c.get(campo) and isinstance(c[campo], datetime):
                        c[campo] = c[campo].isoformat()
                if c.get('minutos_espera') is not None:
                    c['minutos_espera'] = float(c['minutos_espera'])
                chamado_ativo = c

        cursor.close()
        release_connection(conn)
        return jsonify({
            'success': True,
            'aguardando': aguardando,
            'chamado_ativo': chamado_ativo,
            'total_fila': len(aguardando),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro fila painel35: {e}', exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar fila'}), 500


# =========================================================
# API - ACEITAR CHAMADO
# =========================================================

@painel35_bp.route('/api/paineis/painel35/chamados/<int:chamado_id>/aceitar', methods=['PUT'])
@login_required
def api_painel35_aceitar(chamado_id):
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel35'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados = request.get_json() or {}
    padioleiro_id = dados.get('padioleiro_id')
    if not padioleiro_id:
        return jsonify({'success': False, 'error': 'Informe o padioleiro_id'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT id FROM padioleiro_chamados
            WHERE padioleiro_id = %s AND status IN ('aceito', 'em_transporte')
            LIMIT 1
        """, (padioleiro_id,))
        if cursor.fetchone():
            cursor.close()
            release_connection(conn)
            return jsonify({
                'success': False,
                'error': 'Voce ja possui um chamado em andamento. Conclua-o antes de aceitar outro.'
            }), 400

        cursor.execute("SELECT nome FROM padioleiro_cadastros WHERE id = %s AND ativo = TRUE", (padioleiro_id,))
        pad = cursor.fetchone()
        if not pad:
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Padioleiro nao encontrado'}), 404

        cursor.execute("""
            UPDATE padioleiro_chamados
            SET status = 'aceito',
                padioleiro_id = %s,
                padioleiro_nome = %s,
                dt_aceite = NOW(),
                atualizado_em = NOW()
            WHERE id = %s AND status = 'aguardando'
            RETURNING id
        """, (padioleiro_id, pad['nome'], chamado_id))

        updated = cursor.fetchone()
        if not updated:
            conn.rollback()
            cursor.close()
            release_connection(conn)
            return jsonify({
                'success': False,
                'error': 'Chamado nao disponivel (ja aceito por outro padioleiro)'
            }), 409

        conn.commit()
        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'message': 'Chamado aceito com sucesso'})

    except Exception as e:
        current_app.logger.error(f'Erro aceitar painel35: {e}', exc_info=True)
        if conn:
            conn.rollback()
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao aceitar chamado'}), 500


# =========================================================
# API - INICIAR TRANSPORTE
# =========================================================

@painel35_bp.route('/api/paineis/painel35/chamados/<int:chamado_id>/iniciar', methods=['PUT'])
@login_required
def api_painel35_iniciar(chamado_id):
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel35'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE padioleiro_chamados
            SET status = 'em_transporte',
                dt_inicio_transporte = NOW(),
                atualizado_em = NOW()
            WHERE id = %s AND status = 'aceito'
            RETURNING id
        """, (chamado_id,))

        if not cursor.fetchone():
            conn.rollback()
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Chamado nao pode ser iniciado no status atual'}), 400

        conn.commit()
        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'message': 'Transporte iniciado'})

    except Exception as e:
        current_app.logger.error(f'Erro iniciar painel35: {e}', exc_info=True)
        if conn:
            conn.rollback()
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao iniciar transporte'}), 500


# =========================================================
# API - CONCLUIR TRANSPORTE
# =========================================================

@painel35_bp.route('/api/paineis/painel35/chamados/<int:chamado_id>/concluir', methods=['PUT'])
@login_required
def api_painel35_concluir(chamado_id):
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel35'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE padioleiro_chamados
            SET status = 'concluido',
                dt_conclusao = NOW(),
                atualizado_em = NOW()
            WHERE id = %s AND status = 'em_transporte'
            RETURNING id
        """, (chamado_id,))

        if not cursor.fetchone():
            conn.rollback()
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Chamado nao pode ser concluido no status atual'}), 400

        conn.commit()
        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'message': 'Transporte concluido com sucesso'})

    except Exception as e:
        current_app.logger.error(f'Erro concluir painel35: {e}', exc_info=True)
        if conn:
            conn.rollback()
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao concluir transporte'}), 500


# =========================================================
# API - CANCELAR CHAMADO (Padioleiro)
# =========================================================

@painel35_bp.route('/api/paineis/painel35/chamados/<int:chamado_id>/cancelar', methods=['PUT'])
@login_required
def api_painel35_cancelar(chamado_id):
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel35'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados = request.get_json() or {}
    padioleiro_id = dados.get('padioleiro_id')
    motivo = (dados.get('motivo') or '').strip()

    if not padioleiro_id:
        return jsonify({'success': False, 'error': 'Informe o padioleiro_id'}), 400
    
    if len(motivo) < 10:
        return jsonify({'success': False, 'error': 'O motivo do cancelamento deve ter pelo menos 10 caracteres'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # O padioleiro so pode cancelar chamados que estao aguardando (se estiver puxando da fila)
        # ou que estao aceitos/em_transporte (se ele ja assumiu). Mas por seguranca, garantimos
        # que ele nao pode cancelar chamados de OUTROS padioleiros.
        cursor.execute("SELECT status, padioleiro_id FROM padioleiro_chamados WHERE id = %s", (chamado_id,))
        chamado = cursor.fetchone()
        
        if not chamado:
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Chamado nao encontrado'}), 404

        if chamado['status'] not in ('aguardando', 'aceito', 'em_transporte'):
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': f'Chamado nao pode ser cancelado no status atual: {chamado["status"]}'}), 400
            
        if chamado['padioleiro_id'] is not None and str(chamado['padioleiro_id']) != str(padioleiro_id):
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Este chamado ja esta sob responsabilidade de outro padioleiro'}), 403

        cursor.execute("""
            UPDATE padioleiro_chamados
            SET status = 'cancelado',
                dt_cancelamento = NOW(),
                motivo_cancelamento = %s,
                atualizado_em = NOW()
            WHERE id = %s
        """, (f"[Cancelado pelo Padioleiro] {motivo}", chamado_id))

        conn.commit()
        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'message': 'Chamado cancelado com sucesso'})

    except Exception as e:
        current_app.logger.error(f'Erro cancelar painel35: {e}', exc_info=True)
        if conn:
            conn.rollback()
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao cancelar chamado'}), 500


# =========================================================
# API - HISTORICO DO PADIOLEIRO (dia atual)
# =========================================================

@painel35_bp.route('/api/paineis/painel35/historico-hoje', methods=['GET'])
@login_required
def api_painel35_historico_hoje():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel35'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    padioleiro_id = request.args.get('padioleiro_id')
    if not padioleiro_id:
        return jsonify({'success': False, 'error': 'Informe o padioleiro_id'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT
                id, tipo_movimento_nome, nm_paciente, nr_atendimento,
                leito_origem, setor_origem_nome, destino_nome,
                prioridade, status,
                criado_em, dt_aceite, dt_inicio_transporte, dt_conclusao,
                CASE
                    WHEN dt_conclusao IS NOT NULL AND dt_inicio_transporte IS NOT NULL
                    THEN ROUND(EXTRACT(EPOCH FROM (dt_conclusao - dt_inicio_transporte)) / 60, 1)
                END AS tempo_transporte_min
            FROM padioleiro_chamados
            WHERE padioleiro_id = %s
              AND criado_em >= CURRENT_DATE
            ORDER BY criado_em DESC
        """, (padioleiro_id,))

        chamados = []
        for row in cursor.fetchall():
            c = dict(row)
            for campo in ['criado_em', 'dt_aceite', 'dt_inicio_transporte', 'dt_conclusao']:
                if c.get(campo) and isinstance(c[campo], datetime):
                    c[campo] = c[campo].isoformat()
            if c.get('tempo_transporte_min') is not None:
                c['tempo_transporte_min'] = float(c['tempo_transporte_min'])
            chamados.append(c)

        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'chamados': chamados, 'total': len(chamados)})

    except Exception as e:
        current_app.logger.error(f'Erro historico-hoje painel35: {e}', exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar historico'}), 500
