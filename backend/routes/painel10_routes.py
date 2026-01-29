"""
Painel 10 - Análise do Pronto Socorro
Endpoints para análise de desempenho do PS
"""
from flask import Blueprint, jsonify, send_from_directory, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel10_bp = Blueprint('painel10', __name__)


# =========================================================
# ROTAS DE PÁGINA HTML
# =========================================================

@painel10_bp.route('/painel/painel10')
@login_required
def painel10():
    """Página principal do Painel 10"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel10'):
            current_app.logger.warning(f'Acesso negado ao painel10: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel10', 'index.html')


# =========================================================
# ROTAS DE API
# =========================================================

@painel10_bp.route('/api/paineis/painel10/dashboard', methods=['GET'])
@login_required
def api_painel10_dashboard():
    """
    Dashboard geral do dia
    GET /api/paineis/painel10/dashboard
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel10'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = "SELECT * FROM vw_ps_dashboard_dia"
        cursor.execute(query)
        resultado = cursor.fetchone()

        cursor.close()
        conn.close()

        if not resultado:
            dados = {
                'total_atendimentos_dia': 0,
                'atendimentos_realizados': 0,
                'aguardando_atendimento': 0,
                'pacientes_alta': 0,
                'tempo_medio_permanencia_min': 0,
                'tempo_medio_espera_consulta_min': 0
            }
        else:
            dados = dict(resultado)

        return jsonify({
            'success': True,
            'data': dados,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar dashboard painel10: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@painel10_bp.route('/api/paineis/painel10/tempo-clinica', methods=['GET'])
@login_required
def api_painel10_tempo_clinica():
    """
    Tempo médio de espera por clínica
    GET /api/paineis/painel10/tempo-clinica
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel10'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = "SELECT * FROM vw_ps_tempo_por_clinica"
        cursor.execute(query)
        dados = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': [dict(row) for row in dados],
            'total': len(dados),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar tempo por clínica: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@painel10_bp.route('/api/paineis/painel10/aguardando-clinica', methods=['GET'])
@login_required
def api_painel10_aguardando_clinica():
    """
    Pacientes aguardando por clínica
    GET /api/paineis/painel10/aguardando-clinica
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel10'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = "SELECT * FROM vw_ps_aguardando_por_clinica"
        cursor.execute(query)
        dados = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': [dict(row) for row in dados],
            'total': len(dados),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar aguardando por clínica: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@painel10_bp.route('/api/paineis/painel10/atendimentos-hora', methods=['GET'])
@login_required
def api_painel10_atendimentos_hora():
    """
    Atendimentos por hora do dia
    GET /api/paineis/painel10/atendimentos-hora
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel10'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = "SELECT * FROM vw_ps_atendimentos_por_hora"
        cursor.execute(query)
        dados = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': [dict(row) for row in dados],
            'total': len(dados),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar atendimentos por hora: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@painel10_bp.route('/api/paineis/painel10/desempenho-medico', methods=['GET'])
@login_required
def api_painel10_desempenho_medico():
    """
    Desempenho por médico
    GET /api/paineis/painel10/desempenho-medico
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel10'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = "SELECT * FROM vw_ps_desempenho_medico"
        cursor.execute(query)
        dados = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': [dict(row) for row in dados],
            'total': len(dados),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar desempenho médico: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@painel10_bp.route('/api/paineis/painel10/desempenho-recepcao', methods=['GET'])
@login_required
def api_painel10_desempenho_recepcao():
    """
    Desempenho da recepção
    GET /api/paineis/painel10/desempenho-recepcao
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel10'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = "SELECT * FROM vw_ps_desempenho_recepcao"
        cursor.execute(query)
        resultado = cursor.fetchone()

        cursor.close()
        conn.close()

        if not resultado:
            dados = {
                'total_recebidos': 0,
                'tempo_medio_recepcao_min': 0,
                'aguardando_recepcao': 0
            }
        else:
            dados = dict(resultado)

        return jsonify({
            'success': True,
            'data': dados,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar desempenho recepção: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500