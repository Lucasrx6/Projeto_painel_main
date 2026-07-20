"""
Painel 2 - Evolução de Turno
Endpoints para acompanhamento de evoluções médicas por turno
"""
from flask import Blueprint, jsonify, request, session, current_app
from datetime import datetime
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_route

# Cria o Blueprint
painel2_bp = Blueprint('painel2', __name__)


@painel2_bp.route('/api/paineis/painel2/evolucoes', methods=['GET'])
@login_required
@panel_permission_required('painel2')
@cache_route(ttl=60, key_prefix='painel2:evolucoes', vary_by_user=False)
def get_evolucoes():
    """
    Retorna lista de evoluções de turno
    GET /api/paineis/painel2/evolucoes
    """
    try:
        with get_db_cursor(use_dict_cursor=False) as cursor:

            hora = datetime.now().hour
            turno_prioritario = 'DIURNO' if 7 <= hora < 19 else 'NOTURNO'

            query = """
SELECT
    e.nr_atendimento,
    e.ds_convenio,
    e.nm_paciente,
    e.idade,
    e.dt_entrada,
    e.medico_responsavel,
    e.medico_atendimento,
    e.dias_internado,
    e.data_turno as data_turno,
    e.turno,
    e.setor,
    e.unidade,
    e.dt_admissao_unidade,
    e.evol_medico,
    e.evol_enfermeiro,
    e.evol_tec_enfermagem,
    e.evol_nutricionista,
    e.evol_fisioterapeuta,
    e.dt_carga
FROM public.evolucao_turno e
WHERE e.setor IS NOT NULL
ORDER BY
    TO_DATE(e.data_turno, 'DD/MM/YYYY') DESC,
    CASE WHEN e.turno = %s THEN 0 ELSE 1 END ASC,
    e.turno ASC,
    e.nr_atendimento ASC
            """

            cursor.execute(query, (turno_prioritario,))
            colunas = [desc[0] for desc in cursor.description]

            evolucoes = [dict(zip(colunas, row)) for row in cursor.fetchall()]


            return jsonify({
            'success': True,
            'data': evolucoes,
            'total': len(evolucoes),
            'timestamp': datetime.now().isoformat()
            })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar evolucoes: {e}', exc_info=True)
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500