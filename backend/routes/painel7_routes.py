"""
Painel 7 - Detecção de Sepse
Endpoints para monitoramento de risco de sepse em pacientes
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel7_bp = Blueprint('painel7', __name__)


# =========================================================
# ROTAS DE PÁGINA HTML
# =========================================================

@painel7_bp.route('/painel/painel7')
@login_required
def painel7():
    """Página principal do Painel 7"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel7'):
            current_app.logger.warning(f'Acesso negado ao painel7: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel7', 'index.html')


# =========================================================
# ROTAS DE API
# =========================================================

@painel7_bp.route('/api/paineis/painel7/dashboard', methods=['GET'])
@login_required
def painel7_dashboard():
    """
    Dashboard de risco de sepse
    GET /api/paineis/painel7/dashboard
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE v.nivel_risco_sepse = 'CRITICO') as critico,
                COUNT(*) FILTER (WHERE v.nivel_risco_sepse = 'ALTO') as alto,
                COUNT(*) FILTER (WHERE v.nivel_risco_sepse = 'MODERADO') as moderado,
                COUNT(*) FILTER (WHERE v.nivel_risco_sepse = 'BAIXO') as baixo
            FROM public.vw_painel_sepse v
            WHERE v.status_unidade = 'P'
                AND v.nivel_risco_sepse IN ('CRITICO', 'ALTO', 'MODERADO')
        """

        cursor.execute(query)
        result = cursor.fetchone()
        cursor.close()
        conn.close()

        if not result:
            result = {'total': 0, 'critico': 0, 'alto': 0, 'moderado': 0, 'baixo': 0}

        current_app.logger.info(f"[PAINEL7] Dashboard: {dict(result)}")

        return jsonify({
            'success': True,
            'data': dict(result),
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        current_app.logger.error(f"[ERRO] /painel7/dashboard: {e}")
        import traceback
        current_app.logger.error(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500


@painel7_bp.route('/api/paineis/painel7/lista', methods=['GET'])
@login_required
def painel7_lista():
    """
    Lista de pacientes com risco de sepse
    GET /api/paineis/painel7/lista?limit=400&offset=0
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
                v.nr_atendimento,
                v.nome_paciente,
                v.dt_nascimento,
                v.sexo,
                v.leito,
                v.setor,
                v.medico_responsavel,
                v.especialidade,
                v.dias_internacao,
                v.ds_convenio,
                v.pressao_sistolica,
                v.frequencia_cardiaca,
                v.frequencia_respiratoria,
                v.temperatura,
                v.saturacao_o2,
                v.leucocitos,
                v.plaquetas,
                v.creatinina,
                v.lactato_arterial,
                v.criterio_hipotensao,
                v.criterio_dessaturacao,
                v.criterio_temperatura,
                v.criterio_leucocitos,
                v.criterio_taquicardia,
                v.criterio_taquipneia,
                v.total_criterios_principais,
                v.total_criterios_adicionais,
                v.qsofa_score,
                v.nivel_risco_sepse,
                ia.analise_ia,
                ia.resumo_clinico,
                ia.modelo_ia,
                ia.data_analise
            FROM public.vw_painel_sepse v
            LEFT JOIN public.painel_sepse_analise_ia ia 
                ON v.nr_atendimento = ia.nr_atendimento 
                AND COALESCE(ia.ie_ativo, TRUE) = TRUE
            WHERE v.status_unidade = 'P'
                AND v.nivel_risco_sepse IN ('CRITICO', 'ALTO', 'MODERADO')
            ORDER BY 
                CASE v.nivel_risco_sepse
                    WHEN 'CRITICO' THEN 1
                    WHEN 'ALTO' THEN 2
                    WHEN 'MODERADO' THEN 3
                END,
                v.total_criterios_principais DESC,
                v.qsofa_score DESC
            LIMIT %s OFFSET %s
        """

        cursor.execute(query, (limit, offset))
        registros = cursor.fetchall()

        current_app.logger.info(f"[PAINEL7] Query executada: {len(registros)} resultados")

        # Processar resultados
        resultado = []
        for reg in registros:
            item = dict(reg)

            # Calcular idade
            if item.get('dt_nascimento'):
                try:
                    dt_nasc = item['dt_nascimento']
                    hoje = datetime.now().date()

                    if hasattr(dt_nasc, 'date'):
                        dt_nasc = dt_nasc.date()

                    idade = hoje.year - dt_nasc.year
                    if (hoje.month, hoje.day) < (dt_nasc.month, dt_nasc.day):
                        idade -= 1
                    item['idade'] = idade
                except:
                    item['idade'] = None
            else:
                item['idade'] = None

            # Formatar datas para ISO
            for campo in ['data_analise', 'dt_nascimento']:
                if item.get(campo) and hasattr(item[campo], 'isoformat'):
                    item[campo] = item[campo].isoformat()

            resultado.append(item)

        cursor.close()
        conn.close()

        current_app.logger.info(f"[PAINEL7] Retornando {len(resultado)} pacientes processados")

        return jsonify({
            'success': True,
            'data': resultado,
            'total': len(resultado),
            'limit': limit,
            'offset': offset,
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        current_app.logger.error(f"[ERRO] /painel7/lista: {e}")
        import traceback
        current_app.logger.error(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500


@painel7_bp.route('/api/paineis/painel7/detalhes/<nr_atendimento>', methods=['GET'])
@login_required
def painel7_detalhes(nr_atendimento):
    """
    Detalhes de paciente específico
    GET /api/paineis/painel7/detalhes/<nr_atendimento>
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT 
                v.*,
                ia.analise_ia,
                ia.recomendacoes_ia,
                ia.resumo_clinico,
                ia.modelo_ia,
                ia.data_analise
            FROM public.vw_painel_sepse v
            LEFT JOIN public.painel_sepse_analise_ia ia 
                ON v.nr_atendimento = ia.nr_atendimento 
                AND COALESCE(ia.ie_ativo, TRUE) = TRUE
            WHERE v.nr_atendimento = %s
        """

        cursor.execute(query, (nr_atendimento,))
        resultado = cursor.fetchone()
        cursor.close()
        conn.close()

        if not resultado:
            return jsonify({
                'success': False,
                'error': 'Paciente não encontrado'
            }), 404

        dados = dict(resultado)

        # Formatar datas
        for campo in ['dt_nascimento', 'dt_entrada_unidade', 'data_analise']:
            if dados.get(campo) and hasattr(dados[campo], 'isoformat'):
                dados[campo] = dados[campo].isoformat()

        return jsonify({
            'success': True,
            'data': dados,
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        current_app.logger.error(f"[ERRO] /painel7/detalhes: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500