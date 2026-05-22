"""
Painel 9 - Pendências Laboratoriais
Endpoints para monitoramento de exames laboratoriais pendentes
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_route

# Cria o Blueprint
painel9_bp = Blueprint('painel9', __name__)


# =========================================================
# ROTAS DE PÁGINA HTML
# =========================================================

@painel9_bp.route('/painel/painel9')
@login_required
@panel_permission_required('painel9')
def painel9():
    """Página principal do Painel 9"""
    return send_from_directory('paineis/painel9', 'index.html')


# =========================================================
# ROTAS DE API
# =========================================================

@painel9_bp.route('/api/paineis/painel9/lab', methods=['GET'])
@login_required
@panel_permission_required('painel9')
@cache_route(ttl=90, key_prefix='painel9:lab', vary_by_query=True)
def api_painel9_lab():
    """
    Retorna pendências laboratoriais
    GET /api/paineis/painel9/lab?setor=...
    Query params:
    - setor: Filtra por setor específico (opcional)
    """
    try:
        with get_db_cursor() as cursor:
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

            return jsonify({
                'success': True,
                'data': registros,
                'total': len(registros),
                'setor_filtrado': setor,
                'timestamp': datetime.now().isoformat()
            })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar lab pendentes: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno do servidor'}), 500


@painel9_bp.route('/api/paineis/painel9/setores', methods=['GET'])
@login_required
@panel_permission_required('painel9')
@cache_route(ttl=120, key_prefix='painel9:setores')
def api_painel9_setores():
    """
    Retorna lista de setores com pendências
    GET /api/paineis/painel9/setores
    """
    try:
        with get_db_cursor() as cursor:
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

            return jsonify({
                'success': True,
                'setores': setores,
                'total': len(setores),
                'timestamp': datetime.now().isoformat()
            })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar setores painel9: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno do servidor'}), 500