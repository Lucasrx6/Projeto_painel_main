"""
Painel 3 - Médicos PS
Endpoints para monitoramento de médicos no Pronto Socorro
"""
from flask import Blueprint, jsonify, session, current_app
from datetime import datetime
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_route

# Cria o Blueprint
painel3_bp = Blueprint('painel3', __name__)


@painel3_bp.route('/api/paineis/painel3/medicos', methods=['GET'])
@login_required
@panel_permission_required('painel3')
@cache_route(ttl=60, key_prefix='painel3:medicos')
def get_medicos_ps():
    """
    Retorna lista de médicos ativos no PS
    GET /api/paineis/painel3/medicos
    """
    try:
        with get_db_cursor(use_dict_cursor=False) as cursor:
            query = "SELECT * FROM public.medicos_ps"
            cursor.execute(query)

            colunas = [desc[0] for desc in cursor.description]
            medicos = [dict(zip(colunas, row)) for row in cursor.fetchall()]


            return jsonify({
                'success': True,
                'data': medicos,
                'total': len(medicos),
                'timestamp': datetime.now().isoformat()
            })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar médicos: {e}', exc_info=True)
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500