"""
Painel 3 - Médicos PS
Endpoints para monitoramento de médicos no Pronto Socorro
"""
from flask import Blueprint, jsonify, session, current_app
from datetime import datetime
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel3_bp = Blueprint('painel3', __name__, url_prefix='/api/paineis/painel3')


@painel3_bp.route('/medicos', methods=['GET'])
@login_required
def get_medicos_ps():
    """
    Retorna lista de médicos ativos no PS
    GET /api/paineis/painel3/medicos
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel3'):
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
        cursor = conn.cursor()
        query = "SELECT * FROM public.medicos_ps"
        cursor.execute(query)

        colunas = [desc[0] for desc in cursor.description]
        medicos = [dict(zip(colunas, row)) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': medicos,
            'total': len(medicos),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar médicos: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500