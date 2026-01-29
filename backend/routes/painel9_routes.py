"""
Painel 9 - Pendências Laboratoriais
Endpoints para monitoramento de exames laboratoriais pendentes
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel9_bp = Blueprint('painel9', __name__)


# =========================================================
# ROTAS DE PÁGINA HTML
# =========================================================

@painel9_bp.route('/painel/painel9')
@login_required
def painel9():
    """Página principal do Painel 9"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel9'):
            current_app.logger.warning(f'Acesso negado ao painel9: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel9', 'index.html')


# =========================================================
# ROTAS DE API
# =========================================================

@painel9_bp.route('/api/paineis/painel9/lab', methods=['GET'])
@login_required
def api_painel9_lab():
    """
    Retorna pendências laboratoriais
    GET /api/paineis/painel9/lab?setor=...
    Query params:
    - setor: Filtra por setor específico (opcional)
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel9'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        setor = request.args.get('setor', None)

        if setor:
            query = """
                SELECT 
                    cd_unidade,
                    nm_setor,
                    nr_atendimento,
                    nm_pessoa_fisica,
                    EXTRACT(YEAR FROM AGE(CURRENT_DATE, dt_nascimento))::INTEGER AS nr_anos,
                    qt_dia_permanencia,
                    lab_pendentes
                FROM pendencias_lab
                WHERE nm_setor = %s
                  AND lab_pendentes IS NOT NULL
                  AND lab_pendentes <> ''
                ORDER BY cd_unidade
            """
            cursor.execute(query, (setor,))
        else:
            query = """
                SELECT 
                    cd_unidade,
                    nm_setor,
                    nr_atendimento,
                    nm_pessoa_fisica,
                    EXTRACT(YEAR FROM AGE(CURRENT_DATE, dt_nascimento))::INTEGER AS nr_anos,
                    qt_dia_permanencia,
                    lab_pendentes
                FROM pendencias_lab
                WHERE lab_pendentes IS NOT NULL
                  AND lab_pendentes <> ''
                ORDER BY nm_setor, cd_unidade
            """
            cursor.execute(query)

        registros = cursor.fetchall()
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': registros,
            'total': len(registros),
            'setor_filtrado': setor,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar lab pendentes: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel9_bp.route('/api/paineis/painel9/setores', methods=['GET'])
@login_required
def api_painel9_setores():
    """
    Retorna lista de setores com pendências
    GET /api/paineis/painel9/setores
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel9'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        query = """
            SELECT DISTINCT 
                nm_setor, 
                cd_setor_atendimento
            FROM pendencias_lab
            WHERE nm_setor IS NOT NULL
              AND lab_pendentes IS NOT NULL
              AND lab_pendentes <> ''
            ORDER BY nm_setor
        """
        cursor.execute(query)
        setores = cursor.fetchall()
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'setores': setores,
            'total': len(setores),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar setores painel9: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': str(e)}), 500