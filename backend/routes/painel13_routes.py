"""
Painel 13 - Prescrições de Nutrição
Endpoints para monitoramento de prescrições de dieta
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from psycopg2 import sql
from backend.database import get_db_connection, release_connection
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
# FUNCOES AUXILIARES
# =========================================================

def _parse_setores_param():
    """
    Extrai lista de setores do parametro 'setor' (query string).
    Suporta:
      - Valor unico: ?setor=UTI 1
      - Multiplos separados por virgula: ?setor=UTI 1,UTI 2,CLINICA
    Retorna lista de setores ou None se nenhum informado.
    """
    setor_param = request.args.get('setor', None)
    if not setor_param or setor_param.strip() == '':
        return None

    setores = [s.strip() for s in setor_param.split(',') if s.strip()]
    return setores if setores else None


def _build_setor_filter(setores):
    """
    Constroi clausula WHERE para filtro de setores.
    Retorna tupla (clausula_sql, parametros).
    - 1 setor:  WHERE setor = %s
    - N setores: WHERE setor IN (%s, %s, ...)
    """
    if not setores:
        return '', []

    if len(setores) == 1:
        return 'WHERE setor = %s', setores

    placeholders = ', '.join(['%s'] * len(setores))
    return f'WHERE setor IN ({placeholders})', setores


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
    - setor: Filtra por setor(es). Aceita valor unico ou multiplos
             separados por virgula (ex: setor=UTI 1,UTI 2)
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

        setores = _parse_setores_param()
        where_clause, params = _build_setor_filter(setores)

        # Define ORDER BY: se filtrado, ordena por leito; senao, por setor + leito
        order_by = 'ORDER BY leito' if setores else 'ORDER BY setor, leito'

        query = f"""
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
            {where_clause}
            {order_by}
        """
        cursor.execute(query, params)
        registros = cursor.fetchall()

        # Formatar datas para ISO
        resultado = []
        for reg in registros:
            item = dict(reg)

            if item.get('dt_prescricao') and hasattr(item['dt_prescricao'], 'isoformat'):
                item['dt_prescricao'] = item['dt_prescricao'].isoformat()

            # Limpar espacos extras
            if item.get('leito'):
                item['leito'] = item['leito'].strip()

            resultado.append(item)

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'data': resultado,
            'total': len(resultado),
            'setor_filtrado': ','.join(setores) if setores else None,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar dados do painel13: {e}', exc_info=True)
        if conn:
            release_connection(conn)
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
        release_connection(conn)

        return jsonify({
            'success': True,
            'setores': setores_list,
            'total': len(setores_list),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar setores do painel13: {e}', exc_info=True)
        if conn:
            release_connection(conn)
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
    - setor: Calcula stats para setor(es) especificos.
             Aceita multiplos separados por virgula.
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

        setores = _parse_setores_param()
        where_clause, params = _build_setor_filter(setores)

        query = f"""
            SELECT 
                COUNT(*) as total_pacientes,
                COUNT(*) FILTER (WHERE dieta_limpa IS NOT NULL) as com_prescricao,
                COUNT(*) FILTER (WHERE dieta_limpa IS NULL) as sem_prescricao,
                COUNT(*) FILTER (WHERE tipo_prescritor = 'Nutricionista') as prescricoes_nutricionista,
                COUNT(*) FILTER (WHERE tipo_prescritor = 'Médico') as prescricoes_medico
            FROM vw_painel_nutricao
            {where_clause}
        """
        cursor.execute(query, params)
        stats = cursor.fetchone()

        cursor.close()
        release_connection(conn)

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
            'setor_filtrado': ','.join(setores) if setores else None,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar estatísticas do painel13: {e}', exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500