"""
Painel 6 - Priorização Clínica com IA
Endpoints para análise de risco clínico com inteligência artificial
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel6_bp = Blueprint('painel6', __name__)


# =========================================================
# ROTAS DE PÁGINA HTML
# =========================================================

@painel6_bp.route('/painel/painel6')
@login_required
def painel6():
    """Página principal do Painel 6"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel6'):
            current_app.logger.warning(f'Acesso negado ao painel6: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel6', 'index.html')


# =========================================================
# ROTAS DE API
# =========================================================

@painel6_bp.route('/api/paineis/painel6/dashboard', methods=['GET'])
def painel6_dashboard():
    """
    Dashboard de criticidade
    GET /api/paineis/painel6/dashboard
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE nivel_criticidade = 'CRITICO') as critico,
                COUNT(*) FILTER (WHERE nivel_criticidade = 'ALTO') as alto,
                COUNT(*) FILTER (WHERE nivel_criticidade = 'MODERADO') as moderado,
                COUNT(*) FILTER (WHERE nivel_criticidade = 'BAIXO') as baixo
            FROM public.painel_clinico_analise_ia
            WHERE COALESCE(ie_ativo, TRUE) = TRUE
        """

        cursor.execute(query)
        result = cursor.fetchone()
        cursor.close()
        conn.close()

        if not result:
            result = {'total': 0, 'critico': 0, 'alto': 0, 'moderado': 0, 'baixo': 0}

        return jsonify({
            'success': True,
            'data': dict(result),
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        current_app.logger.error(f"[ERRO] /dashboard: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@painel6_bp.route('/api/paineis/painel6/lista', methods=['GET'])
def painel6_lista():
    """
    Lista de pacientes priorizados
    GET /api/paineis/painel6/lista?limit=400&offset=0
    """
    try:
        limit = request.args.get('limit', 400, type=int)
        offset = request.args.get('offset', 0, type=int)

        if limit > 1000:
            limit = 1000

        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT 
                p.nr_atendimento,
                p.nm_pessoa_fisica,
                p.cd_unidade,
                p.nm_setor,
                ia.analise_ia,
                ia.nivel_criticidade,
                ia.score_ia,
                ia.dt_analise,
                ia.dt_atualizacao,
                p.dt_carga
            FROM public.painel_clinico_tasy p
            INNER JOIN public.painel_clinico_analise_ia ia
                ON p.nr_atendimento = ia.nr_atendimento
            WHERE 
                COALESCE(ia.ie_ativo, TRUE) = TRUE
                AND p.ie_status_unidade = 'P'
            ORDER BY 
                ia.score_ia DESC,
                p.dt_carga DESC
            LIMIT %s OFFSET %s
        """

        cursor.execute(query, (limit, offset))
        pacientes = cursor.fetchall()
        cursor.close()
        conn.close()

        resultado = []
        for p in pacientes:
            paciente_dict = dict(p)

            # Formata datas
            for key in ['dt_analise', 'dt_atualizacao', 'dt_carga']:
                if key in paciente_dict and paciente_dict[key]:
                    if isinstance(paciente_dict[key], datetime):
                        paciente_dict[key] = paciente_dict[key].isoformat()

            # Compatibilidade com frontend
            paciente_dict['nivel_risco_total'] = paciente_dict.get('nivel_criticidade')
            paciente_dict['score_clinico_total'] = paciente_dict.get('score_ia')

            resultado.append(paciente_dict)

        return jsonify({
            'success': True,
            'data': resultado,
            'count': len(resultado),
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        current_app.logger.error(f"[ERRO] /lista: {e}")
        import traceback
        traceback.print_exc()

        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@painel6_bp.route('/api/paineis/painel6/paciente/<int:nr_atendimento>', methods=['GET'])
def painel6_paciente_detalhe(nr_atendimento):
    """
    Detalhes de um paciente específico
    GET /api/paineis/painel6/paciente/<nr_atendimento>
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT 
                p.*,
                ia.analise_ia,
                ia.nivel_criticidade as ia_criticidade,
                ia.score_ia,
                ia.dt_analise
            FROM vw_painel_clinico_risco p
            LEFT JOIN painel_clinico_analise_ia ia
                ON p.nr_atendimento = ia.nr_atendimento
                AND COALESCE(ia.ie_ativo, TRUE) = TRUE
            WHERE p.nr_atendimento = %s
        """

        cursor.execute(query, (nr_atendimento,))
        paciente = cursor.fetchone()
        cursor.close()
        conn.close()

        if not paciente:
            return jsonify({
                'success': False,
                'error': 'Paciente não encontrado'
            }), 404

        return jsonify({
            'success': True,
            'data': dict(paciente),
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        current_app.logger.error(f"❌ Erro em /paciente: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@painel6_bp.route('/api/paineis/painel6/analisar/<int:nr_atendimento>', methods=['POST'])
def painel6_forcar_analise(nr_atendimento):
    """
    Força reanálise de um paciente
    POST /api/paineis/painel6/analisar/<nr_atendimento>
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Marca análise anterior como inativa
        cursor.execute("""
            UPDATE painel_clinico_analise_ia
            SET ie_ativo = FALSE
            WHERE nr_atendimento = %s
        """, (nr_atendimento,))

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'message': 'Paciente marcado para reanalise. Aguarde próximo ciclo do worker.',
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        current_app.logger.error(f"❌ Erro ao forçar análise: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@painel6_bp.route('/api/paineis/painel6/test', methods=['GET'])
def painel6_test():
    """
    Testa conectividade do Painel 6
    GET /api/paineis/painel6/test
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT COUNT(*) FROM vw_painel_clinico_risco")
        count = cursor.fetchone()[0]
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'message': 'Painel 6 OK!',
            'pacientes_na_view': count,
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500