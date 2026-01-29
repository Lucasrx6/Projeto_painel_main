"""
Painel 4 - Ocupação Hospitalar
Endpoints para monitoramento de ocupação de leitos e setores
"""
from flask import Blueprint, jsonify, send_from_directory, session, current_app
from datetime import datetime
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel4_bp = Blueprint('painel4', __name__)


# =========================================================
# ROTAS DE PÁGINA HTML
# =========================================================

@painel4_bp.route('/painel/painel4')
@login_required
def painel4():
    """Página principal do Painel 4"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            current_app.logger.warning(f'Acesso negado ao painel4: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel4', 'index.html')


@painel4_bp.route('/painel/painel4/detalhes')
@login_required
def painel4_detalhes():
    """Página de detalhes do Painel 4"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            current_app.logger.warning(f'Acesso negado ao painel4/detalhes: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel4', 'detalhes.html')


# =========================================================
# ROTAS DE API
# =========================================================

@painel4_bp.route('/api/paineis/painel4/dashboard', methods=['GET'])
@login_required
def api_painel4_dashboard():
    """
    Dashboard geral de ocupação
    GET /api/paineis/painel4/dashboard
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM vw_ocupacao_dashboard")
        colunas = [desc[0] for desc in cursor.description]
        resultado = cursor.fetchone()

        if resultado:
            dados = dict(zip(colunas, resultado))
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

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': dados,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar dashboard painel4: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


@painel4_bp.route('/api/paineis/painel4/setores', methods=['GET'])
@login_required
def api_painel4_setores():
    """
    Lista ocupação por setor
    GET /api/paineis/painel4/setores
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM vw_ocupacao_por_setor")

        colunas = [desc[0] for desc in cursor.description]
        setores = [dict(zip(colunas, row)) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': setores,
            'total': len(setores),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar setores painel4: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


@painel4_bp.route('/api/paineis/painel4/leitos-ocupados', methods=['GET'])
@login_required
def api_painel4_leitos_ocupados():
    """
    Lista leitos ocupados
    GET /api/paineis/painel4/leitos-ocupados
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM vw_pacientes_internados")

        colunas = [desc[0] for desc in cursor.description]
        leitos = [dict(zip(colunas, row)) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': leitos,
            'total': len(leitos),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar leitos ocupados painel4: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


@painel4_bp.route('/api/paineis/painel4/leitos-disponiveis', methods=['GET'])
@login_required
def api_painel4_leitos_disponiveis():
    """
    Lista leitos disponíveis
    GET /api/paineis/painel4/leitos-disponiveis
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM vw_leitos_disponiveis")

        colunas = [desc[0] for desc in cursor.description]
        leitos = [dict(zip(colunas, row)) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': leitos,
            'total': len(leitos),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar leitos disponíveis painel4: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


@painel4_bp.route('/api/paineis/painel4/todos-leitos', methods=['GET'])
@login_required
def api_painel4_todos_leitos():
    """
    Lista todos os leitos do hospital
    GET /api/paineis/painel4/todos-leitos
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM vw_ocupacao_hospitalar ORDER BY setor, leito")

        colunas = [desc[0] for desc in cursor.description]
        leitos = [dict(zip(colunas, row)) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': leitos,
            'total': len(leitos),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar todos leitos painel4: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500