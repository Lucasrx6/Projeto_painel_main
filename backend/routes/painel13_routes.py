"""
Painel 13 - Prescrições de Nutrição
Endpoints para monitoramento de prescrições de dieta
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel13_bp = Blueprint('painel13', __name__)


# =========================================================
# ROTAS DE PÁGINA HTML
# =========================================================

@painel13_bp.route('/painel/painel13')
@login_required
def painel13():
    """Página principal do Painel 13"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel13'):
            current_app.logger.warning(f'Acesso negado ao painel13: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel13', 'index.html')


# =========================================================
# ROTAS DE API
# =========================================================

@painel13_bp.route('/api/paineis/painel13/nutricao', methods=['GET'])
@login_required
def api_painel13_nutricao():
    """
    Retorna dados das prescrições de nutrição
    GET /api/paineis/painel13/nutricao?setor=...
    Query params:
    - setor: Filtra por setor específico (opcional)
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel13'):
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

        # Filtro por setor (opcional)
        setor = request.args.get('setor', None)

        if setor:
            query = """
                SELECT 
                    leito,
                    nr_atendimento,
                    nm_paciente,
                    convenio,
                    idade,
                    nm_prescritor,
                    tipo_prescritor,
                    nm_medico,
                    dieta_limpa,
                    obs_limpa,
                    dt_prescricao,
                    setor,
                    alergia,
                    acompanhante_calculado as acompanhante
                FROM vw_painel_nutricao
                WHERE setor = %s
                ORDER BY leito
            """
            cursor.execute(query, (setor,))
        else:
            query = """
                SELECT 
                    leito,
                    nr_atendimento,
                    nm_paciente,
                    convenio,
                    idade,
                    nm_prescritor,
                    tipo_prescritor,
                    nm_medico,
                    dieta_limpa,
                    obs_limpa,
                    dt_prescricao,
                    setor,
                    alergia,
                    acompanhante_calculado as acompanhante
                FROM vw_painel_nutricao
                ORDER BY setor, leito
            """
            cursor.execute(query)

        registros = cursor.fetchall()

        # Formatar datas para ISO
        resultado = []
        for reg in registros:
            item = dict(reg)

            if item.get('dt_prescricao') and hasattr(item['dt_prescricao'], 'isoformat'):
                item['dt_prescricao'] = item['dt_prescricao'].isoformat()

            # Limpar espaços extras
            if item.get('leito'):
                item['leito'] = item['leito'].strip()

            resultado.append(item)

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': resultado,
            'total': len(resultado),
            'setor_filtrado': setor,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar dados do painel13: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@painel13_bp.route('/api/paineis/painel13/setores', methods=['GET'])
@login_required
def api_painel13_setores():
    """
    Retorna lista de setores disponíveis
    GET /api/paineis/painel13/setores
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel13'):
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

        query = """
            SELECT DISTINCT 
                setor
            FROM vw_painel_nutricao
            WHERE setor IS NOT NULL
            ORDER BY setor
        """

        cursor.execute(query)
        setores_list = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'setores': setores_list,
            'total': len(setores_list),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar setores do painel13: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@painel13_bp.route('/api/paineis/painel13/stats', methods=['GET'])
@login_required
def api_painel13_stats():
    """
    Retorna estatísticas de prescrições
    GET /api/paineis/painel13/stats?setor=...
    Query params:
    - setor: Calcula stats para setor específico (opcional)
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel13'):
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

        setor = request.args.get('setor', None)

        if setor:
            query = """
                SELECT 
                    setor,
                    COUNT(*) as total_pacientes,
                    COUNT(*) FILTER (WHERE dieta_limpa IS NOT NULL) as com_prescricao,
                    COUNT(*) FILTER (WHERE dieta_limpa IS NULL) as sem_prescricao,
                    COUNT(*) FILTER (WHERE tipo_prescritor = 'Nutricionista') as prescricoes_nutricionista,
                    COUNT(*) FILTER (WHERE tipo_prescritor = 'Médico') as prescricoes_medico
                FROM vw_painel_nutricao
                WHERE setor = %s
                GROUP BY setor
            """
            cursor.execute(query, (setor,))
            stats = cursor.fetchone()
        else:
            query = """
                SELECT 
                    COUNT(*) as total_pacientes,
                    COUNT(*) FILTER (WHERE dieta_limpa IS NOT NULL) as com_prescricao,
                    COUNT(*) FILTER (WHERE dieta_limpa IS NULL) as sem_prescricao,
                    COUNT(*) FILTER (WHERE tipo_prescritor = 'Nutricionista') as prescricoes_nutricionista,
                    COUNT(*) FILTER (WHERE tipo_prescritor = 'Médico') as prescricoes_medico
                FROM vw_painel_nutricao
            """
            cursor.execute(query)
            stats = cursor.fetchone()

        cursor.close()
        conn.close()

        if not stats:
            stats = {
                'total_pacientes': 0,
                'com_prescricao': 0,
                'sem_prescricao': 0,
                'prescricoes_nutricionista': 0,
                'prescricoes_medico': 0
            }

        return jsonify({
            'success': True,
            'stats': dict(stats),
            'setor_filtrado': setor,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar estatísticas do painel13: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500