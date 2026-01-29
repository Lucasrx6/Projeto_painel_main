"""
Painel 2 - Evolução de Turno
Endpoints para acompanhamento de evoluções médicas por turno
"""
from flask import Blueprint, jsonify, request, session, current_app
from datetime import datetime
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel2_bp = Blueprint('painel2', __name__, url_prefix='/api/paineis/painel2')


@painel2_bp.route('/evolucoes', methods=['GET'])
@login_required
def get_evolucoes():
    """
    Retorna lista de evoluções de turno
    GET /api/paineis/painel2/evolucoes
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel2'):
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
        cursor = conn.cursor()

        query = """
WITH turno_atual AS (
    SELECT
        CASE
            WHEN EXTRACT(HOUR FROM CURRENT_TIME) >= 7
                 AND EXTRACT(HOUR FROM CURRENT_TIME) < 19
            THEN 'DIURNO'
            ELSE 'NOTURNO'
        END as turno_prioritario
)
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
    e.dt_carga,
    CASE
        WHEN e.turno = (SELECT turno_prioritario FROM turno_atual) THEN 0
        ELSE 1
    END as prioridade_turno
FROM public.evolucao_turno e
CROSS JOIN turno_atual
WHERE e.setor IS NOT NULL
ORDER BY
    TO_DATE(e.data_turno, 'DD/MM/YYYY') DESC,
    prioridade_turno ASC,
    e.turno ASC,
    e.nr_atendimento ASC
        """

        cursor.execute(query)
        colunas = [desc[0] for desc in cursor.description]

        evolucoes = []
        for row in cursor.fetchall():
            registro = dict(zip(colunas, row))
            registro.pop('prioridade_turno', None)
            evolucoes.append(registro)

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': evolucoes,
            'total': len(evolucoes),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar evolucoes: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500