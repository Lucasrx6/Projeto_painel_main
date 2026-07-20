"""
Painel 12 - Ocupação e Produção HAC
Endpoints para monitoramento de indicadores gerenciais
"""
from flask import Blueprint, jsonify, send_from_directory, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_route

# Cria o Blueprint
painel12_bp = Blueprint('painel12', __name__)


# =========================================================
# ROTAS DE PÁGINA HTML
# =========================================================

@painel12_bp.route('/painel/painel12')
@login_required
@panel_permission_required('painel12')
def painel12():
    """Página principal do Painel 12"""
    return send_from_directory('paineis/painel12', 'index.html')


# =========================================================
# ROTAS DE API
# =========================================================

@painel12_bp.route('/api/paineis/painel12/dashboard', methods=['GET'])
@login_required
@panel_permission_required('painel12')
@cache_route(ttl=180, key_prefix='painel12:dashboard', vary_by_user=False)
def api_painel12_dashboard():
    """
    Dashboard de ocupação e produção
    GET /api/paineis/painel12/dashboard
    """
    try:
        with get_db_cursor() as cursor:

            # Buscar dados da view agregadora
            query = "SELECT * FROM vw_painel12_dashboard"
            cursor.execute(query)
            resultado = cursor.fetchone()


            if not resultado:
                # Retornar valores zerados se não houver dados
                dados = {
                    'total_leitos': 0,
                    'leitos_ocupados': 0,
                    'taxa_ocupacao': 0,
                    'ps_atendimentos_mes': 0,
                    'ps_atendimentos_hoje': 0,
                    'ps_media_dia': 0,
                    'conversoes_mes': 0,
                    'conversoes_base_total': 0,
                    'conversoes_percentual': 0,
                    'tempo_medio_internacao_h': 0,
                    'producao_mes': 0,
                    'custo_mes': 0,
                    'producao_media_dia': 0,
                    'projecao_mes': 0,
                    'dias_corridos': 0,
                    'dias_restantes': 0
                }
            else:
                dados = dict(resultado)

                # Formatar valores monetários
                if dados.get('producao_mes'):
                    dados['producao_mes_formatada'] = f"R$ {dados['producao_mes']:,.2f}"
                if dados.get('projecao_mes'):
                    dados['projecao_mes_formatada'] = f"R$ {dados['projecao_mes']:,.2f}"

            return jsonify({
                'success': True,
                'data': dados,
                'timestamp': datetime.now().isoformat()
            })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar dashboard painel12: {e}', exc_info=True)
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@painel12_bp.route('/api/paineis/painel12/setores', methods=['GET'])
@login_required
@panel_permission_required('painel12')
@cache_route(ttl=180, key_prefix='painel12:setores', vary_by_user=False, vary_by_query=True)
def api_painel12_setores():
    """
    Lista ocupação por setores
    GET /api/paineis/painel12/setores
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
        current_app.logger.error(f'Erro ao buscar setores painel12: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500