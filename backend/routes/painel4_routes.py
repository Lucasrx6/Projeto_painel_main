"""
Painel 4 - Ocupação Hospitalar
Endpoints para monitoramento de ocupação de leitos e setores
"""
from flask import Blueprint, jsonify, send_from_directory, session, current_app
from datetime import datetime
from backend.database import get_db_cursor
from psycopg2.extras import RealDictCursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_route

# Cria o Blueprint
painel4_bp = Blueprint('painel4', __name__)


# =========================================================
# ROTAS DE PÁGINA HTML
# =========================================================

@painel4_bp.route('/painel/painel4')
@login_required
@panel_permission_required('painel4')
def painel4():
    """Página principal do Painel 4"""
    return send_from_directory('paineis/painel4', 'index.html')


@painel4_bp.route('/painel/painel4/detalhes')
@login_required
@panel_permission_required('painel4')
def painel4_detalhes():
    """Página de detalhes do Painel 4"""
    return send_from_directory('paineis/painel4', 'detalhes.html')


# =========================================================
# ROTAS DE API
# =========================================================

@painel4_bp.route('/api/paineis/painel4/dashboard', methods=['GET'])
@login_required
@panel_permission_required('painel4')
@cache_route(ttl=180, key_prefix='painel4:dashboard')
def api_painel4_dashboard():
    """
    Dashboard geral de ocupação
    GET /api/paineis/painel4/dashboard
    """
    try:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM vw_ocupacao_dashboard")
            resultado = cursor.fetchone()

            if resultado:
                dados = dict(resultado)
            else:
                dados = {
                    'total_leitos': 0,
                    'leitos_ocupados': 0,
                    'leitos_livres': 0,
                    'leitos_higienizacao': 0,
                    'leitos_interditados': 0,
                    'taxa_ocupacao_geral': 0,
                    'taxa_disponibilidade': 0,
                    'total_setores': 0,
                    'media_permanencia_geral': 0,
                    'ultima_atualizacao': None
                }


            return jsonify({
                'success': True,
                'data': dados,
                'timestamp': datetime.now().isoformat()
            })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar dashboard painel4: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500

@painel4_bp.route('/api/paineis/painel4/setores', methods=['GET'])
@login_required
@panel_permission_required('painel4')
@cache_route(ttl=180, key_prefix='painel4:setores')
def api_painel4_setores():
    """
    Lista ocupação por setor
    GET /api/paineis/painel4/setores
    """
    try:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM vw_ocupacao_por_setor")

            setores = [dict(row) for row in cursor.fetchall()]


            return jsonify({
                'success': True,
                'data': setores,
                'total': len(setores),
                'timestamp': datetime.now().isoformat()
            })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar setores painel4: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500

@painel4_bp.route('/api/paineis/painel4/leitos-ocupados', methods=['GET'])
@login_required
@panel_permission_required('painel4')
@cache_route(ttl=120, key_prefix='painel4:leitos-ocupados')
def api_painel4_leitos_ocupados():
    """
    Lista leitos ocupados
    GET /api/paineis/painel4/leitos-ocupados
    """
    try:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM vw_pacientes_internados")

            leitos = [dict(row) for row in cursor.fetchall()]


            return jsonify({
                'success': True,
                'data': leitos,
                'total': len(leitos),
                'timestamp': datetime.now().isoformat()
            })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar leitos ocupados painel4: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500

@painel4_bp.route('/api/paineis/painel4/leitos-disponiveis', methods=['GET'])
@login_required
@panel_permission_required('painel4')
@cache_route(ttl=120, key_prefix='painel4:leitos-disponiveis')
def api_painel4_leitos_disponiveis():
    """
    Lista leitos disponíveis
    GET /api/paineis/painel4/leitos-disponiveis
    """
    try:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM vw_leitos_disponiveis")

            leitos = [dict(row) for row in cursor.fetchall()]


            return jsonify({
                'success': True,
                'data': leitos,
                'total': len(leitos),
                'timestamp': datetime.now().isoformat()
            })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar leitos disponíveis painel4: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500

@painel4_bp.route('/api/paineis/painel4/todos-leitos', methods=['GET'])
@login_required
@panel_permission_required('painel4')
@cache_route(ttl=180, key_prefix='painel4:todos-leitos')
def api_painel4_todos_leitos():
    """
    Lista todos os leitos do hospital
    GET /api/paineis/painel4/todos-leitos
    """
    try:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM vw_ocupacao_hospitalar ORDER BY setor, leito")

            leitos = [dict(row) for row in cursor.fetchall()]


            return jsonify({
                'success': True,
                'data': leitos,
                'total': len(leitos),
                'timestamp': datetime.now().isoformat()
            })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar todos leitos painel4: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500