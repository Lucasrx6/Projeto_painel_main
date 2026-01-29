"""
Painel 12 - Ocupação e Produção HAC
Endpoints para monitoramento de indicadores gerenciais
"""
from flask import Blueprint, jsonify, send_from_directory, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel12_bp = Blueprint('painel12', __name__)


# =========================================================
# ROTAS DE PÁGINA HTML
# =========================================================

@painel12_bp.route('/painel/painel12')
@login_required
def painel12():
    """Página principal do Painel 12"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel12'):
            current_app.logger.warning(f'Acesso negado ao painel12: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel12', 'index.html')


# =========================================================
# ROTAS DE API
# =========================================================

@painel12_bp.route('/api/paineis/painel12/dashboard', methods=['GET'])
@login_required
def api_painel12_dashboard():
    """
    Dashboard de ocupação e produção
    GET /api/paineis/painel12/dashboard
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel12'):
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

        # Buscar dados da view agregadora
        query = "SELECT * FROM vw_painel12_dashboard"
        cursor.execute(query)
        resultado = cursor.fetchone()

        cursor.close()
        conn.close()

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
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@painel12_bp.route('/api/paineis/painel12/setores', methods=['GET'])
@login_required
def api_painel12_setores():
    """
    Lista ocupação por setores
    GET /api/paineis/painel12/setores
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel12'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("SELECT * FROM vw_ocupacao_por_setor")

        setores = [dict(row) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': setores,
            'total': len(setores),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar setores painel12: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500